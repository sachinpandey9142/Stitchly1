import math
from typing import Any, Dict, Iterable, List, Optional, Tuple

import cv2
import numpy as np
from scipy.ndimage import gaussian_filter1d


VISIBILITY_THRESHOLD = 0.55
MIN_OVERALL_CONFIDENCE = 0.55
MIN_METRIC_CONFIDENCE = 0.42
LOW_QUALITY_WARNING_THRESHOLD = 0.60
EXTREME_LOW_QUALITY_THRESHOLD = 0.30
MAX_TILT_DELTA = 0.06
SEGMENTATION_THRESHOLD = 0.42
CONTOUR_TARGET_POINTS = 150
CONTOUR_MIN_POINTS = 100
PROFILE_LEVEL_COUNT = 20
PROFILE_SMOOTH_SIGMA = 2.0

DISTANCE_MIN_TORSO_RATIO = 0.15
DISTANCE_MAX_TORSO_RATIO = 0.42
TARGET_TORSO_RATIO = 0.27

ANTHRO_SHOULDER_RATIO = 0.259
ANTHRO_HIP_RATIO = 0.191
ANTHRO_LEG_RATIO = 0.46
SIDE_ORIENTATION_MIN_SIN = 0.28
SIDE_ORIENTATION_MAX_COS = 0.95

RAW_METRIC_KEYS = (
    "shoulder_width_cm",
    "chest_cm",
    "waist_cm",
    "hip_width_cm",
    "hip_circumference_cm",
    "arm_length_cm",
    "leg_length_cm",
    "neck_cm",
    "torso_depth_cm",
)


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(value, maximum))


def _average(values: Iterable[float]) -> float:
    values = list(values)
    return sum(values) / len(values) if values else 0.0


def _median(values: Iterable[float]) -> float:
    values = list(values)
    return float(np.median(values)) if values else 0.0


def _sample_contour_points(
    points: np.ndarray,
    target_points: int = CONTOUR_TARGET_POINTS,
    min_points: int = CONTOUR_MIN_POINTS,
) -> np.ndarray:
    if points is None or points.size == 0:
        return np.empty((0, 2), dtype=np.float32)

    point_count = len(points)
    if point_count <= target_points:
        return points.astype(np.float32)

    desired = min(point_count, max(min_points, target_points))
    indices = np.linspace(0, point_count - 1, num=desired, dtype=np.int32)
    return points[indices].astype(np.float32)


def _get_xy(landmark: Any) -> Tuple[float, float]:
    if isinstance(landmark, dict):
        return float(landmark.get("x", 0.0)), float(landmark.get("y", 0.0))
    return float(landmark[0]), float(landmark[1])


def _get_visibility(landmark: Any) -> float:
    if isinstance(landmark, dict):
        return float(landmark.get("visibility", 1.0))
    return 1.0


def _landmark_distance_pixels(
    landmarks: List[Any],
    index_a: int,
    index_b: int,
    image_width: int,
    image_height: int,
) -> float:
    if index_a >= len(landmarks) or index_b >= len(landmarks):
        return 0.0
    ax, ay = _get_xy(landmarks[index_a])
    bx, by = _get_xy(landmarks[index_b])
    dx = (ax - bx) * image_width
    dy = (ay - by) * image_height
    return math.sqrt((dx * dx) + (dy * dy))


def _segment_chain_length_pixels(
    landmarks: List[Any],
    chain: List[int],
    image_width: int,
    image_height: int,
) -> float:
    total = 0.0
    for idx in range(len(chain) - 1):
        total += _landmark_distance_pixels(
            landmarks,
            chain[idx],
            chain[idx + 1],
            image_width,
            image_height,
        )
    return total


def _ellipse_circumference(width_cm: float, depth_cm: float) -> float:
    # Pseudo-3D ellipse approximation requested for front(width)+side(depth) fusion.
    semi_width = max(width_cm * 0.5, 0.01)
    semi_depth = max(depth_cm * 0.5, 0.01)
    return math.pi * (semi_width + semi_depth)


def _landmark_confidence(landmarks: List[Any], indices: Iterable[int]) -> float:
    values: List[float] = []
    for index in indices:
        if 0 <= index < len(landmarks):
            values.append(_get_visibility(landmarks[index]))
    return _average(values)


def _downsample_contour(contour: Optional[np.ndarray], max_points: int = 320) -> List[List[float]]:
    if contour is None or contour.size == 0:
        return []
    points = contour.reshape(-1, 2)
    if len(points) > max_points:
        step = max(1, len(points) // max_points)
        points = points[::step]
    return [[float(point[0]), float(point[1])] for point in points]


def _extract_primary_contour(mask: Optional[np.ndarray]) -> Dict[str, Any]:
    if mask is None or mask.size == 0:
        return {"contour": None, "clarity": 0.0, "area_ratio": 0.0, "binary_mask": None}

    if mask.ndim > 2:
        mask = mask[:, :, 0]

    mask = np.clip(mask.astype(np.float32), 0.0, 1.0)
    binary = (mask >= SEGMENTATION_THRESHOLD).astype(np.uint8) * 255
    kernel = np.ones((3, 3), dtype=np.uint8)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=1)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel, iterations=1)

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return {"contour": None, "clarity": 0.0, "area_ratio": 0.0, "binary_mask": binary}

    contour = max(contours, key=cv2.contourArea)
    area = float(cv2.contourArea(contour))
    if area <= 20.0:
        return {"contour": None, "clarity": 0.0, "area_ratio": 0.0, "binary_mask": binary}

    contour_points = contour.reshape(-1, 2).astype(np.float32)
    sampled_points = _sample_contour_points(contour_points)
    top_y = float(np.min(contour_points[:, 1]))
    bottom_y = float(np.max(contour_points[:, 1]))

    image_area = float(binary.shape[0] * binary.shape[1])
    area_ratio = area / image_area if image_area > 0.0 else 0.0
    hull = cv2.convexHull(contour)
    hull_area = float(cv2.contourArea(hull))
    solidity = area / hull_area if hull_area > 0.0 else 0.0

    clarity = _clamp(
        (0.55 * _clamp(solidity, 0.0, 1.0)) + (0.45 * _clamp(area_ratio / 0.35, 0.0, 1.0)),
        0.0,
        1.0,
    )
    return {
        "contour": contour_points,
        "sampled_contour": sampled_points,
        "top_y": top_y,
        "bottom_y": bottom_y,
        "height_px": max(0.0, bottom_y - top_y),
        "clarity": clarity,
        "area_ratio": area_ratio,
        "binary_mask": binary,
    }


def _interpolate_missing_widths(widths: np.ndarray) -> np.ndarray:
    if widths.size == 0:
        return widths

    valid_indices = np.where(widths > 0.0)[0]
    if len(valid_indices) < 2:
        return widths

    missing_indices = np.where(widths <= 0.0)[0]
    if len(missing_indices) == 0:
        return widths

    interpolated = widths.copy()
    interpolated[missing_indices] = np.interp(missing_indices, valid_indices, widths[valid_indices])
    return interpolated


def _build_contour_profile(
    contour_info: Dict[str, Any],
    image_height: int,
    level_count: int = PROFILE_LEVEL_COUNT,
) -> Dict[str, Any]:
    contour = contour_info.get("sampled_contour")
    full_contour = contour_info.get("contour")
    if contour is None and full_contour is None:
        return {}

    if contour is None:
        contour = full_contour
    if contour is None or contour.size == 0:
        return {}

    y_values = contour[:, 1]
    top_y = float(contour_info.get("top_y", np.min(y_values)))
    bottom_y = float(contour_info.get("bottom_y", np.max(y_values)))
    if bottom_y - top_y <= 6.0:
        return {}

    levels_px = np.linspace(top_y, bottom_y, level_count)
    widths_px: List[float] = []

    for y_value in levels_px:
        width = _contour_band_width(contour, float(y_value), tolerance=3.0)
        if width <= 0.0:
            width = _contour_intersection_width(contour, float(y_value))
        if width <= 0.0 and full_contour is not None:
            width = _contour_band_width(full_contour, float(y_value), tolerance=3.0)
            if width <= 0.0:
                width = _contour_intersection_width(full_contour, float(y_value))
        widths_px.append(float(width))

    width_array = np.asarray(widths_px, dtype=np.float32)
    valid_count = int(np.sum(width_array > 0.0))
    width_array = _interpolate_missing_widths(width_array)

    if valid_count >= 3:
        width_array = gaussian_filter1d(width_array, sigma=PROFILE_SMOOTH_SIGMA, mode="nearest")

    width_array = np.maximum(width_array, 0.0)
    y_scale = max(image_height - 1, 1)
    levels_norm = np.clip(levels_px / y_scale, 0.0, 1.0)

    profile_confidence = _clamp(
        (0.65 * float(contour_info.get("clarity", 0.0))) + (0.35 * (valid_count / max(level_count, 1))),
        0.0,
        1.0,
    )
    return {
        "levels_px": [float(value) for value in levels_px],
        "levels_norm": [float(value) for value in levels_norm],
        "widths_px": [float(value) for value in width_array],
        "confidence": float(profile_confidence),
        "point_count": int(len(contour)),
    }


