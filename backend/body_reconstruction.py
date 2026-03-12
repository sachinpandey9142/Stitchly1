"""3D body reconstruction for Stitchly.

Uses SMPL-X when model files are configured; otherwise falls back to a calibrated
procedural mesh so the API remains available in CPU-only environments.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Tuple

import cv2
import numpy as np
import torch
import trimesh


@dataclass
class ReconstructionResult:
    vertices: np.ndarray
    mesh_path: str
    texture_path: str


class BodyReconstructor:
    def __init__(self, output_dir: str = "outputs") -> None:
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self._smpl_model = self._load_smpl_if_available()

    def _load_smpl_if_available(self):
        model_path = os.getenv("SMPLX_MODEL_PATH")
        if not model_path:
            return None
        try:
            import smplx  # optional dependency

            return smplx.create(
                model_path,
                model_type="smplx",
                gender="neutral",
                use_pca=False,
                batch_size=1,
            ).to(self.device)
        except Exception:
            return None

    def estimate_shape_params(self, measurements: Dict[str, float], height_cm: float) -> np.ndarray:
        """Map anthropometric measurements into 10D beta-like vector."""
        beta = np.zeros(10, dtype=np.float32)
        beta[0] = (measurements["chest_circumference"] - 95.0) / 30.0
        beta[1] = (measurements["waist_circumference"] - 82.0) / 28.0
        beta[2] = (measurements["hip_circumference"] - 98.0) / 30.0
        beta[3] = (measurements["shoulder_width"] - 42.0) / 12.0
        beta[4] = (height_cm - 170.0) / 20.0
        return beta

    def reconstruct(self, measurements: Dict[str, float], height_cm: float, texture_bgr: np.ndarray, scan_id: str) -> ReconstructionResult:
        vertices, faces = self._smpl_or_fallback_mesh(measurements, height_cm)
        texture_path = self._build_texture(texture_bgr, scan_id)
        mesh_path = self._export_mesh(vertices, faces, scan_id)
        return ReconstructionResult(vertices=vertices, mesh_path=mesh_path, texture_path=texture_path)

    def _smpl_or_fallback_mesh(self, measurements: Dict[str, float], height_cm: float) -> Tuple[np.ndarray, np.ndarray]:
        if self._smpl_model is not None:
            betas = torch.tensor(self.estimate_shape_params(measurements, height_cm), device=self.device).unsqueeze(0)
            body_pose = torch.zeros((1, 63), device=self.device)
            global_orient = torch.zeros((1, 3), device=self.device)
            output = self._smpl_model(betas=betas, body_pose=body_pose, global_orient=global_orient)
            vertices = output.vertices[0].detach().cpu().numpy()
            faces = self._smpl_model.faces.astype(np.int32)
            return vertices, faces

        # Fallback: ellipsoid proxy scaled by measurements.
        height_m = height_cm / 100.0
        x_radius = (measurements["shoulder_width"] / 100.0) * 0.28
        y_radius = height_m * 0.5
        z_radius = (measurements["waist_circumference"] / 100.0) / (2 * np.pi) * 1.25
        sphere = trimesh.creation.icosphere(subdivisions=4, radius=1.0)
        vertices = sphere.vertices.copy()
        vertices[:, 0] *= x_radius
        vertices[:, 1] *= y_radius
        vertices[:, 2] *= z_radius
        vertices[:, 1] -= vertices[:, 1].min()  # place feet at y=0
        faces = sphere.faces
        return vertices.astype(np.float32), faces.astype(np.int32)

    def _build_texture(self, front_bgr: np.ndarray, scan_id: str) -> str:
        """Extract dominant skin tone and build a flat texture map."""
        hsv = cv2.cvtColor(front_bgr, cv2.COLOR_BGR2HSV)
        lower = np.array([0, 20, 40], dtype=np.uint8)
        upper = np.array([35, 220, 255], dtype=np.uint8)
        mask = cv2.inRange(hsv, lower, upper)

        if int(mask.sum()) == 0:
            avg_color = np.mean(front_bgr.reshape(-1, 3), axis=0)
        else:
            pixels = front_bgr[mask > 0]
            avg_color = np.mean(pixels, axis=0)

        texture = np.zeros((1024, 1024, 3), dtype=np.uint8)
        texture[:] = np.clip(avg_color, 0, 255)

        texture_path = self.output_dir / f"{scan_id}_body_texture.png"
        cv2.imwrite(str(texture_path), texture)
        return str(texture_path)

    def _export_mesh(self, vertices: np.ndarray, faces: np.ndarray, scan_id: str) -> str:
        mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
        mesh_path = self.output_dir / f"{scan_id}_body_mesh.obj"
        mesh.export(mesh_path)
        return str(mesh_path)
