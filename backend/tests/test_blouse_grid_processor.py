import importlib
import sys

import numpy as np
import pytest


def _load_processor_with_real_cv2():
    try:
        # conftest installs a lightweight cv2 stub for API tests; replace it if possible.
        module = sys.modules.get("cv2")
        if module is not None and not hasattr(module, "connectedComponentsWithStats"):
            sys.modules.pop("cv2", None)

        cv2 = importlib.import_module("cv2")
    except Exception:
        return None, None

    if not hasattr(cv2, "connectedComponentsWithStats") or not hasattr(cv2, "rectangle"):
        return None, None

    processor = importlib.import_module("ai.blouse_grid_processor")
    processor.cv2 = cv2
    return processor, cv2


def _mean_color_bgr(image_rgba: np.ndarray) -> np.ndarray:
    alpha = image_rgba[:, :, 3] > 0
    if not np.any(alpha):
        return np.array([0.0, 0.0, 0.0], dtype=np.float32)
    return image_rgba[:, :, :3][alpha].mean(axis=0)


def test_process_blouse_grid_image_maps_positions_and_fits_without_distortion():
    processor, cv2 = _load_processor_with_real_cv2()
    if processor is None:
        pytest.skip("opencv component tools unavailable")

    image = np.zeros((320, 520, 3), dtype=np.uint8)

    # Draw five blouse blocks in the required grid positions.
    cv2.rectangle(image, (40, 30), (130, 112), (10, 20, 220), thickness=-1)   # top-left, red dominant
    cv2.rectangle(image, (200, 24), (292, 114), (12, 220, 20), thickness=-1)  # top-center, green dominant
    cv2.rectangle(image, (365, 34), (456, 122), (220, 20, 14), thickness=-1)  # top-right, blue dominant
    cv2.rectangle(image, (92, 174), (184, 262), (10, 220, 220), thickness=-1)  # bottom-left, yellow-ish
    cv2.rectangle(image, (315, 166), (406, 258), (220, 12, 220), thickness=-1) # bottom-right, magenta-ish

    # Draw separate white label strips under each blouse; these must be ignored.
    cv2.rectangle(image, (36, 122), (138, 138), (255, 255, 255), thickness=-1)
    cv2.rectangle(image, (196, 124), (298, 140), (255, 255, 255), thickness=-1)
    cv2.rectangle(image, (360, 132), (460, 148), (255, 255, 255), thickness=-1)
    cv2.rectangle(image, (86, 272), (190, 288), (255, 255, 255), thickness=-1)
    cv2.rectangle(image, (309, 268), (412, 284), (255, 255, 255), thickness=-1)

    placeholder_sizes = {
        "boatNeckPlaceholder": (130, 150),
        "backlessPlaceholder": (140, 130),
        "princessCut1Placeholder": (120, 150),
        "princessCut2Placeholder": (145, 125),
        "highNeckPlaceholder": (125, 145),
    }

    result = processor.process_blouse_grid_image(image, placeholder_sizes=placeholder_sizes, include_base64=False)

    placeholders = result["placeholders"]
    assert set(placeholders.keys()) == set(placeholder_sizes.keys())

    assert placeholders["boatNeckPlaceholder"]["blouse_type"] == "Boat Neck Blouse"
    assert placeholders["backlessPlaceholder"]["blouse_type"] == "Backless Blouse"
    assert placeholders["princessCut1Placeholder"]["blouse_type"] == "Princess Cut Blouse"
    assert placeholders["princessCut2Placeholder"]["blouse_type"] == "Princess Cut Blouse"
    assert placeholders["highNeckPlaceholder"]["blouse_type"] == "High Neck Blouse"

    # Top-left source bbox should not include the top-left label strip at y>=122.
    top_left_bbox = placeholders["boatNeckPlaceholder"]["source_bbox"]
    assert top_left_bbox["y"] + top_left_bbox["height"] < 122

    # Verify each output canvas is sized correctly and fit preserves source ratio.
    for placeholder_name, payload in placeholders.items():
        expected_w, expected_h = placeholder_sizes[placeholder_name]
        canvas = payload["image_rgba"]
        fit = payload["canvas_placement"]
        source_size = payload["source_size"]

        assert canvas.shape == (expected_h, expected_w, 4)
        assert 0 <= fit["x"] <= expected_w
        assert 0 <= fit["y"] <= expected_h
        assert fit["width"] <= expected_w
        assert fit["height"] <= expected_h

        source_ratio = source_size["width"] / max(source_size["height"], 1)
        fit_ratio = fit["width"] / max(fit["height"], 1)
        assert abs(source_ratio - fit_ratio) < 0.02

    boat_color = _mean_color_bgr(placeholders["boatNeckPlaceholder"]["image_rgba"])
    backless_color = _mean_color_bgr(placeholders["backlessPlaceholder"]["image_rgba"])
    princess1_color = _mean_color_bgr(placeholders["princessCut1Placeholder"]["image_rgba"])

    # Color dominance confirms position-to-placeholder mapping.
    assert boat_color[2] > boat_color[1] and boat_color[2] > boat_color[0]     # red dominant
    assert backless_color[1] > backless_color[0] and backless_color[1] > backless_color[2]  # green dominant
    assert princess1_color[0] > princess1_color[1] and princess1_color[0] > princess1_color[2]  # blue dominant

    by_type = result["by_blouse_type"]
    assert by_type["Boat Neck Blouse"]["placeholder"] == "boatNeckPlaceholder"
    assert by_type["Backless Blouse"]["placeholder"] == "backlessPlaceholder"
    assert isinstance(by_type["Princess Cut Blouse"], list)
    assert len(by_type["Princess Cut Blouse"]) == 2
    assert by_type["High Neck Blouse"]["placeholder"] == "highNeckPlaceholder"
