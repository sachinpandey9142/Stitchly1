from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

BaseOptions = python.BaseOptions
PoseLandmarker = vision.PoseLandmarker
PoseLandmarkerOptions = vision.PoseLandmarkerOptions
VisionRunningMode = vision.RunningMode

MODEL_PATH = Path(__file__).resolve().parents[1] / "pose_landmarker_lite.task"
SEGMENTATION_THRESHOLD = 0.35
SILHOUETTE_POINT_LIMIT = 220


def _build_landmarker() -> PoseLandmarker:
    options = PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(MODEL_PATH)),
        running_mode=VisionRunningMode.IMAGE,
        num_poses=1,
        min_pose_detection_confidence=0.55,
        min_pose_presence_confidence=0.55,
        min_tracking_confidence=0.55,
        output_segmentation_masks=True,
    )
    return PoseLandmarker.create_from_options(options)


def _normalize_landmarks(raw_landmarks) -> List[Dict[str, float]]:
    normalized: List[Dict[str, float]] = []
    for landmark in raw_landmarks:
        normalized.append(
            {
                "x": float(landmark.x),
                "y": float(landmark.y),
                "z": float(landmark.z),
                "visibility": float(getattr(landmark, "visibility", 0.0)),
                "presence": float(getattr(landmark, "presence", 0.0)),
            }
        )
    return normalized


def _smooth_mask(mask: np.ndarray) -> np.ndarray:
    clipped = np.clip(mask.astype(np.float32), 0.0, 1.0)
    return cv2.GaussianBlur(clipped, (7, 7), 0)


def _extract_silhouette(mask: np.ndarray) -> List[Dict[str, float]]:
    if mask.size == 0:
        return []

    binary = (mask >= SEGMENTATION_THRESHOLD).astype(np.uint8) * 255
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return []

    contour = max(contours, key=cv2.contourArea)
    if cv2.contourArea(contour) <= 10.0:
        return []

    perimeter = cv2.arcLength(contour, True)
    epsilon = max(1.0, perimeter * 0.0025)
    approx = cv2.approxPolyDP(contour, epsilon, True)
    points = approx.reshape(-1, 2)

    if len(points) > SILHOUETTE_POINT_LIMIT:
        step = max(1, len(points) // SILHOUETTE_POINT_LIMIT)
        points = points[::step]

    height, width = mask.shape[:2]
    width_scale = max(width - 1, 1)
    height_scale = max(height - 1, 1)

    silhouette: List[Dict[str, float]] = []
    for x, y in points:
        silhouette.append(
            {
                "x": float(np.clip(x / width_scale, 0.0, 1.0)),
                "y": float(np.clip(y / height_scale, 0.0, 1.0)),
            }
        )
    return silhouette


def _pose_confidence(landmarks: List[Dict[str, float]]) -> float:
    if not landmarks:
        return 0.0

    critical_indices = (0, 11, 12, 23, 24, 27, 28)
    scores = []
    for index in critical_indices:
        if index < len(landmarks):
            scores.append(float(landmarks[index].get("visibility", 0.0)))
    if not scores:
        return 0.0
    return float(sum(scores) / len(scores))


def detect_pose(image_path: str) -> Dict[str, Any]:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Pose model not found at: {MODEL_PATH}")

    image = cv2.imread(image_path)
    if image is None:
        raise ValueError("Image could not be loaded")

    height, width = image.shape[:2]
    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=image_rgb)

    with _build_landmarker() as landmarker:
        detection = landmarker.detect(mp_image)

    if not detection.pose_landmarks:
        return {
            "landmarks": [],
            "segmentation_mask": None,
            "silhouette": [],
            "pose_confidence": 0.0,
            "image_width": int(width),
            "image_height": int(height),
        }

    landmarks = _normalize_landmarks(detection.pose_landmarks[0])

    segmentation_mask = None
    silhouette: List[Dict[str, float]] = []
    if detection.segmentation_masks:
        raw_mask = np.array(detection.segmentation_masks[0].numpy_view(), dtype=np.float32)
        segmentation_mask = _smooth_mask(raw_mask)
        silhouette = _extract_silhouette(segmentation_mask)

    return {
        "landmarks": landmarks,
        "segmentation_mask": segmentation_mask,
        "silhouette": silhouette,
        "pose_confidence": _pose_confidence(landmarks),
        "image_width": int(width),
        "image_height": int(height),
    }


def detect_landmarks(image_path: str):
    """Backward-compatible helper expected by existing endpoints/tests."""
    return detect_pose(image_path).get("landmarks", [])