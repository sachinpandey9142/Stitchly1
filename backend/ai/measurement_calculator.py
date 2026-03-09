import math


def distance(p1, p2):
    return math.sqrt(
        (p1[0] - p2[0])**2 +
        (p1[1] - p2[1])**2
    )


def calculate_measurements(front_landmarks, side_landmarks, back_landmarks, height_cm):

    # ------------------------------
    # BODY HEIGHT SCALE
    # ------------------------------
    head = front_landmarks[0]
    ankle = front_landmarks[27]

    pixel_height = distance(head, ankle)

    if pixel_height == 0:
        return {"error": "Invalid body detection"}

    scale = height_cm / pixel_height


    # ------------------------------
    # FRONT WIDTHS
    # ------------------------------
    left_shoulder = front_landmarks[11]
    right_shoulder = front_landmarks[12]

    left_hip = front_landmarks[23]
    right_hip = front_landmarks[24]

    shoulder_width_px = distance(left_shoulder, right_shoulder)
    hip_width_px = distance(left_hip, right_hip)

    shoulder_width = shoulder_width_px * scale
    hip_width = hip_width_px * scale


    # ------------------------------
    # SIDE DEPTH (TORSO DEPTH)
    # ------------------------------
    side_shoulder = side_landmarks[11]
    side_hip = side_landmarks[23]

    torso_depth_px = abs(side_shoulder[0] - side_hip[0])
    torso_depth = torso_depth_px * scale


    # ------------------------------
    # CHEST / WAIST USING ELLIPSE MODEL
    # ------------------------------
    chest_circumference = math.pi * (shoulder_width + torso_depth) / 2
    waist_circumference = math.pi * (hip_width + torso_depth) / 2


    # ------------------------------
    # ARM LENGTH
    # ------------------------------
    shoulder = front_landmarks[11]
    elbow = front_landmarks[13]
    wrist = front_landmarks[15]

    arm_px = distance(shoulder, elbow) + distance(elbow, wrist)
    arm_length = arm_px * scale


    # ------------------------------
    # LEG LENGTH
    # ------------------------------
    hip = front_landmarks[23]
    knee = front_landmarks[25]
    ankle = front_landmarks[27]

    leg_px = distance(hip, knee) + distance(knee, ankle)
    leg_length = leg_px * scale


    # ------------------------------
    # SAFETY CLAMPS
    # ------------------------------
    shoulder_width = max(30, min(shoulder_width, 70))
    hip_width = max(30, min(hip_width, 70))
    torso_depth = max(10, min(torso_depth, 40))


    # ------------------------------
    # FINAL OUTPUT
    # ------------------------------
    return {
        "shoulder_width_cm": round(shoulder_width, 2),
        "hip_width_cm": round(hip_width, 2),
        "torso_depth_cm": round(torso_depth, 2),
        "chest_cm": round(chest_circumference, 2),
        "waist_cm": round(waist_circumference, 2),
        "arm_length_cm": round(arm_length, 2),
        "leg_length_cm": round(leg_length, 2)
    }