def _coerce_view(view: Any) -> Dict[str, Any]:
    if isinstance(view, dict):
        landmarks = list(view.get("landmarks") or [])
        mask = view.get("segmentation_mask")
        image_width = int(view.get("image_width") or 1000)
        image_height = int(view.get("image_height") or 1000)
        pose_confidence = float(view.get("pose_confidence") or 0.0)
    else:
        landmarks = list(view or [])
        mask = None
        image_width = 1000
        image_height = 1000
        pose_confidence = _landmark_confidence(landmarks, (0, 11, 12, 23, 24, 27, 28))

    raw_landmark_count = len(landmarks)
    if raw_landmark_count < 33:
        landmarks = landmarks + [{"x": 0.5, "y": 0.5, "visibility": 0.0}] * (33 - raw_landmark_count)

    if image_width <= 0:
        image_width = 1000
    if image_height <= 0:
        image_height = 1000

    if mask is not None and not isinstance(mask, np.ndarray):
        mask = np.asarray(mask)

    contour_info = _extract_primary_contour(mask)
    contour_profile = _build_contour_profile(contour_info, image_height)
    return {
        "landmarks": landmarks,
        "raw_landmark_count": raw_landmark_count,
        "mask": mask,
        "image_width": image_width,
        "image_height": image_height,
        "pose_confidence": pose_confidence,
        "contour_info": contour_info,
        "contour_profile": contour_profile,
    }


def _visible_landmark_count(landmarks: List[Any], minimum_visibility: float = 0.2) -> int:
    return sum(1 for landmark in landmarks if _get_visibility(landmark) >= minimum_visibility)


def _validate_landmarks(landmarks: List[Any]) -> bool:
    return (
        isinstance(landmarks, list)
        and len(landmarks) >= 33
        and _visible_landmark_count(landmarks, minimum_visibility=0.2) >= 10
    )


def _select_view_with_fallback(
    primary_name: str,
    primary_view: Dict[str, Any],
    fallback_views: List[Tuple[str, Dict[str, Any]]],
    warnings: List[str],
) -> Dict[str, Any]:
    if _validate_landmarks(primary_view.get("landmarks") or []):
        return primary_view

    for fallback_name, fallback_view in fallback_views:
        if _validate_landmarks(fallback_view.get("landmarks") or []):
            warnings.append(f"{primary_name.capitalize()} view was weak; estimated using {fallback_name} view.")
            return fallback_view

    warnings.append(f"{primary_name.capitalize()} view has limited landmarks; estimates may be approximate.")
    return primary_view


def _fallback_measurements_from_height(height_cm: float) -> Dict[str, float]:
    shoulder_width_cm = max(height_cm * 0.255, 30.0)
    chest_cm = max(height_cm * 0.58, 72.0)
    waist_cm = max(chest_cm * 0.84, 56.0)
    hip_circumference_cm = max(max(waist_cm * 1.10, height_cm * 0.56), 74.0)
    arm_length_cm = max(height_cm * 0.355, 45.0)
    leg_length_cm = max(height_cm * ANTHRO_LEG_RATIO, 62.0)
    neck_cm = max(chest_cm * 0.38, 30.0)
    hip_width_cm = max(hip_circumference_cm / (math.pi * 0.92), 30.0)
    torso_depth_cm = max(waist_cm / (math.pi * 2.35), 12.5)

    return {
        "shoulder_width_cm": shoulder_width_cm,
        "chest_cm": chest_cm,
        "waist_cm": waist_cm,
        "hip_width_cm": hip_width_cm,
        "hip_circumference_cm": hip_circumference_cm,
        "arm_length_cm": arm_length_cm,
        "leg_length_cm": leg_length_cm,
        "neck_cm": neck_cm,
        "torso_depth_cm": torso_depth_cm,
    }


def _height_based_measurement_ranges(height_cm: float) -> Dict[str, Tuple[float, float]]:
    h = max(float(height_cm), 120.0)
    return {
        "shoulder_width_cm": (h * 0.21, h * 0.29),
        "chest_cm": (h * 0.48, h * 0.62),
        "waist_cm": (h * 0.40, h * 0.57),
        "hip_width_cm": (h * 0.17, h * 0.28),
        "hip_circumference_cm": (h * 0.50, h * 0.64),
        "arm_length_cm": (h * 0.31, h * 0.41),
        "leg_length_cm": (h * 0.43, h * 0.53),
        "neck_cm": (h * 0.19, h * 0.25),
        "torso_depth_cm": (h * 0.07, h * 0.14),
    }


def _anthropometric_deviation_score(
    measurements: Dict[str, float],
    fallback: Dict[str, float],
) -> float:
    tracked_keys = (
        "shoulder_width_cm",
        "chest_cm",
        "waist_cm",
        "hip_circumference_cm",
        "arm_length_cm",
        "leg_length_cm",
        "neck_cm",
    )
    deviations: List[float] = []
    for key in tracked_keys:
        baseline = max(float(fallback.get(key, 0.0)), 1e-6)
        value = float(measurements.get(key, baseline) or baseline)
        ratio = value / baseline
        if ratio > 1.12:
            deviations.append(ratio - 1.12)
        elif ratio < 0.82:
            deviations.append(0.82 - ratio)
        else:
            deviations.append(0.0)
    return _clamp(_average(deviations) * 1.9, 0.0, 0.6)


def _enforce_proportional_consistency(measurements: Dict[str, float], warnings: List[str]) -> None:
    shoulder = float(measurements.get("shoulder_width_cm", 0.0) or 0.0)
    chest = float(measurements.get("chest_cm", 0.0) or 0.0)
    waist = float(measurements.get("waist_cm", 0.0) or 0.0)
    hip_circ = float(measurements.get("hip_circumference_cm", 0.0) or 0.0)
    neck = float(measurements.get("neck_cm", 0.0) or 0.0)

    updated = False

    if shoulder > 0.0 and chest > 0.0:
        chest_min = shoulder * 1.85
        chest_max = shoulder * 2.30
        corrected = _clamp(chest, chest_min, chest_max)
        if abs(corrected - chest) > 0.05:
            measurements["chest_cm"] = corrected
            chest = corrected
            updated = True

    if chest > 0.0 and waist > 0.0:
        waist_min = chest * 0.78
        waist_max = chest * 0.94
        corrected = _clamp(waist, waist_min, waist_max)
        if abs(corrected - waist) > 0.05:
            measurements["waist_cm"] = corrected
            waist = corrected
            updated = True

    if chest > 0.0 and hip_circ > 0.0:
        hip_min = max(waist * 1.03 if waist > 0.0 else chest * 0.92, chest * 0.92)
        hip_max = chest * 1.10
        corrected = _clamp(hip_circ, hip_min, hip_max)
        if abs(corrected - hip_circ) > 0.05:
            measurements["hip_circumference_cm"] = corrected
            hip_circ = corrected
            updated = True

    if shoulder > 0.0 and neck > 0.0:
        neck_min = shoulder * 0.70
        neck_max = shoulder * 0.84
        corrected = _clamp(neck, neck_min, neck_max)
        if abs(corrected - neck) > 0.05:
            measurements["neck_cm"] = corrected
            updated = True

    if updated:
        warnings.append("Body proportion consistency correction was applied.")


def _correct_torso_underestimation(measurements: Dict[str, float], warnings: List[str]) -> None:
    chest = float(measurements.get("chest_cm", 0.0) or 0.0)
    waist = float(measurements.get("waist_cm", 0.0) or 0.0)
    hip = float(measurements.get("hip_circumference_cm", 0.0) or 0.0)

    if chest <= 0.0 or waist <= 0.0:
        return

    waist_floor = chest * 0.87
    if hip > 0.0:
        waist_floor = max(waist_floor, hip * 0.88)

    if waist < waist_floor * 0.97:
        corrected_waist = max(waist * 0.12 + waist_floor * 0.88, waist_floor * 0.995)
        measurements["waist_cm"] = corrected_waist
        waist = corrected_waist
        warnings.append("Waist estimate was corrected for torso under-segmentation.")

    if hip > 0.0:
        hip_floor = max(waist * 1.03, chest * 0.94)
        if hip < hip_floor * 0.96:
            corrected_hip = max(hip * 0.14 + hip_floor * 0.86, hip_floor * 0.992)
            measurements["hip_circumference_cm"] = corrected_hip
            warnings.append("Hip estimate was corrected for torso under-segmentation.")


def _apply_final_measurement_bias_correction(
    measurements: Dict[str, float],
    height_cm: float,
    warnings: List[str],
) -> None:
    shoulder = float(measurements.get("shoulder_width_cm", 0.0) or 0.0)
    chest = float(measurements.get("chest_cm", 0.0) or 0.0)
    arm = float(measurements.get("arm_length_cm", 0.0) or 0.0)
    leg = float(measurements.get("leg_length_cm", 0.0) or 0.0)

    adjusted = False

    if shoulder > 0.0 and chest > 0.0:
        shoulder_target = (chest / 2.24) * 0.5 + (height_cm * 0.248) * 0.5
        corrected_shoulder = _clamp(shoulder, shoulder_target * 0.95, shoulder_target * 1.05)
        if abs(corrected_shoulder - shoulder) > 0.05:
            measurements["shoulder_width_cm"] = corrected_shoulder
            shoulder = corrected_shoulder
            adjusted = True

    if arm > 0.0:
        arm_target = (height_cm * 0.355) * 0.82 + (max(shoulder, 1.0) * 1.24) * 0.18
        corrected_arm = _clamp((arm * 0.62) + (arm_target * 0.38), height_cm * 0.34, height_cm * 0.365)
        if abs(corrected_arm - arm) > 0.05:
            measurements["arm_length_cm"] = corrected_arm
            adjusted = True

    if leg > 0.0:
        # Raw hip-knee-ankle path tends to approximate outseam; normalize to inseam-like estimate.
        inseam_estimate = leg * 0.88
        corrected_leg = _clamp(inseam_estimate, height_cm * 0.445, height_cm * 0.47)
        if abs(corrected_leg - leg) > 0.05:
            measurements["leg_length_cm"] = corrected_leg
            adjusted = True

    if adjusted:
        warnings.append("Final anthropometric bias correction was applied.")


