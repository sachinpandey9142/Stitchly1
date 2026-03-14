"""Thread-safe SMPL model loading and mesh generation helpers."""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any, Dict, Tuple

try:
    import numpy as np
except ImportError as exc:  # pragma: no cover - exercised via runtime guards
    np = None
    _NUMPY_IMPORT_ERROR = exc
else:
    _NUMPY_IMPORT_ERROR = None

try:
    import torch
except ImportError as exc:  # pragma: no cover - exercised via runtime guards
    torch = None
    _TORCH_IMPORT_ERROR = exc
else:
    _TORCH_IMPORT_ERROR = None

try:
    import smplx
except ImportError as exc:  # pragma: no cover - exercised via runtime guards
    smplx = None
    _SMPLX_IMPORT_ERROR = exc
else:
    _SMPLX_IMPORT_ERROR = None


REQUIRED_MEASUREMENT_KEYS = (
    "shoulder_width_cm",
    "chest_cm",
    "waist_cm",
    "hip_width_cm",
    "arm_length_cm",
    "leg_length_cm",
)

MEASUREMENT_RANGES = {
    "shoulder_width_cm": (25.0, 70.0),
    "chest_cm": (60.0, 160.0),
    "waist_cm": (50.0, 150.0),
    "hip_width_cm": (25.0, 70.0),
    "arm_length_cm": (40.0, 90.0),
    "leg_length_cm": (60.0, 130.0),
}

_MODEL_LOCK = threading.Lock()
_SMPL_MODEL = None


def _require_runtime_dependencies() -> None:
    if _NUMPY_IMPORT_ERROR is not None:
        raise RuntimeError(f"numpy is required for avatar generation: {_NUMPY_IMPORT_ERROR}")
    if _TORCH_IMPORT_ERROR is not None:
        raise RuntimeError(f"torch is required for avatar generation: {_TORCH_IMPORT_ERROR}")
    if _SMPLX_IMPORT_ERROR is not None:
        raise RuntimeError(f"smplx is required for avatar generation: {_SMPLX_IMPORT_ERROR}")


def _model_root() -> Path:
    default_root = Path(__file__).resolve().parent / "models" / "smpl"
    return Path(os.getenv("SMPL_MODEL_PATH", default_root))


def validate_measurements(measurements: Dict[str, Any]) -> Dict[str, float]:
    """Validate required measurements and normalize them to floats."""
    missing = [key for key in REQUIRED_MEASUREMENT_KEYS if key not in measurements]
    if missing:
        raise ValueError(f"Missing required measurements: {', '.join(missing)}")

    normalized: Dict[str, float] = {}
    for key in REQUIRED_MEASUREMENT_KEYS:
        value = float(measurements[key])
        minimum, maximum = MEASUREMENT_RANGES[key]
        if value < minimum or value > maximum:
            raise ValueError(f"{key} must be between {minimum:.0f} and {maximum:.0f}")
        normalized[key] = value
    return normalized


def measurements_to_betas(measurements: Dict[str, float]):
    """Map measurements onto a normalized SMPL beta tensor with shape (1, 10)."""
    betas = np.zeros(10, dtype=np.float32)
    betas[0] = (measurements["shoulder_width_cm"] - 40.0) / 20.0
    betas[1] = (measurements["chest_cm"] - 90.0) / 40.0
    betas[2] = (measurements["waist_cm"] - 80.0) / 40.0
    betas[3] = (measurements["hip_width_cm"] - 45.0) / 25.0
    betas[4] = (measurements["leg_length_cm"] - 95.0) / 40.0
    betas = np.clip(betas, -3.0, 3.0)
    return torch.tensor(betas, dtype=torch.float32).unsqueeze(0)


def load_smpl_model():
    """Lazily load and cache the SMPL model in a thread-safe singleton."""
    global _SMPL_MODEL

    if _SMPL_MODEL is not None:
        return _SMPL_MODEL

    with _MODEL_LOCK:
        if _SMPL_MODEL is not None:
            return _SMPL_MODEL

        _require_runtime_dependencies()
        model_root = _model_root()
        if not model_root.exists():
            raise FileNotFoundError(f"SMPL model path does not exist: {model_root}")

        model = smplx.create(
            model_path=str(model_root),
            model_type="smpl",
            gender=os.getenv("SMPL_MODEL_GENDER", "neutral"),
            batch_size=1,
        )
        model.eval()
        _SMPL_MODEL = model
        return _SMPL_MODEL


def _normalize_mesh_scale(vertices, measurements: Dict[str, float]):
    """Normalize SMPL mesh vertices so the exported avatar matches real-world scale."""
    height_m = float(vertices[:, 1].max() - vertices[:, 1].min())
    if height_m <= 0.0:
        raise ValueError("Generated SMPL mesh has invalid height")

    # Approximate full stature from leg length using a common anthropometric ratio.
    target_height_cm = measurements["leg_length_cm"] / 0.53
    target_height_m = target_height_cm / 100.0
    scale_factor = target_height_m / height_m
    return vertices * scale_factor


def generate_body_mesh(measurements: Dict[str, Any]) -> Tuple[Any, Any]:
    """Generate scaled SMPL mesh vertices and faces for a measurement set."""
    normalized = validate_measurements(measurements)
    model = load_smpl_model()
    betas_tensor = measurements_to_betas(normalized)

    with torch.no_grad():
        output = model(betas=betas_tensor, return_verts=True)

    vertices = output.vertices[0].detach().cpu().numpy()
    vertices = _normalize_mesh_scale(vertices, normalized)
    faces = np.asarray(model.faces, dtype=np.int64)
    return vertices, faces
