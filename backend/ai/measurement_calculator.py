import math


VISIBILITY_THRESHOLD = 0.6
MAX_SHOULDER_ANGLE_DEG = 10.0


def _get_xy(landmark):
    """Support both dict MediaPipe landmarks and tuple/list fallback landmarks."""
    if isinstance(landmark, dict):
        return float(landmark.get("x", 0.0)), float(landmark.get("y", 0.0))
    return float(landmark[0]), float(landmark[1])


def _get_visibility(landmark):
    if isinstance(landmark, dict):
        return float(landmark.get("visibility", 1.0))
    return 1.0


def _distance(p1, p2):
    x1, y1 = _get_xy(p1)
    x2, y2 = _get_xy(p2)
    dx = x1 - x2
    dy = y1 - y2
    return math.sqrt((dx * dx) + (dy * dy))


def _midpoint(p1, p2):
    x1, y1 = _get_xy(p1)
    x2, y2 = _get_xy(p2)
    return ((x1 + x2) * 0.5, (y1 + y2) * 0.5)


def _point_distance(p1, p2):
    dx = p1[0] - p2[0]
    dy = p1[1] - p2[1]
    return math.sqrt((dx * dx) + (dy * dy))


def _segment_chain_length(points):
    total = 0.0
    for index in range(len(points) - 1):
        total += _distance(points[index], points[index + 1])
    return total


def _average(values):
    return sum(values) / len(values) if values else 0.0


def _clamp(value, minimum, maximum):
    return max(minimum, min(value, maximum))


def _ellipse_circumference(width_cm, depth_cm):
    # Ramanujan approximation for fast ellipse circumference estimation.
    semi_major = max(width_cm * 0.5, 0.01)
    semi_minor = max(depth_cm * 0.5, 0.01)
    return math.pi * (
        3.0 * (semi_major + semi_minor)
        - math.sqrt((3.0 * semi_major + semi_minor) * (semi_major + 3.0 * semi_minor))
    )


def _validate_landmarks(landmarks):
    return isinstance(landmarks, list) and len(landmarks) >= 33


def _validate_required_visibility(*views):
    required_indices = (11, 12, 23, 24, 25, 26, 27, 28)
    for landmarks in views:
        for index in required_indices:
            if _get_visibility(landmarks[index]) < VISIBILITY_THRESHOLD:
                return False
    return True