def _stabilize_measurements_with_priors(
    measurements: Dict[str, float],
    height_cm: float,
    quality_score: float,
    warnings: List[str],
) -> None:
    fallback = _fallback_measurements_from_height(height_cm)
    ranges = _height_based_measurement_ranges(height_cm)
    quality_blend = _clamp((0.90 - quality_score) / 0.56, 0.0, 0.50)
    deviation_blend = _anthropometric_deviation_score(measurements, fallback)
    blend = max(quality_blend, deviation_blend)

    if blend <= 0.0:
        return

    for key in RAW_METRIC_KEYS:
        current = float(measurements.get(key, fallback[key]) or fallback[key])
        target = float(fallback[key])
        blended = (current * (1.0 - blend)) + (target * blend)
        minimum, maximum = ranges[key]
        measurements[key] = _clamp(blended, minimum, maximum)

    # Keep torso relationships physically plausible.
    measurements["waist_cm"] = min(measurements["waist_cm"], measurements["chest_cm"] * 0.98)
    measurements["hip_circumference_cm"] = max(measurements["hip_circumference_cm"], measurements["waist_cm"] * 1.02)
    measurements["neck_cm"] = _clamp(measurements["neck_cm"], measurements["chest_cm"] * 0.27, measurements["chest_cm"] * 0.45)

    if blend > 0.01:
        warnings.append("Low-confidence geometry was stabilized with body-proportion priors.")


def _fill_missing_measurements(measurements: Dict[str, float], height_cm: float, warnings: List[str]) -> None:
    fallback = _fallback_measurements_from_height(height_cm)
    used_ratio_fallback = False

    for key in RAW_METRIC_KEYS:
        value = float(measurements.get(key, 0.0) or 0.0)
        if not math.isfinite(value) or value <= 0.0:
            measurements[key] = fallback[key]
            used_ratio_fallback = True

    if measurements["waist_cm"] <= 0.0 and measurements["chest_cm"] > 0.0:
        measurements["waist_cm"] = measurements["chest_cm"] * 0.85
        used_ratio_fallback = True
    if measurements["hip_circumference_cm"] <= 0.0 and measurements["waist_cm"] > 0.0:
        measurements["hip_circumference_cm"] = measurements["waist_cm"] * 1.05
        used_ratio_fallback = True
    if measurements["neck_cm"] <= 0.0 and measurements["chest_cm"] > 0.0:
        measurements["neck_cm"] = measurements["chest_cm"] * 0.36
        used_ratio_fallback = True

    if measurements["chest_cm"] <= 0.0:
        measurements["chest_cm"] = max(height_cm * 0.53, 70.0)
        used_ratio_fallback = True
    if measurements["waist_cm"] <= 0.0:
        measurements["waist_cm"] = measurements["chest_cm"] * 0.85
        used_ratio_fallback = True
    if measurements["hip_circumference_cm"] <= 0.0:
        measurements["hip_circumference_cm"] = measurements["waist_cm"] * 1.05
        used_ratio_fallback = True
    if measurements["shoulder_width_cm"] <= 0.0:
        measurements["shoulder_width_cm"] = max(height_cm * 0.25, 30.0)
        used_ratio_fallback = True

    if used_ratio_fallback:
        warnings.append("Some body parts not fully detected; estimated using body ratios.")


def _contour_intersection_width(contour: np.ndarray, y_value: float) -> float:
    intersections: List[float] = []
    if contour is None or contour.size == 0:
        return 0.0

    point_count = len(contour)
    for index in range(point_count):
        x1, y1 = contour[index]
        x2, y2 = contour[(index + 1) % point_count]

        if y1 == y2:
            if abs(y_value - y1) < 0.75:
                intersections.extend([float(x1), float(x2)])
            continue

        if y_value < min(y1, y2) or y_value > max(y1, y2):
            continue

        ratio = (y_value - y1) / (y2 - y1)
        intersections.append(float(x1 + (ratio * (x2 - x1))))

    if len(intersections) < 2:
        return 0.0

    intersections.sort()
    return max(0.0, intersections[-1] - intersections[0])


def _contour_band_width(contour: Optional[np.ndarray], y_value: float, tolerance: float = 3.0) -> float:
    if contour is None or contour.size == 0:
        return 0.0

    points = contour.reshape(-1, 2)
    if points.size == 0:
        return 0.0

    band = points[np.abs(points[:, 1] - y_value) <= tolerance]
    if len(band) < 2:
        return 0.0

    xs = band[:, 0]
    return float(max(xs) - min(xs))


def _profile_width_pixels(view: Dict[str, Any], y_norm: float) -> Tuple[float, float]:
    profile = view.get("contour_profile") or {}
    levels_norm = np.asarray(profile.get("levels_norm") or [], dtype=np.float32)
    widths_px = np.asarray(profile.get("widths_px") or [], dtype=np.float32)

    if levels_norm.size < 2 or widths_px.size < 2:
        return 0.0, 0.0

    y_target = float(_clamp(y_norm, 0.0, 1.0))
    width = float(np.interp(y_target, levels_norm, widths_px))
    if width <= 0.0:
        return 0.0, 0.0

    top_level = float(levels_norm[0])
    bottom_level = float(levels_norm[-1])
    range_factor = 1.0 if top_level <= y_target <= bottom_level else 0.65
    confidence = _clamp(float(profile.get("confidence", 0.0)) * range_factor, 0.0, 1.0)
    return width, confidence


def _contour_width_pixels(view: Dict[str, Any], y_norm: float) -> Tuple[float, float]:
    contour_info = view.get("contour_info") or {}
    contour = contour_info.get("contour")
    if contour is None:
        return 0.0, 0.0

    image_height = view["image_height"]
    y_center = _clamp(y_norm, 0.0, 1.0) * max(image_height - 1, 1)
    offsets = (-4.0, -2.0, 0.0, 2.0, 4.0)

    widths: List[float] = []
    for offset in offsets:
        width = _contour_band_width(contour, y_center + offset, tolerance=3.0)
        if width <= 0.0:
            width = _contour_intersection_width(contour, y_center + offset)
        if width > 0.0:
            widths.append(width)

    if not widths:
        return 0.0, 0.0

    coverage = len(widths) / float(len(offsets))
    contour_clarity = float(contour_info.get("clarity", 0.0))
    confidence = _clamp((0.7 * contour_clarity) + (0.3 * coverage), 0.0, 1.0)
    return _median(widths), confidence


def _mask_width_pixels(mask: Optional[np.ndarray], y_norm: float) -> Tuple[float, float]:
    if mask is None or mask.size == 0:
        return 0.0, 0.0

    if mask.ndim > 2:
        mask = mask[:, :, 0]

    height, width = mask.shape[:2]
    center_row = int(_clamp(y_norm, 0.0, 1.0) * max(height - 1, 1))
    row_padding = max(1, int(height * 0.015))
    min_row = max(0, center_row - row_padding)
    max_row = min(height - 1, center_row + row_padding)

    widths: List[float] = []
    confidences: List[float] = []
    for row in range(min_row, max_row + 1):
        row_values = mask[row, :]
        body_indices = np.where(row_values >= SEGMENTATION_THRESHOLD)[0]
        if body_indices.size < 2:
            continue
        widths.append(float(body_indices[-1] - body_indices[0]))
        confidences.append(float(np.mean(row_values[body_indices])))

    if not widths:
        return 0.0, 0.0

    row_coverage = len(widths) / float((max_row - min_row + 1) or 1)
    confidence = _clamp((0.7 * _average(confidences)) + (0.3 * row_coverage), 0.0, 1.0)
    return _median(widths), confidence


def _weighted_fusion(values: List[Tuple[float, float]], fallback: float = 0.0) -> Tuple[float, float]:
    weighted_sum = 0.0
    total_weight = 0.0
    for value, weight in values:
        if value > 0.0 and weight > 0.0:
            weighted_sum += value * weight
            total_weight += weight

    if total_weight <= 0.0:
        return fallback, 0.0

    return weighted_sum / total_weight, _clamp(total_weight / len(values), 0.0, 1.0)


def _weighted_scale(values: List[Tuple[float, float]]) -> float:
    valid = [(value, weight) for value, weight in values if value > 0.0 and weight > 0.0]
    if not valid:
        return 0.0

    med = _median([value for value, _ in valid])
    if med <= 0.0:
        med = _average([value for value, _ in valid])

    filtered = []
    for value, weight in valid:
        if med > 0.0 and abs(value - med) / med > 0.35:
            continue
        filtered.append((value, weight))
    if not filtered:
        filtered = valid

    numerator = sum(value * weight for value, weight in filtered)
    denominator = sum(weight for _, weight in filtered)
    if denominator <= 0.0:
        return 0.0
    return numerator / denominator


