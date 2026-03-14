import numpy as np

FRAME_BUFFER = []
MAX_FRAMES = 10


def add_frame(landmarks):
    global FRAME_BUFFER

    FRAME_BUFFER.append(landmarks)

    if len(FRAME_BUFFER) > MAX_FRAMES:
        FRAME_BUFFER.pop(0)


def average_landmarks():
    global FRAME_BUFFER

    if len(FRAME_BUFFER) == 0:
        return None

    num_landmarks = len(FRAME_BUFFER[0])
    avg_landmarks = []

    for i in range(num_landmarks):

        xs = []
        ys = []
        zs = []

        for frame in FRAME_BUFFER:
            xs.append(frame[i]["x"])
            ys.append(frame[i]["y"])
            zs.append(frame[i]["z"])

        avg_landmarks.append((
            sum(xs) / len(xs),
            sum(ys) / len(ys),
            sum(zs) / len(zs)
        ))

    return avg_landmarks