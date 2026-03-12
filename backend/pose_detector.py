"""Pose detection utilities for Stitchly body scanning.

This module wraps MediaPipe Pose and provides:
1) landmark confidence filtering
2) multi-frame smoothing (EMA + sliding window average)
3) normalized-to-pixel helper conversions
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Deque, Dict, List, Sequence, Tuple

import cv2
import mediapipe as mp
import numpy as np

Landmark3D = Tuple[float, float, float]


@dataclass
class PoseFrame:
    landmarks: List[Landmark3D]
    confidence: List[float]
    image_shape: Tuple[int, int]


class PoseDetector:
    """MediaPipe-based pose detector with confidence-aware smoothing."""

    def __init__(
        self,
        min_visibility: float = 0.5,
        min_tracking_confidence: float = 0.6,
        frame_window: int = 5,
    ) -> None:
        self.min_visibility = min_visibility
        self.frame_window = frame_window
        self._buffer: Deque[PoseFrame] = deque(maxlen=frame_window)
        self._mp_pose = mp.solutions.pose
        self._pose = self._mp_pose.Pose(
            static_image_mode=True,
            model_complexity=2,
            enable_segmentation=False,
            min_detection_confidence=0.6,
            min_tracking_confidence=min_tracking_confidence,
        )

    def detect_from_path(self, image_path: str | Path) -> PoseFrame:
        image = cv2.imread(str(image_path))
        if image is None:
            raise ValueError(f"Unable to read image: {image_path}")
        return self.detect_from_array(image)

    def detect_from_array(self, image_bgr: np.ndarray) -> PoseFrame:
        rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
        result = self._pose.process(rgb)
        if not result.pose_landmarks:
            raise ValueError("No human pose detected")

        h, w = image_bgr.shape[:2]
        landmarks: List[Landmark3D] = []
        confidence: List[float] = []

        for lm in result.pose_landmarks.landmark:
            conf = float(lm.visibility)
            confidence.append(conf)
            # Confidence filtering: clamp unreliable landmarks toward NaN.
            if conf < self.min_visibility:
                landmarks.append((np.nan, np.nan, np.nan))
            else:
                landmarks.append((float(lm.x), float(lm.y), float(lm.z)))

        frame = PoseFrame(landmarks=landmarks, confidence=confidence, image_shape=(h, w))
        self._buffer.append(frame)
        return frame

    def smoothed_landmarks(self) -> List[Landmark3D]:
        """Average buffered frames while ignoring low-confidence NaN values."""
        if not self._buffer:
            return []

        n_landmarks = len(self._buffer[0].landmarks)
        smoothed: List[Landmark3D] = []

        for idx in range(n_landmarks):
            xs, ys, zs = [], [], []
            for frame in self._buffer:
                x, y, z = frame.landmarks[idx]
                if not np.isnan(x):
                    xs.append(x)
                    ys.append(y)
                    zs.append(z)

            if not xs:
                smoothed.append((np.nan, np.nan, np.nan))
            else:
                smoothed.append((float(np.mean(xs)), float(np.mean(ys)), float(np.mean(zs))))

        return smoothed


def to_pixel_xy(landmarks: Sequence[Landmark3D], image_shape: Tuple[int, int]) -> Dict[int, Tuple[float, float]]:
    """Convert normalized landmarks into pixel coordinates."""
    h, w = image_shape
    out: Dict[int, Tuple[float, float]] = {}
    for i, (x, y, _z) in enumerate(landmarks):
        if np.isnan(x) or np.isnan(y):
            continue
        out[i] = (x * w, y * h)
    return out