def _body_height_pixels(view: Dict[str, Any]) -> float:
    landmarks = view["landmarks"]
    image_height = view["image_height"]
    head_indices = (0, 1, 2, 3, 4, 7, 8, 9, 10)
    foot_indices = (27, 28, 29, 30, 31, 32)

    visible_head_y = [
        _get_xy(landmarks[index])[1]
        for index in head_indices
        if index < len(landmarks) and _get_visibility(landmarks[index]) >= 0.2
    ]
    visible_foot_y = [
        _get_xy(landmarks[index])[1]
        for index in foot_indices
        if index < len(landmarks) and _get_visibility(landmarks[index]) >= 0.2
    ]

    if not visible_head_y or not visible_foot_y:
        return 0.0

    return max(0.0, (max(visible_foot_y) - min(visible_head_y)) * image_height)


def _contour_height_pixels(view: Dict[str, Any]) -> float:
    contour_info = view.get("contour_info") or {}
    explicit_height = float(contour_info.get("height_px", 0.0) or 0.0)
    if explicit_height > 0.0:
        return explicit_height

    contour = contour_info.get("contour")
    if contour is None or contour.size == 0:
        return 0.0

    y_values = contour[:, 1]
    return max(0.0, float(np.max(y_values) - np.min(y_values)))


def _torso_ratio(view: Dict[str, Any]) -> float:
    landmarks = view["landmarks"]
    width = view["image_width"]
    height = view["image_height"]

    left = _landmark_distance_pixels(landmarks, 11, 23, width, height)
    right = _landmark_distance_pixels(landmarks, 12, 24, width, height)
    torso_px = _average([value for value in (left, right) if value > 0.0])
    return torso_px / max(height, 1)


def _distance_score(torso_ratio: float) -> float:
    if torso_ratio <= 0.0:
        return 0.0
    if torso_ratio < DISTANCE_MIN_TORSO_RATIO or torso_ratio > DISTANCE_MAX_TORSO_RATIO:
        return 0.0
    deviation = abs(torso_ratio - TARGET_TORSO_RATIO) / max(TARGET_TORSO_RATIO, 1e-6)
    return _clamp(1.0 - (deviation * 1.35), 0.0, 1.0)


def _posture_score(front: Dict[str, Any]) -> Tuple[float, bool]:
    landmarks = front["landmarks"]
    shoulder_tilt = abs(_get_xy(landmarks[11])[1] - _get_xy(landmarks[12])[1])
    hip_tilt = abs(_get_xy(landmarks[23])[1] - _get_xy(landmarks[24])[1])

    shoulder_center_x = _average([_get_xy(landmarks[11])[0], _get_xy(landmarks[12])[0]])
    hip_center_x = _average([_get_xy(landmarks[23])[0], _get_xy(landmarks[24])[0]])
    ankle_center_x = _average([_get_xy(landmarks[27])[0], _get_xy(landmarks[28])[0]])
    vertical_deviation = max(abs(shoulder_center_x - hip_center_x), abs(hip_center_x - ankle_center_x))

    ankle_visibility = _landmark_confidence(landmarks, (27, 28, 31, 32))
    legs_in_frame = max(_get_xy(landmarks[27])[1], _get_xy(landmarks[28])[1]) >= 0.86

    score = _clamp(
        1.0
        - (shoulder_tilt / 0.11)
        - (hip_tilt / 0.11)
        - (vertical_deviation / 0.20)
        + (ankle_visibility * 0.2),
        0.0,
        1.0,
    )

    hard_fail = (
        shoulder_tilt > MAX_TILT_DELTA
        or hip_tilt > MAX_TILT_DELTA
        or vertical_deviation > 0.09
        or ankle_visibility < 0.5
        or not legs_in_frame
    )
    return score, hard_fail


def _midpoint(point_a: Tuple[float, float], point_b: Tuple[float, float]) -> Tuple[float, float]:
    return ((point_a[0] + point_b[0]) * 0.5, (point_a[1] + point_b[1]) * 0.5)


def _interpolate_point(
    point_a: Tuple[float, float],
    point_b: Tuple[float, float],
    ratio: float,
) -> Tuple[float, float]:
    r = _clamp(float(ratio), 0.0, 1.0)
    return (
        (point_a[0] * (1.0 - r)) + (point_b[0] * r),
        (point_a[1] * (1.0 - r)) + (point_b[1] * r),
    )


def _interpolated_pair_width_pixels(
    landmarks: List[Any],
    left_start_index: int,
    left_end_index: int,
    right_start_index: int,
    right_end_index: int,
    ratio: float,
    image_width: int,
) -> float:
    required_indices = (left_start_index, left_end_index, right_start_index, right_end_index)
    if any(index >= len(landmarks) or index < 0 for index in required_indices):
        return 0.0

    left_start = _get_xy(landmarks[left_start_index])
    left_end = _get_xy(landmarks[left_end_index])
    right_start = _get_xy(landmarks[right_start_index])
    right_end = _get_xy(landmarks[right_end_index])

    left_point = _interpolate_point(left_start, left_end, ratio)
    right_point = _interpolate_point(right_start, right_end, ratio)
    return abs(float(right_point[0]) - float(left_point[0])) * image_width


def _torso_center_x_normalized(landmarks: List[Any], y_norm: float) -> float:
    if len(landmarks) <= 24:
        return 0.5

    left_shoulder = _get_xy(landmarks[11])
    right_shoulder = _get_xy(landmarks[12])
    left_hip = _get_xy(landmarks[23])
    right_hip = _get_xy(landmarks[24])

    shoulder_mid = _midpoint(left_shoulder, right_shoulder)
    hip_mid = _midpoint(left_hip, right_hip)
    shoulder_y = shoulder_mid[1]
    hip_y = hip_mid[1]

    if abs(hip_y - shoulder_y) <= 1e-6:
        return _clamp(shoulder_mid[0], 0.0, 1.0)

    ratio = _clamp((float(y_norm) - shoulder_y) / (hip_y - shoulder_y), 0.0, 1.0)
    center_x = (shoulder_mid[0] * (1.0 - ratio)) + (hip_mid[0] * ratio)
    return _clamp(center_x, 0.0, 1.0)


def _mask_core_width_pixels(
    mask: Optional[np.ndarray],
    y_norm: float,
    center_x_norm: float,
    max_half_width_px: float,
) -> Tuple[float, float]:
    if mask is None or mask.size == 0:
        return 0.0, 0.0

    if mask.ndim > 2:
        mask = mask[:, :, 0]

    height, width = mask.shape[:2]
    center_row = int(_clamp(y_norm, 0.0, 1.0) * max(height - 1, 1))
    center_x = int(_clamp(center_x_norm, 0.0, 1.0) * max(width - 1, 1))
    half_limit = max(0, int(max_half_width_px))

    row_padding = max(1, int(height * 0.015))
    min_row = max(0, center_row - row_padding)
    max_row = min(height - 1, center_row + row_padding)

    widths: List[float] = []
    confidences: List[float] = []

    for row in range(min_row, max_row + 1):
        row_values = mask[row, :]
        body_indices = np.where(row_values >= SEGMENTATION_THRESHOLD)[0]
        if body_indices.size < 2:
            continue

        runs: List[Tuple[int, int]] = []
        start = int(body_indices[0])
        previous = int(body_indices[0])
        for raw_index in body_indices[1:]:
            current = int(raw_index)
            if current == previous + 1:
                previous = current
                continue
            runs.append((start, previous))
            start = current
            previous = current
        runs.append((start, previous))

        containing_runs = [run for run in runs if run[0] <= center_x <= run[1]]
        if containing_runs:
            left, right = max(containing_runs, key=lambda run: run[1] - run[0])
        else:
            left, right = min(runs, key=lambda run: abs(((run[0] + run[1]) * 0.5) - center_x))

        if half_limit > 0:
            left = max(left, center_x - half_limit)
            right = min(right, center_x + half_limit)

        if right - left < 2:
            continue

        segment = row_values[left:right + 1]
        widths.append(float(right - left))
        confidences.append(float(np.mean(segment)) if segment.size > 0 else 0.0)

    if not widths:
        return 0.0, 0.0

    coverage = len(widths) / float((max_row - min_row + 1) or 1)
    confidence = _clamp((0.72 * _average(confidences)) + (0.28 * coverage), 0.0, 1.0)
    return _median(widths), confidence


def _interpolated_anchors(landmarks: List[Any]) -> Dict[str, Tuple[float, float]]:
    left_shoulder = _get_xy(landmarks[11])
    right_shoulder = _get_xy(landmarks[12])
    left_hip = _get_xy(landmarks[23])
    right_hip = _get_xy(landmarks[24])
    left_knee = _get_xy(landmarks[25])
    right_knee = _get_xy(landmarks[26])

    mid_shoulder = _midpoint(left_shoulder, right_shoulder)
    mid_hip = _midpoint(left_hip, right_hip)
    mid_torso = _midpoint(mid_shoulder, mid_hip)
    mid_knee = _midpoint(left_knee, right_knee)
    mid_thigh = _midpoint(mid_hip, mid_knee)
    upper_torso = _interpolate_point(mid_shoulder, mid_hip, 0.3)
    lower_torso = _interpolate_point(mid_shoulder, mid_hip, 0.7)

    return {
        "shoulder_mid": mid_shoulder,
        "torso_mid": mid_torso,
        "hip_mid": mid_hip,
        "thigh_mid": mid_thigh,
        "upper_torso": upper_torso,
        "lower_torso": lower_torso,
        "mid_shoulder": mid_shoulder,
        "mid_hip": mid_hip,
        "mid_torso": mid_torso,
        "mid_thigh": mid_thigh,
    }


