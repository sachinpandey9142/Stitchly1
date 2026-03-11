import math


def distance(p1, p2):
    return math.sqrt(
        (p1[0] - p2[0])**2 +
        (p1[1] - p2[1])**2
    )


def calculate_measurements(front_landmarks, side_landmarks, back_landmarks, height_cm):

    # ------------------------------
    # HEIGHT SCALE (FRONT VIEW)
    # ------------------------------
    head = front_landmarks[0]
    ankle = front_landmarks[27]

    pixel_height = distance(head, ankle)

    if pixel_height == 0:
        return {"error": "Invalid body detection"}

    scale = height_cm / pixel_height


    # ------------------------------
    # FRONT SHOULDER WIDTH
    # ------------------------------
    front_left_shoulder = front_landmarks[11]
    front_right_shoulder = front_landmarks[12]

    front_shoulder_px = distance(front_left_shoulder, front_right_shoulder)
    front_shoulder = front_shoulder_px * scale


    # ------------------------------
    # BACK SHOULDER WIDTH
    # ------------------------------
    back_left_shoulder = back_landmarks[11]
    back_right_shoulder = back_landmarks[12]

    back_shoulder_px = distance(back_left_shoulder, back_right_shoulder)
    back_shoulder = back_shoulder_px * scale


    # MULTI VIEW SHOULDER FUSION
    shoulder_width = (front_shoulder + back_shoulder) / 2


    # ------------------------------
    # FRONT HIP WIDTH
    # ------------------------------
    front_left_hip = front_landmarks[23]
    front_right_hip = front_landmarks[24]

    front_hip_px = distance(front_left_hip, front_right_hip)
    front_hip = front_hip_px * scale


    # ------------------------------
    # BACK HIP WIDTH
    # ------------------------------
    back_left_hip = back_landmarks[23]
    back_right_hip = back_landmarks[24]

    back_hip_px = distance(back_left_hip, back_right_hip)
    back_hip = back_hip_px * scale


    # MULTI VIEW HIP FUSION
    hip_width = (front_hip + back_hip) / 2


    # ------------------------------
    # SIDE DEPTH (TORSO THICKNESS)
    # ------------------------------
    side_shoulder = side_landmarks[11]
    side_hip = side_landmarks[23]

    depth_px = abs(side_shoulder[0] - side_hip[0])
    torso_depth = depth_px * scale


    # ------------------------------
    # BODY CIRCUMFERENCE MODEL
    # ------------------------------

    # improved body model
    chest_circumference = (shoulder_width * 1.6) + (torso_depth * 1.2)
    waist_circumference = (hip_width * 1.5) + (torso_depth * 1.1)


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
    # SAFETY LIMITS
    # ------------------------------
    shoulder_width = max(30, min(shoulder_width, 65))
    hip_width = max(30, min(hip_width, 60))
    torso_depth = max(10, min(torso_depth, 35))


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