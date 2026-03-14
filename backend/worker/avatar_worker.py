"""Optional Celery worker for distributed avatar generation."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Dict

from motor.motor_asyncio import AsyncIOMotorClient

try:
    from celery import Celery
except ImportError:  # pragma: no cover - optional dependency
    Celery = None

try:
    from ai.avatar_generator import generate_avatar
except ImportError:
    from ..ai.avatar_generator import generate_avatar


logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL") or os.getenv("CELERY_BROKER_URL")
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", REDIS_URL or "")
celery_app = None

if Celery is not None and REDIS_URL:
    celery_app = Celery("stitchly_avatar_worker", broker=REDIS_URL, backend=CELERY_RESULT_BACKEND or None)


def worker_enabled() -> bool:
    return celery_app is not None


def enqueue_avatar_generation_task(user_id: str, measurements: Dict[str, Any]) -> bool:
    """Enqueue avatar generation if Celery is configured; otherwise return False."""
    if celery_app is None:
        return False
    try:
        generate_avatar_task.delay(user_id, measurements)
        return True
    except Exception:
        logger.exception("Failed to enqueue avatar generation for user %s", user_id)
        return False


def _get_db():
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    client = AsyncIOMotorClient(mongo_url)
    return client, client[db_name]


async def _run_generate_avatar(user_id: str, measurements: Dict[str, Any]) -> str:
    client, db = _get_db()
    try:
        return await generate_avatar(user_id, measurements, db)
    finally:
        client.close()


def _generate_avatar_task_impl(user_id: str, measurements: Dict[str, Any]) -> str:
    return asyncio.run(_run_generate_avatar(user_id, measurements))


if celery_app is not None:
    @celery_app.task(name="generate_avatar_task")
    def generate_avatar_task(user_id: str, measurements: Dict[str, Any]) -> str:
        return _generate_avatar_task_impl(user_id, measurements)
else:
    def generate_avatar_task(user_id: str, measurements: Dict[str, Any]) -> str:
        return _generate_avatar_task_impl(user_id, measurements)