def _shoulder_span_normalized(landmarks: List[Any]) -> float:
    if len(landmarks) <= 12:
        return 0.0
    left_x, _ = _get_xy(landmarks[11])
    right_x, _ = _get_xy(landmarks[12])
    return abs(float(left_x) - float(right_x))


def _estimate_side_orientation(
    front_landmarks: List[Any],
    side_landmarks: List[Any],
) -> Tuple[float, float, float]:
    front_span = _shoulder_span_normalized(front_landmarks)
    side_span = _shoulder_span_normalized(side_landmarks)

    if front_span <= 1e-6 or side_span <= 0.0:
        cos_theta = 0.12
    else:
        cos_theta = _clamp(side_span / front_span, 0.0, SIDE_ORIENTATION_MAX_COS)

    sin_theta = math.sqrt(max(0.0, 1.0 - (cos_theta * cos_theta)))
    sin_theta = max(sin_theta, SIDE_ORIENTATION_MIN_SIN)
    return cos_theta, sin_theta, side_span


def _perspective_corrected_depth(
    observed_depth_px: float,
    frontal_width_px: float,
    fallback_depth_px: float,
    side_turn_cos: float,
    side_turn_sin: float,
) -> float:
    observed = float(observed_depth_px if observed_depth_px > 0.0 else fallback_depth_px)
    if observed <= 0.0:
        return 0.0

    if frontal_width_px <= 0.0:
        return observed

    deprojected = (observed - (frontal_width_px * side_turn_cos)) / max(side_turn_sin, SIDE_ORIENTATION_MIN_SIN)
    if not math.isfinite(deprojected) or deprojected <= 0.0:
        deprojected = observed * 0.72

    correction_strength = _clamp((side_turn_cos - 0.14) / 0.56, 0.0, 1.0)
    corrected = (observed * (1.0 - correction_strength)) + (deprojected * correction_strength)

    floor_value = fallback_depth_px * 0.58 if fallback_depth_px > 0.0 else 0.0
    return max(float(corrected), float(floor_value))


def _measurement_confidence_score(landmark_visibility_score: float, silhouette_quality_score: float, posture_score: float) -> float:
    return _clamp(
        (0.4 * landmark_visibility_score) + (0.4 * silhouette_quality_score) + (0.2 * posture_score),
        0.0,
        1.0,
    )


def _ui_measurements_from_raw(measurements: Dict[str, float]) -> Dict[str, float]:
    return {
        "shoulder": round(float(measurements.get("shoulder_width_cm", 0.0)), 2),
        "chest": round(float(measurements.get("chest_cm", 0.0)), 2),
        "waist": round(float(measurements.get("waist_cm", 0.0)), 2),
        "hip": round(float(measurements.get("hip_circumference_cm", measurements.get("hip_width_cm", 0.0))), 2),
        "arm": round(float(measurements.get("arm_length_cm", 0.0)), 2),
        "leg": round(float(measurements.get("leg_length_cm", 0.0)), 2),
        "neck": round(float(measurements.get("neck_cm", 0.0)), 2),
    }


def _view_width_estimate(
    view: Dict[str, Any],
    y_norm: float,
    fallback_landmark_pair: Optional[Tuple[int, int]] = None,
) -> Tuple[float, float, float]:
    profile_width, profile_conf = _profile_width_pixels(view, y_norm)
    contour_width, contour_conf = _contour_width_pixels(view, y_norm)
    mask_width, mask_conf = _mask_width_pixels(view.get("mask"), y_norm)

    landmark_width = 0.0
    landmark_conf = 0.0
    if fallback_landmark_pair is not None:
        landmark_width = _landmark_distance_pixels(
            view["landmarks"],
            fallback_landmark_pair[0],
            fallback_landmark_pair[1],
            view["image_width"],
            view["image_height"],
        )
        landmark_conf = 0.35 if landmark_width > 0.0 else 0.0

    width_px, fusion_conf = _weighted_fusion(
        [
            (profile_width, profile_conf * 1.45),
            (contour_width, contour_conf * 1.2),
            (mask_width, mask_conf * 0.95),
            (landmark_width, landmark_conf * 0.6),
        ],
        fallback=max(profile_width, contour_width, mask_width, landmark_width),
    )

    silhouette_clarity = _clamp(
        _average([
            profile_conf,
            contour_conf,
            mask_conf,
            float((view.get("contour_info") or {}).get("clarity", 0.0)),
        ]),
        0.0,
        1.0,
    )
    return width_px, fusion_conf, silhouette_clarity


def _metric_detail(
    value: float,
    confidence: float,
    method: str,
    landmark_confidence: float,
    silhouette_clarity: float,
    posture_score: float,
) -> Dict[str, float | str]:
    return {
        "value": round(float(value), 2),
        "confidence": round(_clamp(confidence, 0.0, 1.0), 3),
        "method": method,
        "landmark_confidence": round(_clamp(landmark_confidence, 0.0, 1.0), 3),
        "silhouette_clarity": round(_clamp(silhouette_clarity, 0.0, 1.0), 3),
        "posture_score": round(_clamp(posture_score, 0.0, 1.0), 3),
    }


def _validate_outliers(measurements: Dict[str, float], warnings: List[str]) -> None:
    ranges = {
        "shoulder_width_cm": (28.0, 58.0),
        "chest_cm": (60.0, 125.0),
        "waist_cm": (45.0, 110.0),
        "hip_width_cm": (28.0, 55.0),
        "hip_circumference_cm": (70.0, 130.0),
        "arm_length_cm": (40.0, 90.0),
        "leg_length_cm": (55.0, 105.0),
        "neck_cm": (25.0, 47.0),
        "torso_depth_cm": (10.0, 28.0),
    }

    for key, (minimum, maximum) in ranges.items():
        value = float(measurements.get(key, 0.0) or 0.0)
        if value <= 0.0:
            continue

        clamped = _clamp(value, minimum, maximum)
        if abs(clamped - value) > 0.01:
            measurements[key] = clamped
            warnings.append("Some measurements were adjusted due to low scan quality.")

    if measurements["waist_cm"] > measurements["chest_cm"]:
        measurements["waist_cm"] = min(measurements["waist_cm"], measurements["chest_cm"] * 0.96)
        warnings.append("Waist estimate was corrected from partial scan data.")


