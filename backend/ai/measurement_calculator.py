import math
from typing import Any, Dict, Iterable, List, Optional, Tuple

import cv2
import numpy as np


VISIBILITY_THRESHOLD = 0.55
MIN_OVERALL_CONFIDENCE = 0.55
MIN_METRIC_CONFIDENCE = 0.42
MAX_TILT_DELTA = 0.06
SEGMENTATION_THRESHOLD = 0.35

DISTANCE_MIN_TORSO_RATIO = 0.15
DISTANCE_MAX_TORSO_RATIO = 0.42
TARGET_TORSO_RATIO = 0.27

ANTHRO_SHOULDER_RATIO = 0.259
ANTHRO_HIP_RATIO = 0.191
ANTHRO_LEG_RATIO = 0.53

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


def _downsample_contour(contour: Optional[np.ndarray], max_points: int = 180) -> List[List[float]]:
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

    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return {"contour": None, "clarity": 0.0, "area_ratio": 0.0, "binary_mask": binary}

    contour = max(contours, key=cv2.contourArea)
    area = float(cv2.contourArea(contour))
    if area <= 20.0:
        return {"contour": None, "clarity": 0.0, "area_ratio": 0.0, "binary_mask": binary}

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
        "contour": contour.reshape(-1, 2).astype(np.float32),
        "clarity": clarity,
        "area_ratio": area_ratio,
        "binary_mask": binary,
    }


def _coerce_view(view: Any) -> Dict[str, Any]:
    if isinstance(view, dict):
        landmarks = view.get("landmarks") or []
        mask = view.get("segmentation_mask")
        image_width = int(view.get("image_width") or 1000)
        image_height = int(view.get("image_height") or 1000)
        pose_confidence = float(view.get("pose_confidence") or 0.0)
    else:
        landmarks = view or []
        mask = None
        image_width = 1000
        image_height = 1000
        pose_confidence = _landmark_confidence(landmarks, (0, 11, 12, 23, 24, 27, 28))

    if image_width <= 0:
        image_width = 1000
    if image_height <= 0:
        image_height = 1000

    if mask is not None and not isinstance(mask, np.ndarray):
        mask = np.asarray(mask)

    contour_info = _extract_primary_contour(mask)
    return {
        "landmarks": landmarks,
        "mask": mask,
        "image_width": image_width,
        "image_height": image_height,
        "pose_confidence": pose_confidence,
        "contour_info": contour_info,
    }


def _validate_landmarks(landmarks: List[Any]) -> bool:
    return isinstance(landmarks, list) and len(landmarks) >= 33


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


