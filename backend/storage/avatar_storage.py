"""Avatar mesh storage abstraction for local and S3-compatible backends."""

from __future__ import annotations

import io
import os
from pathlib import Path
from typing import Optional

try:
    import boto3
except ImportError as exc:  # pragma: no cover - exercised via runtime guards
    boto3 = None
    _BOTO3_IMPORT_ERROR = exc
else:
    _BOTO3_IMPORT_ERROR = None


BACKEND_ROOT = Path(__file__).resolve().parents[1]
LOCAL_AVATAR_DIR = BACKEND_ROOT / "avatars"
LOCAL_AVATAR_DIR.mkdir(parents=True, exist_ok=True)


def _storage_backend() -> str:
    return os.getenv("AVATAR_STORAGE_BACKEND", "local").strip().lower() or "local"


def local_avatar_public_url(filename: str) -> str:
    return f"/avatars/{filename}"


def avatar_mesh_exists(mesh_url: Optional[str]) -> bool:
    if not mesh_url:
        return False
    backend = _storage_backend()
    if backend == "s3":
        # Remote object existence checks are optional and intentionally skipped here.
        return True
    if not mesh_url.startswith("/avatars/"):
        return False
    filename = mesh_url.split("/avatars/", 1)[1]
    return (LOCAL_AVATAR_DIR / filename).exists()


def _build_filename(user_id: str) -> str:
    if not user_id:
        raise ValueError("user_id is required for avatar storage")
    return f"{user_id}.glb"


def _save_local_avatar_mesh(user_id: str, mesh_bytes: bytes) -> str:
    filename = _build_filename(user_id)
    file_path = LOCAL_AVATAR_DIR / filename
    file_path.write_bytes(mesh_bytes)
    return local_avatar_public_url(filename)


def _save_s3_avatar_mesh(user_id: str, mesh_bytes: bytes) -> str:
    if _BOTO3_IMPORT_ERROR is not None:
        raise RuntimeError(f"boto3 is required for S3 avatar storage: {_BOTO3_IMPORT_ERROR}")

    bucket = os.getenv("AVATAR_S3_BUCKET")
    endpoint_url: Optional[str] = os.getenv("AVATAR_S3_ENDPOINT_URL")
    region_name: Optional[str] = os.getenv("AVATAR_S3_REGION")
    public_base_url: Optional[str] = os.getenv("AVATAR_S3_PUBLIC_BASE_URL")
    if not bucket:
        raise RuntimeError("AVATAR_S3_BUCKET is required for S3 avatar storage")

    filename = _build_filename(user_id)
    object_key = f"avatars/{filename}"
    client = boto3.client("s3", endpoint_url=endpoint_url, region_name=region_name)
    client.upload_fileobj(
        io.BytesIO(mesh_bytes),
        bucket,
        object_key,
        ExtraArgs={"ContentType": "model/gltf-binary"},
    )

    if public_base_url:
        return f"{public_base_url.rstrip('/')}/{object_key}"
    if endpoint_url:
        return f"{endpoint_url.rstrip('/')}/{bucket}/{object_key}"
    return f"https://{bucket}.s3.amazonaws.com/{object_key}"


def save_avatar_mesh(user_id: str, mesh_bytes: bytes) -> str:
    """Persist avatar mesh bytes and return the public URL."""
    backend = _storage_backend()
    if backend == "s3":
        return _save_s3_avatar_mesh(user_id, mesh_bytes)
    return _save_local_avatar_mesh(user_id, mesh_bytes)