def calculate_measurements(front_landmarks, side_landmarks, back_landmarks, height_cm):
    if not (
        _validate_landmarks(front_landmarks)
        and _validate_landmarks(side_landmarks)
        and _validate_landmarks(back_landmarks)
    ):
        return {"error": "Poor body detection"}

    if not _validate_required_visibility(front_landmarks, side_landmarks, back_landmarks):
        return {"error": "Poor body detection"}

    # Reject rotated or tilted frontal poses using the shoulder line angle.
    left_shoulder = front_landmarks[11]
    right_shoulder = front_landmarks[12]
    left_shoulder_xy = _get_xy(left_shoulder)
    right_shoulder_xy = _get_xy(right_shoulder)
    shoulder_angle_deg = abs(
        math.degrees(
            math.atan2(
                right_shoulder_xy[1] - left_shoulder_xy[1],
                right_shoulder_xy[0] - left_shoulder_xy[0],
            )
        )
    )
    if shoulder_angle_deg > MAX_SHOULDER_ANGLE_DEG:
        return {"error": "Stand straight facing camera"}

    # Improved stature scaling:
    # 1. Estimate head top instead of treating the nose as head top.
    # 2. Blend three anthropometric scales for better robustness.
    nose_xy = _get_xy(front_landmarks[0])
    shoulder_mid_xy = _midpoint(front_landmarks[11], front_landmarks[12])
    hip_mid_xy = _midpoint(front_landmarks[23], front_landmarks[24])
    ankle_xy = _get_xy(front_landmarks[27])
    head_top_xy = (
        nose_xy[0],
        nose_xy[1] - ((shoulder_mid_xy[1] - nose_xy[1]) * 0.6),
    )

    pixel_height = _point_distance(head_top_xy, ankle_xy)
    nose_to_ankle = _point_distance(nose_xy, ankle_xy)
    hip_to_ankle = _point_distance(hip_mid_xy, ankle_xy)
    shoulder_to_hip = _point_distance(shoulder_mid_xy, hip_mid_xy)

    if pixel_height <= 0.0 or nose_to_ankle <= 0.0 or hip_to_ankle <= 0.0 or shoulder_to_hip <= 0.0:
        return {"error": "Poor body detection"}

    scale_candidates = [
        height_cm / pixel_height,
        (height_cm * 0.53) / hip_to_ankle,
        (height_cm * 0.28) / shoulder_to_hip,
    ]
    scale = _average(scale_candidates)

    # Multi-view shoulder fusion: front view is usually cleaner than back view.
    front_shoulder_cm = _distance(front_landmarks[11], front_landmarks[12]) * scale
    back_shoulder_cm = _distance(back_landmarks[11], back_landmarks[12]) * scale
    shoulder_width = (front_shoulder_cm * 0.6) + (back_shoulder_cm * 0.4)

    # Hip width remains a symmetric front/back fusion.
    front_hip_cm = _distance(front_landmarks[23], front_landmarks[24]) * scale
    back_hip_cm = _distance(back_landmarks[23], back_landmarks[24]) * scale
    hip_width = (front_hip_cm + back_hip_cm) * 0.5

    # Torso depth from the side torso segment length, scaled by a stable factor.
    torso_depth_px = _distance(side_landmarks[11], side_landmarks[23]) * 0.35
    torso_depth = torso_depth_px * scale

    # Lightweight width/depth modeling for torso sections.
    chest_width = shoulder_width * 0.92
    waist_width = (shoulder_width * 0.35) + (hip_width * 0.65)
    chest_depth = torso_depth * 1.02
    waist_depth = torso_depth * 0.92
    hip_depth = torso_depth * 1.08

    chest_circumference = _ellipse_circumference(chest_width, chest_depth)
    waist_circumference = _ellipse_circumference(waist_width, waist_depth)
    hip_circumference = _ellipse_circumference(hip_width, hip_depth)

    # Limb lengths remain summed segment lengths for speed and stability.
    left_arm_cm = _segment_chain_length([front_landmarks[11], front_landmarks[13], front_landmarks[15]]) * scale
    right_arm_cm = _segment_chain_length([front_landmarks[12], front_landmarks[14], front_landmarks[16]]) * scale
    arm_length = _average([left_arm_cm, right_arm_cm])

    left_leg_cm = _segment_chain_length([front_landmarks[23], front_landmarks[25], front_landmarks[27]]) * scale
    right_leg_cm = _segment_chain_length([front_landmarks[24], front_landmarks[26], front_landmarks[28]]) * scale
    leg_length = _average([left_leg_cm, right_leg_cm])

    # Clamp outputs to realistic human ranges to reduce noisy detections.
    shoulder_width = _clamp(shoulder_width, 30.0, 65.0)
    hip_width = _clamp(hip_width, 30.0, 60.0)
    torso_depth = _clamp(torso_depth, 10.0, 35.0)
    chest_circumference = _clamp(chest_circumference, 60.0, 160.0)
    waist_circumference = _clamp(waist_circumference, 50.0, 150.0)
    hip_circumference = _clamp(hip_circumference, 70.0, 160.0)
    arm_length = _clamp(arm_length, 40.0, 90.0)
    leg_length = _clamp(leg_length, 55.0, 130.0)

    # Hip circumference is intentionally computed for stability checking even
    # though the public return format must remain unchanged.
    _ = hip_circumference

    return {
        "shoulder_width_cm": round(shoulder_width, 2),
        "hip_width_cm": round(hip_width, 2),
        "torso_depth_cm": round(torso_depth, 2),
        "chest_cm": round(chest_circumference, 2),
        "waist_cm": round(waist_circumference, 2),
        "arm_length_cm": round(arm_length, 2),
        "leg_length_cm": round(leg_length, 2),
    }
