"""Avatar mesh generation and export pipeline."""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from pymongo import ReturnDocument

try:
    import trimesh
except ImportError as exc:  # pragma: no cover - exercised via runtime guards
    trimesh = None
    _TRIMESH_IMPORT_ERROR = exc
else:
    _TRIMESH_IMPORT_ERROR = None

try:
    from storage.avatar_storage import avatar_mesh_exists, save_avatar_mesh
except ImportError:
    from ..storage.avatar_storage import avatar_mesh_exists, save_avatar_mesh

from .smpl_model import generate_body_mesh, validate_measurements


logger = logging.getLogger(__name__)


def _ensure_trimesh_available() -> None:
    if _TRIMESH_IMPORT_ERROR is not None:
        raise RuntimeError(f"trimesh is required for avatar generation: {_TRIMESH_IMPORT_ERROR}")


def generate_body_mesh_data(measurements: Dict[str, Any]):
    """Compatibility wrapper for mesh generation from validated measurements."""
    return generate_body_mesh(measurements)


def export_mesh(vertices: Any, faces: Any, path: Optional[str] = None) -> bytes:
    """Export a SMPL mesh as GLB bytes, optionally mirroring it to a file path."""
    _ensure_trimesh_available()
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    mesh_bytes = mesh.export(file_type="glb")
    if isinstance(mesh_bytes, str):
        mesh_bytes = mesh_bytes.encode("utf-8")
    if path:
        with open(path, "wb") as handle:
            handle.write(mesh_bytes)
    return mesh_bytes


async def generate_avatar(user_id: str, measurements: Dict[str, Any], db) -> str:
    """Generate a user avatar mesh, prevent duplicates, and persist its public URL."""
    if not user_id:
        raise ValueError("user_id is required for avatar generation")
    normalized = validate_measurements(measurements)

    existing = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "avatar_mesh": 1, "avatar_generation_status": 1},
    )
    if (
        existing
        and existing.get("avatar_generation_status") == "ready"
        and existing.get("avatar_mesh")
        and avatar_mesh_exists(existing.get("avatar_mesh"))
    ):
        return existing["avatar_mesh"]

    locked_user = await db.users.find_one_and_update(
        {"id": user_id, "avatar_generation_status": {"$ne": "pending"}},
        {"$set": {"avatar_generation_status": "pending", "avatar_generation_error": None}},
        projection={"_id": 0, "avatar_mesh": 1, "avatar_generation_status": 1},
        return_document=ReturnDocument.AFTER,
    )
    if not locked_user:
        current = await db.users.find_one(
            {"id": user_id},
            {"_id": 0, "avatar_mesh": 1, "avatar_generation_status": 1},
        )
        if current and current.get("avatar_mesh"):
            return current["avatar_mesh"]
        raise RuntimeError(f"Avatar generation already in progress for user {user_id}")

    try:
        vertices, faces = generate_body_mesh_data(normalized)
        mesh_bytes = export_mesh(vertices, faces)
        mesh_url = save_avatar_mesh(user_id, mesh_bytes)
        await db.users.update_one(
            {"id": user_id},
            {
                "$set": {
                    "avatar_mesh": mesh_url,
                    "avatar_generation_status": "ready",
                    "avatar_generation_error": None,
                }
            },
        )
        return mesh_url
    except Exception as exc:
        logger.exception("Avatar generation failed for user %s", user_id)
        await db.users.update_one(
            {"id": user_id},
            {
                "$set": {
                    "avatar_generation_status": "failed",
                    "avatar_generation_error": str(exc),
                }
            },
        )
        raise