def _view_width_estimate(
    view: Dict[str, Any],
    y_norm: float,
    fallback_landmark_pair: Optional[Tuple[int, int]] = None,
) -> Tuple[float, float, float]:
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
            (contour_width, contour_conf * 1.2),
            (mask_width, mask_conf),
            (landmark_width, landmark_conf),
        ],
        fallback=landmark_width,
    )

    silhouette_clarity = _clamp(
        _average([
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


def _validate_outliers(measurements: Dict[str, float], warnings: List[str]) -> Optional[str]:
    chest = measurements["chest_cm"]
    waist = measurements["waist_cm"]
    hip = measurements["hip_circumference_cm"]

    if chest < 60.0 or chest > 150.0:
        return "Please stand straight and ensure full body is visible"
    if waist < 45.0 or waist > 145.0:
        return "Please stand straight and ensure full body is visible"
    if hip < 70.0 or hip > 165.0:
        return "Please stand straight and ensure full body is visible"

    if measurements["shoulder_width_cm"] < 28.0 or measurements["shoulder_width_cm"] > 65.0:
        return "Please stand straight and ensure full body is visible"

    if waist > chest:
        warnings.append("Waist exceeds chest; verify pose and try another scan for best fit.")
    if measurements["leg_length_cm"] < 55.0 or measurements["leg_length_cm"] > 130.0:
        return "Please stand straight and ensure full body is visible"
    if measurements["arm_length_cm"] < 40.0 or measurements["arm_length_cm"] > 90.0:
        return "Please stand straight and ensure full body is visible"
    if measurements["neck_cm"] < 25.0 or measurements["neck_cm"] > 55.0:
        return "Please stand straight and ensure full body is visible"

    return None


def calculate_measurements(front_landmarks, side_landmarks, back_landmarks, height_cm):
    try:
        height_cm = float(height_cm)
    except (TypeError, ValueError):
        return {"error": "Please enter a valid height in cm"}

    if height_cm < 120.0 or height_cm > 230.0:
        return {"error": "Please enter a realistic height between 120 cm and 230 cm"}

    front = _coerce_view(front_landmarks)
    side = _coerce_view(side_landmarks)
    back = _coerce_view(back_landmarks)

    if not (
        _validate_landmarks(front["landmarks"])
        and _validate_landmarks(side["landmarks"])
        and _validate_landmarks(back["landmarks"])
    ):
        return {"error": "Stand straight and keep full body in frame"}

    required_indices = (11, 12, 23, 24, 25, 26, 27, 28)
    for view in (front, side, back):
        if _landmark_confidence(view["landmarks"], required_indices) < VISIBILITY_THRESHOLD:
            return {"error": "Stand straight and keep full body in frame"}

    posture_score, posture_failed = _posture_score(front)
    if posture_failed:
        return {"error": "Stand straight and keep full body in frame"}

    torso_ratio = _average([value for value in (_torso_ratio(front), _torso_ratio(back)) if value > 0.0])
    distance_score = _distance_score(torso_ratio)
    if distance_score <= 0.0:
        return {"error": "Please stand at a comfortable distance and keep full body in frame"}

    front_height_px = _body_height_pixels(front)
    back_height_px = _body_height_pixels(back)
    if front_height_px <= 0.0:
        return {"error": "Stand straight and keep full body in frame"}

    front_landmarks_data = front["landmarks"]
    back_landmarks_data = back["landmarks"]
    side_landmarks_data = side["landmarks"]

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
        ]
    )

    height_scale = height_cm / front_height_px
    width_scale_shoulder = (height_cm * ANTHRO_SHOULDER_RATIO) / shoulder_anchor_px if shoulder_anchor_px > 0.0 else 0.0
    width_scale_hip = (height_cm * ANTHRO_HIP_RATIO) / hip_anchor_px if hip_anchor_px > 0.0 else 0.0
    leg_scale = (height_cm * ANTHRO_LEG_RATIO) / leg_anchor_px if leg_anchor_px > 0.0 else 0.0

    pixel_to_cm = _weighted_scale(
        [
            (height_scale, 0.45),
            (width_scale_shoulder, 0.25),
            (width_scale_hip, 0.15),
            (leg_scale, 0.15),
        ]
    )
    if pixel_to_cm <= 0.0:
        return {"error": "Stand straight and keep full body in frame"}

    distance_norm = _clamp(TARGET_TORSO_RATIO / max(torso_ratio, 1e-6), 0.94, 1.06)
    pixel_to_cm *= distance_norm

    shoulder_y = _average([_get_xy(front_landmarks_data[11])[1], _get_xy(front_landmarks_data[12])[1]])
    hip_y = _average([_get_xy(front_landmarks_data[23])[1], _get_xy(front_landmarks_data[24])[1]])
    chest_y = shoulder_y + ((hip_y - shoulder_y) * 0.36)
    waist_y = shoulder_y + ((hip_y - shoulder_y) * 0.64)
    neck_y = _clamp(shoulder_y - ((hip_y - shoulder_y) * 0.16), 0.0, 1.0)

    front_shoulder_px, front_shoulder_conf, front_shoulder_sil = _view_width_estimate(front, shoulder_y, (11, 12))
    back_shoulder_px, back_shoulder_conf, back_shoulder_sil = _view_width_estimate(back, shoulder_y, (11, 12))
    shoulder_width_px, shoulder_shape_conf = _weighted_fusion(
        [
            (front_shoulder_px, front_shoulder_conf),
            (back_shoulder_px, back_shoulder_conf),
        ],
        fallback=shoulder_anchor_px,
    )

    front_chest_px, front_chest_conf, front_chest_sil = _view_width_estimate(front, chest_y, (11, 12))
    back_chest_px, back_chest_conf, back_chest_sil = _view_width_estimate(back, chest_y, (11, 12))
    chest_width_px, chest_width_conf = _weighted_fusion(
        [
            (front_chest_px, front_chest_conf),
            (back_chest_px, back_chest_conf),
            (shoulder_width_px * 0.92, 0.25),
        ],
        fallback=shoulder_width_px * 0.9,
    )

    front_waist_px, front_waist_conf, front_waist_sil = _view_width_estimate(front, waist_y, (23, 24))
    back_waist_px, back_waist_conf, back_waist_sil = _view_width_estimate(back, waist_y, (23, 24))
    waist_width_px, waist_width_conf = _weighted_fusion(
        [
            (front_waist_px, front_waist_conf),
            (back_waist_px, back_waist_conf),
            ((chest_width_px + hip_anchor_px) * 0.5, 0.2),
        ],
        fallback=(chest_width_px + hip_anchor_px) * 0.5,
    )

    front_hip_px, front_hip_conf, front_hip_sil = _view_width_estimate(front, hip_y, (23, 24))
    back_hip_px, back_hip_conf, back_hip_sil = _view_width_estimate(back, hip_y, (23, 24))
    hip_width_px, hip_width_conf = _weighted_fusion(
        [
            (front_hip_px, front_hip_conf),
            (back_hip_px, back_hip_conf),
            (hip_anchor_px, 0.25),
        ],
        fallback=hip_anchor_px,
    )

    side_torso_depth_px = _average(
        [
            _landmark_distance_pixels(side_landmarks_data, 11, 23, side["image_width"], side["image_height"]),
            _landmark_distance_pixels(side_landmarks_data, 12, 24, side["image_width"], side["image_height"]),
        ]
    ) * 0.42

    side_chest_depth_px, side_chest_depth_conf, side_chest_sil = _view_width_estimate(side, chest_y)
    side_waist_depth_px, side_waist_depth_conf, side_waist_sil = _view_width_estimate(side, waist_y)
    side_hip_depth_px, side_hip_depth_conf, side_hip_sil = _view_width_estimate(side, hip_y)
    side_neck_depth_px, side_neck_depth_conf, side_neck_sil = _view_width_estimate(side, neck_y)

    chest_depth_px = side_chest_depth_px if side_chest_depth_px > 0.0 else side_torso_depth_px * 0.98
    waist_depth_px = side_waist_depth_px if side_waist_depth_px > 0.0 else side_torso_depth_px * 0.92
    hip_depth_px = side_hip_depth_px if side_hip_depth_px > 0.0 else side_torso_depth_px * 1.06

    front_neck_width_px, front_neck_conf, front_neck_sil = _view_width_estimate(front, neck_y, (7, 8))
    back_neck_width_px, back_neck_conf, back_neck_sil = _view_width_estimate(back, neck_y, (7, 8))
    neck_width_px, neck_width_conf = _weighted_fusion(
        [
            (front_neck_width_px, front_neck_conf),
            (back_neck_width_px, back_neck_conf),
        ],
        fallback=max(front_neck_width_px, back_neck_width_px),
    )
    neck_depth_px = side_neck_depth_px if side_neck_depth_px > 0.0 else side_torso_depth_px * 0.56

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

    leg_length_cm = _average(
        [
            _segment_chain_length_pixels(front_landmarks_data, [23, 25, 27], front["image_width"], front["image_height"]),
            _segment_chain_length_pixels(front_landmarks_data, [24, 26, 28], front["image_width"], front["image_height"]),
            _segment_chain_length_pixels(back_landmarks_data, [23, 25, 27], back["image_width"], back["image_height"]),
            _segment_chain_length_pixels(back_landmarks_data, [24, 26, 28], back["image_width"], back["image_height"]),
        ]
    ) * pixel_to_cm

    torso_depth_cm = waist_depth_cm

    measurements = {
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

    warnings: List[str] = []
    outlier_error = _validate_outliers(measurements, warnings)
    if outlier_error:
        return {"error": outlier_error}

    if torso_ratio < 0.18:
        warnings.append("User appears far from camera; scan confidence reduced.")
    if torso_ratio > 0.37:
        warnings.append("User appears close to camera; scan confidence reduced.")

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

    shoulder_conf = _clamp(
        (0.45 * shoulder_landmark_conf)
        + (0.30 * _average([front_shoulder_sil, back_shoulder_sil]))
        + (0.15 * posture_score)
        + (0.10 * distance_score),
        0.0,
        1.0,
    )
    chest_conf = _clamp((0.40 * torso_landmark_conf) + (0.35 * _average([front_chest_sil, back_chest_sil, side_chest_sil])) + (0.15 * posture_score) + (0.10 * distance_score), 0.0, 1.0)
    waist_conf = _clamp((0.40 * torso_landmark_conf) + (0.35 * _average([front_waist_sil, back_waist_sil, side_waist_sil])) + (0.15 * posture_score) + (0.10 * distance_score), 0.0, 1.0)
    hip_conf = _clamp((0.40 * torso_landmark_conf) + (0.35 * _average([front_hip_sil, back_hip_sil, side_hip_sil])) + (0.15 * posture_score) + (0.10 * distance_score), 0.0, 1.0)
    arm_conf = _clamp((0.70 * limb_landmark_conf) + (0.20 * posture_score) + (0.10 * distance_score), 0.0, 1.0)
    leg_conf = _clamp((0.70 * limb_landmark_conf) + (0.20 * posture_score) + (0.10 * distance_score), 0.0, 1.0)
    neck_conf = _clamp((0.35 * torso_landmark_conf) + (0.40 * _average([front_neck_sil, back_neck_sil, side_neck_sil])) + (0.15 * posture_score) + (0.10 * distance_score), 0.0, 1.0)

    if measurements["waist_cm"] > measurements["chest_cm"]:
        waist_conf = _clamp(waist_conf * 0.9, 0.0, 1.0)

    confidences = {
        "shoulder": shoulder_conf,
        "chest": chest_conf,
        "waist": waist_conf,
        "hip": hip_conf,
        "arm": arm_conf,
        "leg": leg_conf,
        "neck": neck_conf,
    }
    quality_score = _clamp((0.80 * _average(confidences.values())) + (0.12 * posture_score) + (0.08 * distance_score), 0.0, 1.0)
    confidences["overall"] = quality_score

    if quality_score < MIN_OVERALL_CONFIDENCE or min(value for key, value in confidences.items() if key != "overall") < MIN_METRIC_CONFIDENCE:
        return {"error": "Stand straight and keep full body in frame"}

    measurement_details = {
        "shoulder": _metric_detail(measurements["shoulder_width_cm"], shoulder_conf, "landmark+contour fusion", shoulder_landmark_conf, _average([front_shoulder_sil, back_shoulder_sil]), posture_score),
        "chest": _metric_detail(measurements["chest_cm"], chest_conf, "multi-view ellipse", torso_landmark_conf, _average([front_chest_sil, back_chest_sil, side_chest_sil]), posture_score),
        "waist": _metric_detail(measurements["waist_cm"], waist_conf, "multi-view ellipse", torso_landmark_conf, _average([front_waist_sil, back_waist_sil, side_waist_sil]), posture_score),
        "hip": _metric_detail(measurements["hip_circumference_cm"], hip_conf, "multi-view ellipse", torso_landmark_conf, _average([front_hip_sil, back_hip_sil, side_hip_sil]), posture_score),
        "arm": _metric_detail(measurements["arm_length_cm"], arm_conf, "landmark chain", limb_landmark_conf, 0.0, posture_score),
        "leg": _metric_detail(measurements["leg_length_cm"], leg_conf, "landmark chain", limb_landmark_conf, 0.0, posture_score),
        "neck": _metric_detail(measurements["neck_cm"], neck_conf, "multi-view ellipse", torso_landmark_conf, _average([front_neck_sil, back_neck_sil, side_neck_sil]), posture_score),
    }

    ui_measurements = {
        "shoulder": round(measurements["shoulder_width_cm"], 2),
        "chest": round(measurements["chest_cm"], 2),
        "waist": round(measurements["waist_cm"], 2),
        "hip": round(measurements["hip_circumference_cm"], 2),
        "arm": round(measurements["arm_length_cm"], 2),
        "leg": round(measurements["leg_length_cm"], 2),
        "neck": round(measurements["neck_cm"], 2),
    }

    normalized_contours = {
        "front": _downsample_contour((front.get("contour_info") or {}).get("contour")),
        "side": _downsample_contour((side.get("contour_info") or {}).get("contour")),
        "back": _downsample_contour((back.get("contour_info") or {}).get("contour")),
    }

    response: Dict[str, Any] = {
        "measurements": ui_measurements,
        "confidence": {key: round(value, 3) for key, value in confidences.items()},
        "quality_score": round(quality_score, 3),
        "warnings": warnings,
        "measurement_details": measurement_details,
        "pixel_to_cm": round(pixel_to_cm, 6),
        "scale_components": {
            "height_scale": round(height_scale, 6),
            "width_scale": round(_average([value for value in (width_scale_shoulder, width_scale_hip) if value > 0.0]), 6),
            "leg_scale": round(leg_scale, 6),
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
        response[key] = round(float(measurements[key]), 2)

    return response
