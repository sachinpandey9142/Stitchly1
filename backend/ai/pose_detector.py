import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

BaseOptions = python.BaseOptions
PoseLandmarker = vision.PoseLandmarker
PoseLandmarkerOptions = vision.PoseLandmarkerOptions
VisionRunningMode = vision.RunningMode


def detect_landmarks(image_path):

    image = cv2.imread(image_path)

    if image is None:
        raise ValueError("Image could not be loaded")

    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    mp_image = mp.Image(
        image_format=mp.ImageFormat.SRGB,
        data=image_rgb
    )

    options = PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path="pose_landmarker_lite.task"),
        running_mode=VisionRunningMode.IMAGE
    )

    with PoseLandmarker.create_from_options(options) as landmarker:

        result = landmarker.detect(mp_image)

        landmarks = []

        if result.pose_landmarks:
            for lm in result.pose_landmarks[0]:
                landmarks.append({
                    "x": lm.x,
                    "y": lm.y,
                    "z": lm.z,
                    "visibility": lm.visibility
                })

        return landmarks