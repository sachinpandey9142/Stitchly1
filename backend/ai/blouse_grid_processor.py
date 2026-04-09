from __future__ import annotations

import base64
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np


BLACK_BACKGROUND_THRESHOLD = 14
MIN_COMPONENT_AREA = 700
EXPECTED_BLOUSE_COUNT = 5

DEFAULT_PLACEHOLDER_SIZES: Dict[str, Tuple[int, int]] = {
    "boatNeckPlaceholder": (220, 220),
    "backlessPlaceholder": (220, 220),
    "princessCut1Placeholder": (220, 220),
    "princessCut2Placeholder": (220, 220),
    "highNeckPlaceholder": (220, 220),
}

_SLOT_LAYOUT: List[Tuple[str, str, str]] = [
    ("top_left", "Boat Neck Blouse", "boatNeckPlaceholder"),
    ("top_center", "Backless Blouse", "backlessPlaceholder"),
    ("top_right", "Princess Cut Blouse", "princessCut1Placeholder"),
    ("bottom_left", "Princess Cut Blouse", "princessCut2Placeholder"),
    ("bottom_right", "High Neck Blouse", "highNeckPlaceholder"),
]


def _coerce_to_bgr(image: np.ndarray) -> np.ndarray:
    if image is None or image.size == 0:
        raise ValueError("Input image is empty")

    if image.dtype != np.uint8:
        image = np.clip(image, 0, 255).astype(np.uint8)

    if image.ndim == 2:
        return cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)

    if image.ndim != 3:
        raise ValueError("Input image must be a 2D or 3D numpy array")

    channels = image.shape[2]
    if channels == 3:
        return image.copy()
    if channels == 4:
        return cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)

    raise ValueError("Input image must have 1, 3, or 4 channels")