def calculate_measurements(front_landmarks, side_landmarks, back_landmarks, height_cm):
    warnings: List[str] = []

    try:
        parsed_height = float(height_cm)
    except (TypeError, ValueError):
        parsed_height = 170.0
        warnings.append("Invalid height input; using default 170 cm.")

    if not math.isfinite(parsed_height) or parsed_height <= 0.0:
        parsed_height = 170.0
        warnings.append("Invalid height input; using default 170 cm.")

    if parsed_height < 120.0 or parsed_height > 230.0:
        warnings.append("Height outside expected range; calibration was clamped.")
    height_cm = _clamp(parsed_height, 120.0, 230.0)

    front_raw = _coerce_view(front_landmarks)
    side_raw = _coerce_view(side_landmarks)
    back_raw = _coerce_view(back_landmarks)

    def _build_fallback_response(base_warnings: List[str], confidence_score: float = 0.55) -> Dict[str, Any]:
        fallback_measurements = _fallback_measurements_from_height(height_cm)
        _fill_missing_measurements(fallback_measurements, height_cm, base_warnings)
        _validate_outliers(fallback_measurements, base_warnings)

        ui_measurements = _ui_measurements_from_raw(fallback_measurements)
        confidence_score = _clamp(confidence_score, 0.0, 1.0)
        fallback_confidences = {
            "shoulder": confidence_score,
            "chest": confidence_score,
            "waist": confidence_score,
            "hip": confidence_score,
            "arm": confidence_score,
            "leg": confidence_score,
            "neck": confidence_score,
            "overall": confidence_score,
        }

        fallback_details = {
            "shoulder": _metric_detail(fallback_measurements["shoulder_width_cm"], confidence_score, "ratio fallback", confidence_score, confidence_score, 0.5),
            "chest": _metric_detail(fallback_measurements["chest_cm"], confidence_score, "ratio fallback", confidence_score, confidence_score, 0.5),
            "waist": _metric_detail(fallback_measurements["waist_cm"], confidence_score, "ratio fallback", confidence_score, confidence_score, 0.5),
            "hip": _metric_detail(fallback_measurements["hip_circumference_cm"], confidence_score, "ratio fallback", confidence_score, confidence_score, 0.5),
            "arm": _metric_detail(fallback_measurements["arm_length_cm"], confidence_score, "ratio fallback", confidence_score, confidence_score, 0.5),
            "leg": _metric_detail(fallback_measurements["leg_length_cm"], confidence_score, "ratio fallback", confidence_score, confidence_score, 0.5),
            "neck": _metric_detail(fallback_measurements["neck_cm"], confidence_score, "ratio fallback", confidence_score, confidence_score, 0.5),
        }

        normalized_contours = {
            "front": _downsample_contour((front_raw.get("contour_info") or {}).get("contour")),
            "side": _downsample_contour((side_raw.get("contour_info") or {}).get("contour")),
            "back": _downsample_contour((back_raw.get("contour_info") or {}).get("contour")),
        }

        response: Dict[str, Any] = {
            "measurements": ui_measurements,
            "confidence": {key: round(value, 3) for key, value in fallback_confidences.items()},
            "confidence_score": round(confidence_score, 3),
            "quality_score": round(confidence_score, 3),
            "warnings": list(dict.fromkeys(base_warnings)),
            "measurement_details": fallback_details,
            "pixel_to_cm": 0.0,
            "scale_components": {
                "height_scale": 0.0,
                "width_scale": 0.0,
                "leg_scale": 0.0,
                "distance_normalization": 1.0,
            },
            "scan_artifacts": {
                "contours": normalized_contours,
                "silhouette_clarity": 0.0,
                "posture_score": 0.5,
                "distance_score": 0.5,
            },
        }

        for key in RAW_METRIC_KEYS:
            response[key] = round(float(fallback_measurements[key]), 2)

        return response

    try:
        view_validity = {
            "front": _validate_landmarks(front_raw["landmarks"]),
            "side": _validate_landmarks(side_raw["landmarks"]),
            "back": _validate_landmarks(back_raw["landmarks"]),
        }

        if not any(view_validity.values()):
            warnings.append("Scan not perfect, using estimation.")
            warnings.append("No reliable landmark set was fully detected.")
            return _build_fallback_response(warnings, confidence_score=0.5)

        if not view_validity["front"]:
            warnings.append("Front view landmarks were incomplete.")
        if not view_validity["side"]:
            warnings.append("Side view landmarks were incomplete.")
        if not view_validity["back"]:
            warnings.append("Back view landmarks were incomplete.")

        required_indices = (11, 12, 23, 24, 25, 26, 27, 28)
        for view_name, view in (("front", front_raw), ("side", side_raw), ("back", back_raw)):
            if _landmark_confidence(view["landmarks"], required_indices) < VISIBILITY_THRESHOLD:
                warnings.append(f"{view_name.capitalize()} view confidence is low.")

        front = _select_view_with_fallback("front", front_raw, [("back", back_raw), ("side", side_raw)], warnings)
        side = _select_view_with_fallback("side", side_raw, [("front", front_raw), ("back", back_raw)], warnings)
        back = _select_view_with_fallback("back", back_raw, [("front", front_raw), ("side", side_raw)], warnings)

        posture_score, posture_failed = _posture_score(front)
        if posture_failed:
            warnings.append("Posture not ideal.")

        torso_ratio_values = [value for value in (_torso_ratio(front), _torso_ratio(back), _torso_ratio(side)) if value > 0.0]
        torso_ratio = _average(torso_ratio_values)
        if torso_ratio <= 0.0:
            torso_ratio = TARGET_TORSO_RATIO
            warnings.append("Camera distance estimate unavailable; using default ratio.")

        distance_score = _distance_score(torso_ratio)
        if distance_score <= 0.0:
            distance_score = 0.4
            warnings.append("Camera distance not ideal; using estimation.")

        front_height_px = _body_height_pixels(front)
        back_height_px = _body_height_pixels(back)
        side_height_px = _body_height_pixels(side)

        front_contour_height_px = _contour_height_pixels(front)
        back_contour_height_px = _contour_height_pixels(back)
        side_contour_height_px = _contour_height_pixels(side)

        contour_height_px = max(front_contour_height_px, back_contour_height_px, side_contour_height_px)
        landmark_height_px = max(front_height_px, back_height_px, side_height_px)
        pixel_height = max(contour_height_px, landmark_height_px)
        if pixel_height <= 0.0:
            pixel_height = max(float(front["image_height"]) * 0.78, 1.0)
            warnings.append("Body height landmarks were incomplete; using approximate pixel height.")

        min_height_threshold = float(front["image_height"]) * 0.55
        max_height_threshold = float(front["image_height"]) * 0.92
        if pixel_height < min_height_threshold:
            warnings.append("Move closer to camera for higher accuracy.")
            distance_score = min(distance_score, 0.45)
        elif pixel_height > max_height_threshold:
            warnings.append("Move back slightly for higher accuracy.")
            distance_score = min(distance_score, 0.45)

        if contour_height_px <= 0.0:
            contour_height_px = landmark_height_px
            if contour_height_px > 0.0:
                warnings.append("Contour height was weak; used landmark height fallback.")

        front_landmarks_data = front["landmarks"]
        back_landmarks_data = back["landmarks"]
        side_landmarks_data = side["landmarks"]
        anchors = _interpolated_anchors(front_landmarks_data)

        shoulder_anchor_px = _average(
            [
                _landmark_distance_pixels(front_landmarks_data, 11, 12, front["image_width"], front["image_height"]),
                _landmark_distance_pixels(back_landmarks_data, 11, 12, back["image_width"], back["image_height"]),
            ]
        )
        hip_anchor_px = _average(
            [
                _landmark_distance_pixels(front_landmarks_data, 23, 24, front["image_width"], front["image_height"]),
                _landmark_distance_pixels(back_landmarks_data, 23, 24, back["image_width"], back["image_height"]),
            ]
        )
        leg_anchor_px = _average(
            [
                _segment_chain_length_pixels(front_landmarks_data, [23, 25, 27], front["image_width"], front["image_height"]),
                _segment_chain_length_pixels(front_landmarks_data, [24, 26, 28], front["image_width"], front["image_height"]),
                _segment_chain_length_pixels(back_landmarks_data, [23, 25, 27], back["image_width"], back["image_height"]),
                _segment_chain_length_pixels(back_landmarks_data, [24, 26, 28], back["image_width"], back["image_height"]),
            ]
        )

        expected_shoulder_cm = height_cm * ANTHRO_SHOULDER_RATIO
        contour_height_scale = height_cm / max(contour_height_px, 1.0)
        landmark_height_scale = height_cm / max(landmark_height_px, 1.0) if landmark_height_px > 0.0 else 0.0
        height_scale = contour_height_scale if contour_height_scale > 0.0 else landmark_height_scale
        if landmark_height_scale > 0.0 and contour_height_scale > 0.0:
            height_scale = (contour_height_scale * 0.8) + (landmark_height_scale * 0.2)

        shoulder_scale = expected_shoulder_cm / shoulder_anchor_px if shoulder_anchor_px > 0.0 else 0.0
        if shoulder_scale <= 0.0:
            shoulder_scale = height_scale
            warnings.append("Shoulder scale was estimated from body height.")

        scale = (height_scale * 0.6) + (shoulder_scale * 0.4)
        hip_scale = (height_cm * ANTHRO_HIP_RATIO) / hip_anchor_px if hip_anchor_px > 0.0 else 0.0
        leg_scale = (height_cm * ANTHRO_LEG_RATIO) / leg_anchor_px if leg_anchor_px > 0.0 else 0.0
        if hip_scale > 0.0:
            scale = (scale * 0.85) + (hip_scale * 0.15)
        if leg_scale > 0.0:
            scale = (scale * 0.9) + (leg_scale * 0.1)

        pixel_to_cm = scale
        if pixel_to_cm <= 0.0:
            pixel_to_cm = height_scale
            warnings.append("Scale calibration fallback applied.")
        if pixel_to_cm <= 0.0:
            pixel_to_cm = 0.1
            warnings.append("Scale calibration used low-confidence default.")

        distance_norm = _clamp(TARGET_TORSO_RATIO / max(torso_ratio, 1e-6), 0.93, 1.07)
        pixel_to_cm *= distance_norm

        shoulder_y = anchors["shoulder_mid"][1]
        hip_y = anchors["hip_mid"][1]
        torso_y = anchors["torso_mid"][1]
        chest_y = anchors["upper_torso"][1]
        waist_y = anchors["lower_torso"][1]
        neck_y = _clamp(shoulder_y - ((hip_y - shoulder_y) * 0.16), 0.0, 1.0)

        front_shoulder_px, front_shoulder_conf, front_shoulder_sil = _view_width_estimate(front, shoulder_y, (11, 12))
        back_shoulder_px, back_shoulder_conf, back_shoulder_sil = _view_width_estimate(back, shoulder_y, (11, 12))
        shoulder_width_px, _ = _weighted_fusion(
            [
                (front_shoulder_px, front_shoulder_conf),
                (back_shoulder_px, back_shoulder_conf),
                (shoulder_anchor_px, 0.25),
            ],
            fallback=shoulder_anchor_px,
        )

        front_chest_px, front_chest_conf, front_chest_sil = _view_width_estimate(front, chest_y, (11, 12))
        back_chest_px, back_chest_conf, back_chest_sil = _view_width_estimate(back, chest_y, (11, 12))
        front_chest_profile_px, front_chest_profile_conf = _profile_width_pixels(front, chest_y)
        back_chest_profile_px, back_chest_profile_conf = _profile_width_pixels(back, chest_y)

        chest_landmark_span_px = _average(
            [
                _interpolated_pair_width_pixels(front_landmarks_data, 11, 23, 12, 24, 0.28, front["image_width"]),
                _interpolated_pair_width_pixels(back_landmarks_data, 11, 23, 12, 24, 0.28, back["image_width"]),
            ]
        )
        waist_landmark_span_px = _average(
            [
                _interpolated_pair_width_pixels(front_landmarks_data, 11, 23, 12, 24, 0.72, front["image_width"]),
                _interpolated_pair_width_pixels(back_landmarks_data, 11, 23, 12, 24, 0.72, back["image_width"]),
            ]
        )
        hip_landmark_span_px = hip_anchor_px

        front_chest_core_px, front_chest_core_conf = _mask_core_width_pixels(
            front.get("mask"),
            chest_y,
            _torso_center_x_normalized(front_landmarks_data, chest_y),
            shoulder_anchor_px * 0.49,
        )
        back_chest_core_px, back_chest_core_conf = _mask_core_width_pixels(
            back.get("mask"),
            chest_y,
            _torso_center_x_normalized(back_landmarks_data, chest_y),
            shoulder_anchor_px * 0.49,
        )
        front_waist_core_px, front_waist_core_conf = _mask_core_width_pixels(
            front.get("mask"),
            waist_y,
            _torso_center_x_normalized(front_landmarks_data, waist_y),
            shoulder_anchor_px * 0.43,
        )
        back_waist_core_px, back_waist_core_conf = _mask_core_width_pixels(
            back.get("mask"),
            waist_y,
            _torso_center_x_normalized(back_landmarks_data, waist_y),
            shoulder_anchor_px * 0.43,
        )
        front_hip_core_px, front_hip_core_conf = _mask_core_width_pixels(
            front.get("mask"),
            hip_y,
            _torso_center_x_normalized(front_landmarks_data, hip_y),
            max(hip_anchor_px * 0.56, shoulder_anchor_px * 0.46),
        )
        back_hip_core_px, back_hip_core_conf = _mask_core_width_pixels(
            back.get("mask"),
            hip_y,
            _torso_center_x_normalized(back_landmarks_data, hip_y),
            max(hip_anchor_px * 0.56, shoulder_anchor_px * 0.46),
        )

        chest_contour_px, _ = _weighted_fusion(
            [
                (front_chest_profile_px, front_chest_profile_conf * 1.2),
                (back_chest_profile_px, back_chest_profile_conf),
                (front_chest_px, front_chest_conf * 0.9),
                (back_chest_px, back_chest_conf * 0.9),
                (front_chest_core_px, front_chest_core_conf * 1.45),
                (back_chest_core_px, back_chest_core_conf * 1.35),
            ],
            fallback=max(front_chest_px, back_chest_px),
        )

        if chest_landmark_span_px > 0.0 and chest_contour_px > 0.0:
            chest_contour_px = min(chest_contour_px, chest_landmark_span_px * 1.22)

        chest_width_px, _ = _weighted_fusion(
            [
                (chest_contour_px, 0.45),
                (chest_landmark_span_px, 0.85),
                (shoulder_anchor_px * 0.92, 0.30),
            ],
            fallback=max(chest_contour_px, chest_landmark_span_px, shoulder_anchor_px * 0.9),
        )

        if chest_landmark_span_px > 0.0:
            chest_width_px = _clamp(chest_width_px, chest_landmark_span_px * 0.92, chest_landmark_span_px * 1.18)

        front_waist_px, front_waist_conf, front_waist_sil = _view_width_estimate(front, waist_y, (23, 24))
        back_waist_px, back_waist_conf, back_waist_sil = _view_width_estimate(back, waist_y, (23, 24))
        waist_contour_px, _ = _weighted_fusion(
            [
                (front_waist_px, front_waist_conf),
                (back_waist_px, back_waist_conf),
                (front_waist_core_px, front_waist_core_conf * 1.35),
                (back_waist_core_px, back_waist_core_conf * 1.3),
            ],
            fallback=0.0,
        )

        if waist_landmark_span_px > 0.0 and waist_contour_px > 0.0:
            waist_contour_px = min(waist_contour_px, waist_landmark_span_px * 1.18)

        waist_width_px, _ = _weighted_fusion(
            [
                (waist_contour_px, 0.34),
                (waist_landmark_span_px, 0.90),
                (chest_width_px * 0.82, 0.24),
            ],
            fallback=max(waist_contour_px, waist_landmark_span_px, chest_width_px * 0.80),
        )

        if waist_landmark_span_px > 0.0:
            waist_width_px = _clamp(waist_width_px, waist_landmark_span_px * 0.88, waist_landmark_span_px * 1.16)

        front_hip_px, front_hip_conf, front_hip_sil = _view_width_estimate(front, hip_y, (23, 24))
        back_hip_px, back_hip_conf, back_hip_sil = _view_width_estimate(back, hip_y, (23, 24))
        hip_contour_px, _ = _weighted_fusion(
            [
                (front_hip_px, front_hip_conf),
                (back_hip_px, back_hip_conf),
                (front_hip_core_px, front_hip_core_conf * 1.2),
                (back_hip_core_px, back_hip_core_conf * 1.15),
            ],
            fallback=0.0,
        )

        if hip_landmark_span_px > 0.0 and hip_contour_px > 0.0:
            hip_contour_px = min(hip_contour_px, hip_landmark_span_px * 1.20)

        hip_width_px, _ = _weighted_fusion(
            [
                (hip_contour_px, 0.40),
                (hip_landmark_span_px, 0.80),
                (waist_width_px * 1.06, 0.25),
            ],
            fallback=max(hip_contour_px, hip_landmark_span_px, waist_width_px * 1.02),
        )

        if hip_landmark_span_px > 0.0:
            hip_width_px = _clamp(hip_width_px, hip_landmark_span_px * 0.90, hip_landmark_span_px * 1.18)

        if shoulder_width_px > 0.0 and chest_width_px > 0.0:
            chest_width_px = min(chest_width_px, shoulder_width_px * 0.96)
        if chest_width_px > 0.0 and waist_width_px > 0.0:
            waist_width_px = min(waist_width_px, chest_width_px * 0.90)
        if chest_width_px > 0.0 and hip_width_px > 0.0:
            hip_width_px = min(hip_width_px, chest_width_px * 1.02)

        side_torso_depth_px = _average(
            [
                _landmark_distance_pixels(side_landmarks_data, 11, 23, side["image_width"], side["image_height"]),
                _landmark_distance_pixels(side_landmarks_data, 12, 24, side["image_width"], side["image_height"]),
            ]
        ) * 0.42

        side_turn_cos, side_turn_sin, side_shoulder_span = _estimate_side_orientation(front_landmarks_data, side_landmarks_data)
        if side_shoulder_span > 0.0 and side_turn_cos > 0.45:
            warnings.append("Side view was not fully 90 degrees; torso depth was perspective-corrected.")

        side_chest_depth_px, _, side_chest_sil = _view_width_estimate(side, chest_y)
        side_waist_depth_px, _, side_waist_sil = _view_width_estimate(side, waist_y)
        side_hip_depth_px, _, side_hip_sil = _view_width_estimate(side, hip_y)
        side_neck_depth_px, _, side_neck_sil = _view_width_estimate(side, neck_y)

        chest_depth_fallback_px = max(side_torso_depth_px * 0.82, chest_width_px * 0.44)
        waist_depth_fallback_px = max(side_torso_depth_px * 0.78, waist_width_px * 0.40)
        hip_depth_fallback_px = max(side_torso_depth_px * 0.86, hip_width_px * 0.45)

        chest_depth_px = _perspective_corrected_depth(
            side_chest_depth_px,
            chest_width_px,
            chest_depth_fallback_px,
            side_turn_cos,
            side_turn_sin,
        )
        waist_depth_px = _perspective_corrected_depth(
            side_waist_depth_px,
            waist_width_px,
            waist_depth_fallback_px,
            side_turn_cos,
            side_turn_sin,
        )
        hip_depth_px = _perspective_corrected_depth(
            side_hip_depth_px,
            hip_width_px,
            hip_depth_fallback_px,
            side_turn_cos,
            side_turn_sin,
        )

        if chest_width_px > 0.0:
            chest_depth_px = _clamp(chest_depth_px, chest_width_px * 0.34, chest_width_px * 0.62)
        if waist_width_px > 0.0:
            waist_depth_px = _clamp(waist_depth_px, waist_width_px * 0.32, waist_width_px * 0.58)
        if hip_width_px > 0.0:
            hip_depth_px = _clamp(hip_depth_px, hip_width_px * 0.36, hip_width_px * 0.64)

        front_neck_width_px, front_neck_conf, front_neck_sil = _view_width_estimate(front, neck_y, (7, 8))
        back_neck_width_px, back_neck_conf, back_neck_sil = _view_width_estimate(back, neck_y, (7, 8))
        neck_width_px, _ = _weighted_fusion(
            [
                (front_neck_width_px, front_neck_conf),
                (back_neck_width_px, back_neck_conf),
            ],
            fallback=max(front_neck_width_px, back_neck_width_px),
        )
        neck_depth_px = _perspective_corrected_depth(
            side_neck_depth_px,
            neck_width_px,
            max(side_torso_depth_px * 0.44, neck_width_px * 0.34),
            side_turn_cos,
            side_turn_sin,
        )
        if neck_width_px > 0.0:
            neck_depth_px = _clamp(neck_depth_px, neck_width_px * 0.34, neck_width_px * 0.58)

        shoulder_width_cm = shoulder_width_px * pixel_to_cm
        chest_width_cm = chest_width_px * pixel_to_cm
        waist_width_cm = waist_width_px * pixel_to_cm
        hip_width_cm = hip_width_px * pixel_to_cm

        chest_depth_cm = chest_depth_px * pixel_to_cm
        waist_depth_cm = waist_depth_px * pixel_to_cm
        hip_depth_cm = hip_depth_px * pixel_to_cm
        neck_width_cm = neck_width_px * pixel_to_cm
        neck_depth_cm = neck_depth_px * pixel_to_cm

        chest_cm = _ellipse_circumference(chest_width_cm, chest_depth_cm)
        waist_cm = _ellipse_circumference(waist_width_cm, waist_depth_cm)
        hip_circumference_cm = _ellipse_circumference(hip_width_cm, hip_depth_cm)
        neck_cm = _ellipse_circumference(neck_width_cm, neck_depth_cm)

        arm_length_cm = _average(
            [
                _segment_chain_length_pixels(front_landmarks_data, [11, 13, 15], front["image_width"], front["image_height"]),
                _segment_chain_length_pixels(front_landmarks_data, [12, 14, 16], front["image_width"], front["image_height"]),
                _segment_chain_length_pixels(back_landmarks_data, [11, 13, 15], back["image_width"], back["image_height"]),
                _segment_chain_length_pixels(back_landmarks_data, [12, 14, 16], back["image_width"], back["image_height"]),
            ]
        ) * pixel_to_cm

        leg_length_outseam_cm = _average(
            [
                _segment_chain_length_pixels(front_landmarks_data, [23, 25, 27], front["image_width"], front["image_height"]),
                _segment_chain_length_pixels(front_landmarks_data, [24, 26, 28], front["image_width"], front["image_height"]),
                _segment_chain_length_pixels(back_landmarks_data, [23, 25, 27], back["image_width"], back["image_height"]),
                _segment_chain_length_pixels(back_landmarks_data, [24, 26, 28], back["image_width"], back["image_height"]),
            ]
        ) * pixel_to_cm
        leg_length_cm = leg_length_outseam_cm * 0.90

        measurements = {
            "shoulder_width_cm": shoulder_width_cm,
            "chest_cm": chest_cm,
            "waist_cm": waist_cm,
            "hip_width_cm": hip_width_cm,
            "hip_circumference_cm": hip_circumference_cm,
            "arm_length_cm": arm_length_cm,
            "leg_length_cm": leg_length_cm,
            "neck_cm": neck_cm,
            "torso_depth_cm": waist_depth_cm,
        }

        _fill_missing_measurements(measurements, height_cm, warnings)
        _validate_outliers(measurements, warnings)
        _enforce_proportional_consistency(measurements, warnings)
        _correct_torso_underestimation(measurements, warnings)

        if torso_ratio < 0.18:
            warnings.append("User appears far from camera; confidence reduced.")
        if torso_ratio > 0.37:
            warnings.append("User appears close to camera; confidence reduced.")

        shoulder_landmark_conf = _average(
            [
                _landmark_confidence(front_landmarks_data, (11, 12)),
                _landmark_confidence(back_landmarks_data, (11, 12)),
            ]
        )
        torso_landmark_conf = _average(
            [
                _landmark_confidence(front_landmarks_data, (11, 12, 23, 24)),
                _landmark_confidence(back_landmarks_data, (11, 12, 23, 24)),
                _landmark_confidence(side_landmarks_data, (11, 12, 23, 24)),
            ]
        )
        limb_landmark_conf = _average(
            [
                _landmark_confidence(front_landmarks_data, (11, 13, 15, 12, 14, 16, 23, 25, 27, 24, 26, 28)),
                _landmark_confidence(back_landmarks_data, (11, 13, 15, 12, 14, 16, 23, 25, 27, 24, 26, 28)),
            ]
        )

        shoulder_silhouette = _average([front_shoulder_sil, back_shoulder_sil])
        chest_silhouette = _average([front_chest_sil, back_chest_sil, side_chest_sil])
        waist_silhouette = _average([front_waist_sil, back_waist_sil, side_waist_sil])
        hip_silhouette = _average([front_hip_sil, back_hip_sil, side_hip_sil])
        neck_silhouette = _average([front_neck_sil, back_neck_sil, side_neck_sil])
        limb_silhouette = _clamp(_average([chest_silhouette, waist_silhouette, hip_silhouette]) * 0.6, 0.0, 1.0)

        shoulder_conf = _measurement_confidence_score(shoulder_landmark_conf, shoulder_silhouette, posture_score)
        chest_conf = _measurement_confidence_score(torso_landmark_conf, chest_silhouette, posture_score)
        waist_conf = _measurement_confidence_score(torso_landmark_conf, waist_silhouette, posture_score)
        hip_conf = _measurement_confidence_score(torso_landmark_conf, hip_silhouette, posture_score)
        arm_conf = _measurement_confidence_score(limb_landmark_conf, limb_silhouette, posture_score)
        leg_conf = _measurement_confidence_score(limb_landmark_conf, limb_silhouette, posture_score)
        neck_conf = _measurement_confidence_score(torso_landmark_conf, neck_silhouette, posture_score)

        confidences = {
            "shoulder": shoulder_conf,
            "chest": chest_conf,
            "waist": waist_conf,
            "hip": hip_conf,
            "arm": arm_conf,
            "leg": leg_conf,
            "neck": neck_conf,
        }
        quality_score = _clamp(_average(confidences.values()), 0.0, 1.0)
        confidences["overall"] = quality_score

        _stabilize_measurements_with_priors(measurements, height_cm, quality_score, warnings)
        _apply_final_measurement_bias_correction(measurements, height_cm, warnings)
        _enforce_proportional_consistency(measurements, warnings)
        _correct_torso_underestimation(measurements, warnings)
        _validate_outliers(measurements, warnings)

        min_metric_conf = min(value for key, value in confidences.items() if key != "overall")
        if quality_score < LOW_QUALITY_WARNING_THRESHOLD or min_metric_conf < MIN_METRIC_CONFIDENCE:
            warnings.append("Measurements may be slightly inaccurate.")
        if quality_score < EXTREME_LOW_QUALITY_THRESHOLD:
            warnings.append("Scan not perfect, using estimation.")

        measurement_details = {
            "shoulder": _metric_detail(measurements["shoulder_width_cm"], shoulder_conf, "interpolated landmark + contour fusion", shoulder_landmark_conf, shoulder_silhouette, posture_score),
            "chest": _metric_detail(measurements["chest_cm"], chest_conf, "dense contour + landmark fusion", torso_landmark_conf, chest_silhouette, posture_score),
            "waist": _metric_detail(measurements["waist_cm"], waist_conf, "dense contour + landmark fusion", torso_landmark_conf, waist_silhouette, posture_score),
            "hip": _metric_detail(measurements["hip_circumference_cm"], hip_conf, "dense contour + landmark fusion", torso_landmark_conf, hip_silhouette, posture_score),
            "arm": _metric_detail(measurements["arm_length_cm"], arm_conf, "landmark chain", limb_landmark_conf, limb_silhouette, posture_score),
            "leg": _metric_detail(measurements["leg_length_cm"], leg_conf, "landmark chain", limb_landmark_conf, limb_silhouette, posture_score),
            "neck": _metric_detail(measurements["neck_cm"], neck_conf, "contour + side depth fusion", torso_landmark_conf, neck_silhouette, posture_score),
        }

        ui_measurements = _ui_measurements_from_raw(measurements)
        if not ui_measurements or not any(value > 0.0 for value in ui_measurements.values()):
            warnings.append("Scan not perfect, using estimation.")
            warnings.append("No reliable geometry extracted from this scan.")
            return _build_fallback_response(warnings, confidence_score=0.52)

        fallback_ui = _ui_measurements_from_raw(_fallback_measurements_from_height(height_cm))
        for key, value in ui_measurements.items():
            if value <= 0.0:
                ui_measurements[key] = fallback_ui[key]
                warnings.append(f"{key.capitalize()} was estimated from body ratios.")

        normalized_contours = {
            "front": _downsample_contour((front.get("contour_info") or {}).get("contour")),
            "side": _downsample_contour((side.get("contour_info") or {}).get("contour")),
            "back": _downsample_contour((back.get("contour_info") or {}).get("contour")),
        }

        silhouette_torso_clarity = _average(
            [
                front_chest_sil,
                front_waist_sil,
                front_hip_sil,
                back_chest_sil,
                back_waist_sil,
                back_hip_sil,
                side_chest_sil,
                side_waist_sil,
                side_hip_sil,
            ]
        )

        response: Dict[str, Any] = {
            "measurements": ui_measurements,
            "confidence": {key: round(value, 3) for key, value in confidences.items()},
            "confidence_score": round(quality_score, 3),
            "quality_score": round(quality_score, 3),
            "warnings": list(dict.fromkeys(warnings)),
            "measurement_details": measurement_details,
            "pixel_to_cm": round(pixel_to_cm, 6),
            "scale_components": {
                "height_scale": round(height_scale, 6),
                "width_scale": round(shoulder_scale, 6),
                "leg_scale": round(leg_scale, 6),
                "contour_height_scale": round(contour_height_scale, 6),
                "distance_normalization": round(distance_norm, 4),
            },
            "scan_artifacts": {
                "contours": normalized_contours,
                "silhouette_clarity": round(silhouette_torso_clarity, 3),
                "posture_score": round(posture_score, 3),
                "distance_score": round(distance_score, 3),
            },
        }

        for key in RAW_METRIC_KEYS:
            response[key] = round(float(measurements.get(key, 0.0)), 2)

        if not response.get("measurements"):
            warnings.append("Scan not perfect, using estimation.")
            return _build_fallback_response(warnings, confidence_score=0.5)

        return response
    except Exception:
        warnings.append("Scan not perfect, using estimation.")
        warnings.append("Processing fallback applied due to runtime exception.")
        return _build_fallback_response(warnings, confidence_score=0.5)
