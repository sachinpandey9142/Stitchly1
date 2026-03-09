import cv2
import mediapipe as mp

mp_pose = mp.solutions.pose

pose = mp_pose.Pose(
    static_image_mode=True,
    model_complexity=2
)

def detect_landmarks(image_path):

    image = cv2.imread(image_path)
    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    results = pose.process(image_rgb)

    landmarks = []

    if results.pose_landmarks:
        for lm in results.pose_landmarks.landmark:
            landmarks.append((lm.x, lm.y, lm.z))

    return landmarks