def _foreground_mask(image_bgr: np.ndarray) -> np.ndarray:
    intensity = np.max(image_bgr, axis=2)
    mask = (intensity > BLACK_BACKGROUND_THRESHOLD).astype(np.uint8) * 255
    kernel = np.ones((3, 3), dtype=np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
    return mask


def _extract_components(mask: np.ndarray, min_area: int = MIN_COMPONENT_AREA) -> Tuple[np.ndarray, List[Dict[str, float]]]:
    component_count, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
    components: List[Dict[str, float]] = []

    for label in range(1, component_count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < min_area:
            continue

        x = int(stats[label, cv2.CC_STAT_LEFT])
        y = int(stats[label, cv2.CC_STAT_TOP])
        width = int(stats[label, cv2.CC_STAT_WIDTH])
        height = int(stats[label, cv2.CC_STAT_HEIGHT])
        cx, cy = centroids[label]

        components.append(
            {
                "label": float(label),
                "area": float(area),
                "x": float(x),
                "y": float(y),
                "width": float(width),
                "height": float(height),
                "cx": float(cx),
                "cy": float(cy),
            }
        )

    components.sort(key=lambda item: item["area"], reverse=True)
    return labels, components


def _assign_grid_slots(components: List[Dict[str, float]]) -> Dict[str, Dict[str, float]]:
    if len(components) < EXPECTED_BLOUSE_COUNT:
        raise ValueError(f"Expected at least {EXPECTED_BLOUSE_COUNT} blouse regions, found {len(components)}")

    selected = components[:EXPECTED_BLOUSE_COUNT]
    y_sorted = sorted(selected, key=lambda item: item["cy"])
    split_line = (y_sorted[2]["cy"] + y_sorted[3]["cy"]) * 0.5

    top_row = sorted([item for item in selected if item["cy"] <= split_line], key=lambda item: item["cx"])
    bottom_row = sorted([item for item in selected if item["cy"] > split_line], key=lambda item: item["cx"])

    if len(top_row) != 3 or len(bottom_row) != 2:
        # Fallback: trust y-order split if the inferred line was ambiguous.
        top_row = sorted(y_sorted[:3], key=lambda item: item["cx"])
        bottom_row = sorted(y_sorted[3:], key=lambda item: item["cx"])

    if len(top_row) != 3 or len(bottom_row) != 2:
        raise ValueError("Unable to infer 3+2 blouse layout from connected components")

    return {
        "top_left": top_row[0],
        "top_center": top_row[1],
        "top_right": top_row[2],
        "bottom_left": bottom_row[0],
        "bottom_right": bottom_row[1],
    }


def _tight_crop_rgba(rgba: np.ndarray) -> np.ndarray:
    alpha = rgba[:, :, 3]
    ys, xs = np.where(alpha > 0)
    if xs.size == 0 or ys.size == 0:
        return rgba

    x0 = int(np.min(xs))
    x1 = int(np.max(xs)) + 1
    y0 = int(np.min(ys))
    y1 = int(np.max(ys)) + 1
    return rgba[y0:y1, x0:x1]


def _extract_component_rgba(
    image_bgr: np.ndarray,
    labels: np.ndarray,
    component: Dict[str, float],
    padding: int = 4,
) -> np.ndarray:
    image_height, image_width = image_bgr.shape[:2]

    label = int(component["label"])
    x0 = max(0, int(component["x"]) - padding)
    y0 = max(0, int(component["y"]) - padding)
    x1 = min(image_width, int(component["x"] + component["width"]) + padding)
    y1 = min(image_height, int(component["y"] + component["height"]) + padding)

    crop = image_bgr[y0:y1, x0:x1]
    component_mask = (labels[y0:y1, x0:x1] == label).astype(np.uint8) * 255
    color_mask = (np.max(crop, axis=2) > BLACK_BACKGROUND_THRESHOLD).astype(np.uint8) * 255
    alpha = cv2.bitwise_and(component_mask, color_mask)

    rgba = cv2.cvtColor(crop, cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = alpha
    return _tight_crop_rgba(rgba)


def _fit_into_placeholder(rgba: np.ndarray, target_width: int, target_height: int) -> Tuple[np.ndarray, Dict[str, float]]:
    if target_width <= 0 or target_height <= 0:
        raise ValueError("Placeholder dimensions must be positive")

    src_height, src_width = rgba.shape[:2]
    if src_width <= 0 or src_height <= 0:
        raise ValueError("Source image cannot be empty")

    scale = min(target_width / src_width, target_height / src_height)
    fitted_width = max(1, int(round(src_width * scale)))
    fitted_height = max(1, int(round(src_height * scale)))
    interpolation = cv2.INTER_AREA if scale < 1.0 else cv2.INTER_LINEAR

    resized = cv2.resize(rgba, (fitted_width, fitted_height), interpolation=interpolation)
    canvas = np.zeros((target_height, target_width, 4), dtype=np.uint8)

    offset_x = int((target_width - fitted_width) // 2)
    offset_y = int((target_height - fitted_height) // 2)
    canvas[offset_y : offset_y + fitted_height, offset_x : offset_x + fitted_width] = resized

    return canvas, {
        "x": float(offset_x),
        "y": float(offset_y),
        "width": float(fitted_width),
        "height": float(fitted_height),
        "scale": float(scale),
    }


def _encode_png_base64(image_rgba: np.ndarray) -> str:
    success, encoded = cv2.imencode(".png", image_rgba)
    if not success:
        return ""
    return base64.b64encode(encoded.tobytes()).decode("ascii")


def _as_int_pair(size: Tuple[int, int]) -> Tuple[int, int]:
    width, height = size
    return int(width), int(height)


def process_blouse_grid_image(
    image: np.ndarray,
    placeholder_sizes: Optional[Dict[str, Tuple[int, int]]] = None,
    output_dir: Optional[str] = None,
    include_image_arrays: bool = True,
    include_base64: bool = False,
) -> Dict[str, Any]:
    """Extract blouse assets from a labeled grid image and place them into placeholders.

    The grid-to-style mapping is deterministic:
    - Top left: Boat Neck Blouse
    - Top center: Backless Blouse
    - Top right: Princess Cut Blouse
    - Bottom left: Princess Cut Blouse
    - Bottom right: High Neck Blouse
    """
    image_bgr = _coerce_to_bgr(image)
    mask = _foreground_mask(image_bgr)
    labels, components = _extract_components(mask)
    grid_slots = _assign_grid_slots(components)

    sizes = dict(DEFAULT_PLACEHOLDER_SIZES)
    if placeholder_sizes:
        sizes.update(placeholder_sizes)

    output_path = Path(output_dir) if output_dir else None
    if output_path is not None:
        output_path.mkdir(parents=True, exist_ok=True)

    placeholders: Dict[str, Dict[str, Any]] = {}
    for grid_slot, blouse_type, placeholder_name in _SLOT_LAYOUT:
        component = grid_slots[grid_slot]
        source_rgba = _extract_component_rgba(image_bgr, labels, component)

        target_width, target_height = _as_int_pair(sizes[placeholder_name])
        canvas_rgba, placement = _fit_into_placeholder(source_rgba, target_width, target_height)

        record: Dict[str, Any] = {
            "blouse_type": blouse_type,
            "grid_position": grid_slot,
            "placeholder": placeholder_name,
            "source_bbox": {
                "x": int(component["x"]),
                "y": int(component["y"]),
                "width": int(component["width"]),
                "height": int(component["height"]),
            },
            "source_size": {
                "width": int(source_rgba.shape[1]),
                "height": int(source_rgba.shape[0]),
            },
            "canvas": {
                "width": int(target_width),
                "height": int(target_height),
            },
            "canvas_placement": {
                "x": int(placement["x"]),
                "y": int(placement["y"]),
                "width": int(placement["width"]),
                "height": int(placement["height"]),
                "scale": round(float(placement["scale"]), 6),
            },
        }

        if include_image_arrays:
            record["image_rgba"] = canvas_rgba

        if include_base64:
            record["image_base64"] = _encode_png_base64(canvas_rgba)

        if output_path is not None:
            file_name = f"{placeholder_name}.png"
            file_path = output_path / file_name
            cv2.imwrite(str(file_path), canvas_rgba)
            record["image_path"] = str(file_path)

        placeholders[placeholder_name] = record

    by_blouse_type: Dict[str, Any] = {
        "Boat Neck Blouse": placeholders["boatNeckPlaceholder"],
        "Backless Blouse": placeholders["backlessPlaceholder"],
        "Princess Cut Blouse": [
            placeholders["princessCut1Placeholder"],
            placeholders["princessCut2Placeholder"],
        ],
        "High Neck Blouse": placeholders["highNeckPlaceholder"],
    }

    return {
        "placeholders": placeholders,
        "by_blouse_type": by_blouse_type,
    }


def process_blouse_grid_file(
    image_path: str,
    placeholder_sizes: Optional[Dict[str, Tuple[int, int]]] = None,
    output_dir: Optional[str] = None,
    include_image_arrays: bool = False,
    include_base64: bool = False,
) -> Dict[str, Any]:
    image = cv2.imread(image_path, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Unable to load image: {image_path}")

    return process_blouse_grid_image(
        image=image,
        placeholder_sizes=placeholder_sizes,
        output_dir=output_dir,
        include_image_arrays=include_image_arrays,
        include_base64=include_base64,
    )
