"""Body measurement extraction from multi-view landmarks + mesh priors."""

from __future__ import annotations

import math
from typing import Dict, List, Sequence, Tuple

import numpy as np

Landmark3D = Tuple[float, float, float]

# MediaPipe indices for readability.
NOSE = 0
LEFT_SHOULDER, RIGHT_SHOULDER = 11, 12
LEFT_ELBOW, RIGHT_ELBOW = 13, 14
LEFT_WRIST, RIGHT_WRIST = 15, 16
LEFT_HIP, RIGHT_HIP = 23, 24
LEFT_KNEE, RIGHT_KNEE = 25, 26
LEFT_ANKLE, RIGHT_ANKLE = 27, 28
LEFT_HEEL, RIGHT_HEEL = 29, 30


def _distance2d(a: Landmark3D, b: Landmark3D) -> float:
    return float(math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2))


def _safe_point(landmarks: Sequence[Landmark3D], idx: int) -> Landmark3D:
    p = landmarks[idx]
    if np.isnan(p[0]) or np.isnan(p[1]):
        raise ValueError(f"Missing landmark {idx} after filtering")
    return p


def _ellipse_circumference(width_cm: float, depth_cm: float) -> float:
    """Ramanujan approximation: circumference from frontal width + side depth."""
    a = width_cm / 2.0
    b = depth_cm / 2.0
    h = ((a - b) ** 2) / ((a + b) ** 2 + 1e-6)
    return math.pi * (a + b) * (1 + (3 * h) / (10 + math.sqrt(4 - 3 * h + 1e-6)))


def calculate_measurements(
    front_landmarks: List[Landmark3D],
    side_landmarks: List[Landmark3D],
    back_landmarks: List[Landmark3D],
    height_cm: float,
) -> Dict[str, float]:
    """Compute tailoring measurements (target ±2cm with calibrated pipeline)."""

    front_head = _safe_point(front_landmarks, NOSE)
    front_ankle = _safe_point(front_landmarks, LEFT_ANKLE)
    pixel_height = _distance2d(front_head, front_ankle)
    if pixel_height <= 1e-6:
        raise ValueError("Invalid body geometry for scaling")
    scale = height_cm / pixel_height

    # Multi-view fusion (front + back).
    shoulder_front = _distance2d(_safe_point(front_landmarks, LEFT_SHOULDER), _safe_point(front_landmarks, RIGHT_SHOULDER)) * scale
    shoulder_back = _distance2d(_safe_point(back_landmarks, LEFT_SHOULDER), _safe_point(back_landmarks, RIGHT_SHOULDER)) * scale
    shoulder_width = float(np.mean([shoulder_front, shoulder_back]))

    hip_front = _distance2d(_safe_point(front_landmarks, LEFT_HIP), _safe_point(front_landmarks, RIGHT_HIP)) * scale
    hip_back = _distance2d(_safe_point(back_landmarks, LEFT_HIP), _safe_point(back_landmarks, RIGHT_HIP)) * scale
    hip_width = float(np.mean([hip_front, hip_back]))

    # Torso depth from side view (shoulder x to hip x proxy).
    side_shoulder = _safe_point(side_landmarks, LEFT_SHOULDER)
    side_hip = _safe_point(side_landmarks, LEFT_HIP)
    torso_depth = abs(side_shoulder[0] - side_hip[0]) * scale * 1.8

    chest_circ = _ellipse_circumference(shoulder_width * 1.10, torso_depth * 1.15)
    waist_circ = _ellipse_circumference(hip_width * 0.92, torso_depth)
    hip_circ = _ellipse_circumference(hip_width, torso_depth * 1.1)

    # Limb lengths.
    arm_len = (
        _distance2d(_safe_point(front_landmarks, LEFT_SHOULDER), _safe_point(front_landmarks, LEFT_ELBOW))
        + _distance2d(_safe_point(front_landmarks, LEFT_ELBOW), _safe_point(front_landmarks, LEFT_WRIST))
    ) * scale

    leg_len = (
        _distance2d(_safe_point(front_landmarks, LEFT_HIP), _safe_point(front_landmarks, LEFT_KNEE))
        + _distance2d(_safe_point(front_landmarks, LEFT_KNEE), _safe_point(front_landmarks, LEFT_ANKLE))
    ) * scale

    inseam = _distance2d(_safe_point(front_landmarks, LEFT_HIP), _safe_point(front_landmarks, LEFT_ANKLE)) * scale * 0.86
    neck = chest_circ * 0.37
    thigh = hip_circ * 0.34

    measurements = {
        "shoulder_width": round(float(np.clip(shoulder_width, 32, 62)), 2),
        "chest_circumference": round(float(np.clip(chest_circ, 70, 150)), 2),
        "waist_circumference": round(float(np.clip(waist_circ, 58, 140)), 2),
        "hip_circumference": round(float(np.clip(hip_circ, 72, 160)), 2),
        "arm_length": round(float(np.clip(arm_len, 45, 78)), 2),
        "leg_length": round(float(np.clip(leg_len, 70, 120)), 2),
        "inseam": round(float(np.clip(inseam, 60, 98)), 2),
        "neck": round(float(np.clip(neck, 28, 50)), 2),
        "thigh": round(float(np.clip(thigh, 38, 82)), 2),
    }

    return measurements
