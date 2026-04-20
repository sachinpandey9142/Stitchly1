"""Stitchly Backend API - 3-Sided Tailoring Marketplace"""

from fastapi import FastAPI, APIRouter, Depends, HTTPException, Body, Query, Request, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import HTMLResponse
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import hmac
import hashlib
from pathlib import Path
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone
from jose import jwt, JWTError
from passlib.context import CryptContext
import bcrypt
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import razorpay
import numpy as np
from fastapi import UploadFile, File, Form
import shutil

ROOT_DIR = Path(__file__).parent

try:
    from auth.security import create_access_token
    from orders.policies import VALID_ORDER_STATUSES, ensure_order_access, ensure_transition_allowed
    from dispatch.service import assign_order_to_reserved_driver, release_delivery_partner, reserve_delivery_partner
except ImportError:
    from .auth.security import create_access_token
    from .orders.policies import VALID_ORDER_STATUSES, ensure_order_access, ensure_transition_allowed
    from .dispatch.service import assign_order_to_reserved_driver, release_delivery_partner, reserve_delivery_partner

AVATAR_IMPORT_ERROR = None
try:
    from ai.avatar_generator import generate_avatar
    from storage.avatar_storage import LOCAL_AVATAR_DIR
    from worker.avatar_worker import enqueue_avatar_generation_task, worker_enabled
except Exception as exc:
    generate_avatar = None
    LOCAL_AVATAR_DIR = ROOT_DIR / "avatars"
    enqueue_avatar_generation_task = None
    worker_enabled = lambda: False
    AVATAR_IMPORT_ERROR = exc

AI_IMPORT_ERROR = None
try:
    import cv2
    from ai import pose_detector as pose_detector_module
    from ai.measurement_calculator import calculate_measurements
    detect_landmarks = getattr(pose_detector_module, "detect_landmarks", None)
    detect_pose = getattr(pose_detector_module, "detect_pose", None)
except Exception as exc:
    cv2 = None
    detect_landmarks = None
    detect_pose = None
    calculate_measurements = None
    AI_IMPORT_ERROR = exc

load_dotenv(ROOT_DIR / '.env')
LOCAL_AVATAR_DIR.mkdir(parents=True, exist_ok=True)

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:8081,exp://127.0.0.1:19000",
    ).split(",")
    if origin.strip()
]

RAZORPAY_KEY_ID = os.environ['RAZORPAY_KEY_ID']
RAZORPAY_KEY_SECRET = os.environ['RAZORPAY_KEY_SECRET']
razorpay_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=False)

app = FastAPI(title="Stitchly API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

DELIVERY_SEARCH_RADIUS_METERS = 7000
DELIVERY_EXTENDED_SEARCH_RADIUS_METERS = 12000
PENDING_DELIVERY_RETRY_STATUSES = ["accepted", "ready"]
ACTIVE_DELIVERY_ORDER_STATUSES = [
    "pickup_assigned",
    "delivery_assigned",
    "delivery_accepted",
    "picked_up",
    "out_for_delivery",
]


def normalize_geo_location(geo_location: Optional[dict]) -> Optional[dict]:
    if not geo_location:
        return None
    coordinates = geo_location.get("coordinates", [])
    if geo_location.get("type") != "Point" or len(coordinates) != 2:
        return None
    try:
        longitude = float(coordinates[0])
        latitude = float(coordinates[1])
    except (TypeError, ValueError):
        return None
    return {"type": "Point", "coordinates": [longitude, latitude]}


def build_geo_location(latitude: Optional[float], longitude: Optional[float]) -> Optional[dict]:
    if latitude is None or longitude is None:
        return None
    return normalize_geo_location(
        {"type": "Point", "coordinates": [float(longitude), float(latitude)]}
    )


def get_geo_location(document: Optional[dict]) -> Optional[dict]:
    if not document:
        return None
    return normalize_geo_location(document.get("geo_location"))


def build_safe_user(user: dict) -> dict:
    return {k: v for k, v in user.items() if k != "password_hash"}


def issue_token_for_user(user: dict) -> str:
    return create_access_token(user, JWT_SECRET, JWT_ALGORITHM)


def ensure_ai_dependencies():
    if AI_IMPORT_ERROR is not None:
        raise HTTPException(status_code=503, detail=f"AI dependencies unavailable: {AI_IMPORT_ERROR}")


def _save_upload_to_temp(upload: UploadFile, prefix: str) -> str:
    os.makedirs("temp", exist_ok=True)
    extension = Path(upload.filename or "capture.jpg").suffix or ".jpg"
    output_path = Path("temp") / f"{prefix}_{uuid.uuid4().hex}{extension}"
    with open(output_path, "wb") as buffer:
        shutil.copyfileobj(upload.file, buffer)
    return str(output_path)


def _detect_pose_view(image_path: str) -> dict:
    if callable(detect_pose):
        return detect_pose(image_path) or {}

    if callable(detect_landmarks):
        return {
            "landmarks": detect_landmarks(image_path) or [],
            "segmentation_mask": None,
            "silhouette": [],
            "pose_confidence": 0.0,
            "image_width": 1000,
            "image_height": 1000,
        }

    raise RuntimeError("Pose detector is unavailable")


def _format_landmarks_for_response(landmarks: list) -> list:
    formatted = []
    for landmark in landmarks or []:
        if isinstance(landmark, dict):
            formatted.append(
                {
                    "x": float(landmark.get("x", 0.0)),
                    "y": float(landmark.get("y", 0.0)),
                    "z": float(landmark.get("z", 0.0)),
                    "visibility": float(landmark.get("visibility", 0.0)),
                }
            )
    return formatted


def _format_overlay(view: dict) -> dict:
    return {
        "landmarks": _format_landmarks_for_response(view.get("landmarks", [])),
        "silhouette": [
            {
                "x": float(point.get("x", 0.0)),
                "y": float(point.get("y", 0.0)),
            }
            for point in (view.get("silhouette") or [])
            if isinstance(point, dict)
        ],
        "pose_confidence": float(view.get("pose_confidence", 0.0)),
    }


def _build_ui_measurements(measurements: dict) -> dict:
    return {
        "shoulder": round(float(measurements.get("shoulder_width_cm", 0.0)), 2),
        "chest": round(float(measurements.get("chest_cm", 0.0)), 2),
        "waist": round(float(measurements.get("waist_cm", 0.0)), 2),
        "hip": round(float(measurements.get("hip_circumference_cm", measurements.get("hip_width_cm", 0.0))), 2),
        "arm": round(float(measurements.get("arm_length_cm", 0.0)), 2),
        "leg": round(float(measurements.get("leg_length_cm", 0.0)), 2),
        "neck": round(float(measurements.get("neck_cm", 0.0)), 2),
    }


def _build_avatar_measurements(measurements: dict) -> dict:
    return {
        "shoulder_width_cm": float(measurements.get("shoulder_width_cm", 0.0)),
        "chest_cm": float(measurements.get("chest_cm", 0.0)),
        "waist_cm": float(measurements.get("waist_cm", 0.0)),
        "hip_width_cm": float(measurements.get("hip_width_cm", 0.0)),
        "arm_length_cm": float(measurements.get("arm_length_cm", 0.0)),
        "leg_length_cm": float(measurements.get("leg_length_cm", 0.0)),
    }


MEASUREMENT_NUMERIC_KEYS = (
    "shoulder_width_cm",
    "chest_cm",
    "waist_cm",
    "hip_width_cm",
    "hip_circumference_cm",
    "arm_length_cm",
    "leg_length_cm",
    "neck_cm",
    "torso_depth_cm",
)


def _non_empty_uploads(*uploads: Optional[UploadFile]) -> List[UploadFile]:
    return [upload for upload in uploads if upload is not None]


def _detect_pose_candidates(view_name: str, uploads: List[UploadFile]) -> List[dict]:
    candidates: List[dict] = []
    for index, upload in enumerate(uploads):
        image_path = _save_upload_to_temp(upload, f"{view_name}_{index + 1}")
        candidates.append(_detect_pose_view(image_path))
    return candidates


def _without_outliers(values: List[float]) -> List[float]:
    if len(values) < 3:
        return values

    q1 = float(np.percentile(values, 25))
    q3 = float(np.percentile(values, 75))
    iqr = q3 - q1
    if iqr <= 0.0:
        return values

    lower = q1 - (1.5 * iqr)
    upper = q3 + (1.5 * iqr)
    filtered = [value for value in values if lower <= value <= upper]
    return filtered or values


def _aggregate_measurement_candidates(candidates: List[dict]) -> dict:
    if not candidates:
        return {}
    if len(candidates) == 1:
        return dict(candidates[0])

    merged: Dict[str, Any] = {}

    for key in MEASUREMENT_NUMERIC_KEYS:
        values = [float(candidate.get(key, 0.0)) for candidate in candidates if candidate.get(key) is not None]
        if values:
            merged[key] = round(float(np.median(_without_outliers(values))), 2)

    measurement_keys = set()
    for candidate in candidates:
        measurement_keys.update((candidate.get("measurements") or {}).keys())
    if measurement_keys:
        merged["measurements"] = {}
        for key in measurement_keys:
            values = [
                float((candidate.get("measurements") or {}).get(key))
                for candidate in candidates
                if (candidate.get("measurements") or {}).get(key) is not None
            ]
            if values:
                merged["measurements"][key] = round(float(np.median(_without_outliers(values))), 2)

    confidence_keys = set()
    for candidate in candidates:
        confidence_keys.update((candidate.get("confidence") or {}).keys())
    merged_confidence: Dict[str, float] = {}
    for key in confidence_keys:
        values = [
            float((candidate.get("confidence") or {}).get(key))
            for candidate in candidates
            if (candidate.get("confidence") or {}).get(key) is not None
        ]
        if values:
            merged_confidence[key] = round(float(np.mean(_without_outliers(values))), 3)

    quality_values = [
        float(candidate.get("quality_score", (candidate.get("confidence") or {}).get("overall", 0.0)))
        for candidate in candidates
    ]
    quality_score = round(float(np.mean(_without_outliers(quality_values))), 3)
    if "overall" not in merged_confidence:
        merged_confidence["overall"] = quality_score
    merged["confidence"] = merged_confidence
    merged["quality_score"] = quality_score

    warnings: List[str] = []
    for candidate in candidates:
        for warning in candidate.get("warnings") or []:
            if warning and warning not in warnings:
                warnings.append(warning)
    merged["warnings"] = warnings

    detail_keys = set()
    for candidate in candidates:
        detail_keys.update((candidate.get("measurement_details") or {}).keys())
    merged_details: Dict[str, Dict[str, Any]] = {}
    for metric in detail_keys:
        metric_details = [
            (candidate.get("measurement_details") or {}).get(metric)
            for candidate in candidates
            if (candidate.get("measurement_details") or {}).get(metric)
        ]
        if not metric_details:
            continue

        first = metric_details[0]
        merged_metric: Dict[str, Any] = {}
        for numeric_field, precision in (
            ("value", 2),
            ("confidence", 3),
            ("landmark_confidence", 3),
            ("silhouette_clarity", 3),
            ("posture_score", 3),
        ):
            values = [
                float(detail.get(numeric_field))
                for detail in metric_details
                if detail.get(numeric_field) is not None
            ]
            if values:
                merged_metric[numeric_field] = round(float(np.mean(_without_outliers(values))), precision)

        merged_metric["method"] = first.get("method", "multi-view fusion")
        merged_details[metric] = merged_metric

    if merged_details:
        merged["measurement_details"] = merged_details

    pixel_to_cm_values = [float(candidate.get("pixel_to_cm", 0.0)) for candidate in candidates if candidate.get("pixel_to_cm")]
    if pixel_to_cm_values:
        merged["pixel_to_cm"] = round(float(np.mean(_without_outliers(pixel_to_cm_values))), 6)

    scale_keys = set()
    for candidate in candidates:
        scale_keys.update((candidate.get("scale_components") or {}).keys())
    if scale_keys:
        merged["scale_components"] = {}
        for key in scale_keys:
            values = [
                float((candidate.get("scale_components") or {}).get(key))
                for candidate in candidates
                if (candidate.get("scale_components") or {}).get(key) is not None
            ]
            if values:
                merged["scale_components"][key] = round(float(np.mean(_without_outliers(values))), 6)

    best_candidate = max(
        candidates,
        key=lambda candidate: float(candidate.get("quality_score", (candidate.get("confidence") or {}).get("overall", 0.0))),
    )
    if best_candidate.get("scan_artifacts"):
        merged["scan_artifacts"] = best_candidate.get("scan_artifacts")

    return merged


def _estimate_position_feedback(
    view_name: str,
    view: dict,
    pitch: Optional[float] = None,
    roll: Optional[float] = None,
) -> dict:
    def _clamp(value: float, minimum: float, maximum: float) -> float:
        return max(minimum, min(value, maximum))

    landmarks = view.get("landmarks") or []
    if len(landmarks) < 29:
        return {
            "instruction": "Move into frame",
            "ready_to_capture": False,
            "quality_score": 0.0,
        }

    gyro_penalty = 0.0
    tilt_severity = 0.0
    if pitch is not None and roll is not None:
        try:
            tilt_severity = max(abs(float(pitch)), abs(float(roll)))
        except (TypeError, ValueError):
            tilt_severity = 0.0

        if tilt_severity > 0.92:
            return {
                "instruction": "Reduce phone tilt",
                "ready_to_capture": False,
                "quality_score": 0.25,
            }
        if tilt_severity > 0.75:
            gyro_penalty = 0.06
        elif tilt_severity > 0.60:
            gyro_penalty = 0.03

    left_shoulder = landmarks[11]
    right_shoulder = landmarks[12]
    left_wrist = landmarks[15] if len(landmarks) > 15 else {"x": 0.0, "y": 0.0}
    right_wrist = landmarks[16] if len(landmarks) > 16 else {"x": 1.0, "y": 0.0}
    left_ankle = landmarks[27]
    right_ankle = landmarks[28]
    nose = landmarks[0]

    shoulder_mid_x = (float(left_shoulder.get("x", 0.0)) + float(right_shoulder.get("x", 0.0))) * 0.5
    left_arm_spread = abs(float(left_wrist.get("x", 0.0)) - shoulder_mid_x)
    right_arm_spread = abs(float(right_wrist.get("x", 1.0)) - shoulder_mid_x)
    arm_spread = max(left_arm_spread, right_arm_spread)
    body_height = max(float(left_ankle.get("y", 0.0)), float(right_ankle.get("y", 0.0))) - float(nose.get("y", 0.0))
    image_height = float(view.get("image_height", 1.0) or 1.0)
    body_height_px = body_height * image_height
    shoulder_tilt = abs(float(left_shoulder.get("y", 0.0)) - float(right_shoulder.get("y", 0.0)))
    shoulder_span = abs(float(left_shoulder.get("x", 0.0)) - float(right_shoulder.get("x", 0.0)))
    pose_confidence = float(view.get("pose_confidence", 0.0))
    silhouette = view.get("silhouette") or []

    critical_indices = (0, 11, 12, 23, 24, 27, 28)
    visibility_scores = []
    for index in critical_indices:
        if index < len(landmarks):
            visibility_scores.append(float(landmarks[index].get("visibility", 0.0)))
    landmark_visibility = float(np.mean(visibility_scores)) if visibility_scores else 0.0
    silhouette_score = _clamp(float(len(silhouette)) / 90.0, 0.0, 1.0)

    if body_height_px < image_height * 0.48:
        return {"instruction": "Move closer", "ready_to_capture": False, "quality_score": 0.15}
    if body_height_px > image_height * 0.97:
        return {"instruction": "Move back", "ready_to_capture": False, "quality_score": 0.15}

    if shoulder_mid_x < 0.32:
        return {"instruction": "Move right", "ready_to_capture": False, "quality_score": 0.2}
    if shoulder_mid_x > 0.68:
        return {"instruction": "Move left", "ready_to_capture": False, "quality_score": 0.2}

    if shoulder_tilt > 0.08:
        return {"instruction": "Stand straight", "ready_to_capture": False, "quality_score": 0.35}

    if view_name in {"front", "back"} and arm_spread > 0.25:
        return {
            "instruction": "Keep arms relaxed near torso",
            "ready_to_capture": False,
            "quality_score": 0.30,
        }

    if view_name == "side" and shoulder_span > 0.14:
        return {
            "instruction": "Turn more sideways (about 90°)",
            "ready_to_capture": False,
            "quality_score": 0.28,
        }

    if pose_confidence < 0.45 and landmark_visibility < 0.40:
        return {
            "instruction": "Hold steady",
            "ready_to_capture": False,
            "quality_score": max(0.35, pose_confidence, landmark_visibility),
        }

    body_height_ratio = body_height_px / max(image_height, 1.0)
    body_frame_score = _clamp(1.0 - (abs(body_height_ratio - 0.74) / 0.26), 0.0, 1.0)

    quality = _clamp(
        (0.36 * pose_confidence)
        + (0.33 * landmark_visibility)
        + (0.16 * silhouette_score)
        + (0.15 * body_frame_score)
        - gyro_penalty,
        0.0,
        1.0,
    )

    if quality < 0.50 or landmark_visibility < 0.38:
        instruction = "Hold steady"
        if tilt_severity > 0.75:
            instruction = "Slightly level the phone"
        return {
            "instruction": instruction,
            "ready_to_capture": False,
            "quality_score": round(quality, 3),
        }

    return {
        "instruction": "Good position",
        "ready_to_capture": True,
        "quality_score": round(quality, 3),
    }


async def set_delivery_partner_availability(delivery_partner_id: str, is_available: bool):
    if not delivery_partner_id:
        return
    await db.users.update_one(
        {"id": delivery_partner_id, "role": "delivery"},
        {"$set": {"is_available": is_available}},
    )


async def get_active_delivery_order_for_driver(delivery_partner_id: str) -> Optional[dict]:
    if not delivery_partner_id:
        return None
    return await db.orders.find_one(
        {
            "delivery_partner_id": delivery_partner_id,
            "status": {"$in": ACTIVE_DELIVERY_ORDER_STATUSES},
        },
        {"_id": 0, "id": 1, "status": 1},
    )


async def get_order_for_user(order_id: str, user: dict) -> dict:
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    ensure_order_access(user, order)
    return order


async def enrich_orders_with_locations(orders: List[dict]) -> List[dict]:
    if not orders:
        return []

    user_ids = {
        user_id
        for order in orders
        for user_id in [
            order.get("customer_id"),
            order.get("tailor_id"),
            order.get("delivery_partner_id"),
        ]
        if user_id
    }
    users = await db.users.find(
        {"id": {"$in": list(user_ids)}},
        {"_id": 0, "id": 1, "address": 1, "geo_location": 1, "phone": 1},
    ).to_list(len(user_ids) or 1)
    user_map = {user["id"]: user for user in users}

    enriched_orders = []
    for order in orders:
        enriched = dict(order)
        customer = user_map.get(order.get("customer_id"))
        tailor = user_map.get(order.get("tailor_id"))
        delivery_partner = user_map.get(order.get("delivery_partner_id"))

        enriched["customer_address"] = order.get("customer_address") or (customer or {}).get("address", "")
        enriched["tailor_address"] = order.get("tailor_address") or (tailor or {}).get("address", "")
        enriched["delivery_partner_phone"] = order.get("delivery_partner_phone") or (delivery_partner or {}).get("phone", "")
        enriched["customer_geo_location"] = order.get("customer_geo_location") or get_geo_location(customer)
        enriched["tailor_geo_location"] = order.get("tailor_geo_location") or get_geo_location(tailor)
        enriched["delivery_partner_geo_location"] = get_geo_location(delivery_partner)
        enriched_orders.append(enriched)

    return enriched_orders


async def enrich_order_with_locations(order: Optional[dict]) -> Optional[dict]:
    if not order:
        return None
    enriched_orders = await enrich_orders_with_locations([order])
    return enriched_orders[0] if enriched_orders else None


async def get_assignment_reference_geo(order: dict, phase: str) -> Optional[dict]:
    if phase == "return":
        tailor_geo_location = normalize_geo_location(order.get("tailor_geo_location"))
        if tailor_geo_location:
            return tailor_geo_location
        tailor = await db.users.find_one({"id": order["tailor_id"]}, {"_id": 0, "geo_location": 1})
        return get_geo_location(tailor)

    pickup_geo_location = normalize_geo_location(order.get("pickup_geo_location"))
    if pickup_geo_location:
        return pickup_geo_location

    customer_geo_location = normalize_geo_location(order.get("customer_geo_location"))
    if customer_geo_location:
        return customer_geo_location
    customer = await db.users.find_one({"id": order["customer_id"]}, {"_id": 0, "geo_location": 1})
    customer_geo_location = get_geo_location(customer)
    if customer_geo_location:
        return customer_geo_location

    # Fallback for legacy orders where customer pickup geo is unavailable.
    tailor_geo_location = normalize_geo_location(order.get("tailor_geo_location"))
    if tailor_geo_location:
        return tailor_geo_location
    tailor = await db.users.find_one({"id": order["tailor_id"]}, {"_id": 0, "geo_location": 1})
    return get_geo_location(tailor)


async def get_assignment_failure_reason(reference_geo_location: Optional[dict]) -> str:
    if not reference_geo_location:
        return "missing pickup location"

    base_query = {"role": "delivery", "status": "active"}
    available_query = {**base_query, "is_available": True}
    geo_query = {**available_query, "geo_location": {"$exists": True}}

    if await db.users.count_documents(base_query) == 0:
        return "no active delivery partners"
    if await db.users.count_documents(available_query) == 0:
        return "all delivery partners unavailable"
    if await db.users.count_documents(geo_query) == 0:
        return "available delivery partners missing geo_location"
    return f"no drivers within {DELIVERY_SEARCH_RADIUS_METERS}m"


async def find_candidate_delivery_partners(
    reference_geo_location: Optional[dict],
    exclude_ids: Optional[List[str]] = None,
    limit: int = 10,
    max_distance: int = DELIVERY_SEARCH_RADIUS_METERS,
):
    if not reference_geo_location:
        return []

    query: dict = {
        "role": "delivery",
        "status": "active",
        "is_available": True,
        "geo_location": {
            "$near": {
                "$geometry": reference_geo_location,
                "$maxDistance": max_distance,
            }
        },
    }
    if exclude_ids:
        query["id"] = {"$nin": exclude_ids}

    return await db.users.find(query, {"_id": 0}).limit(limit).to_list(limit)


async def assign_specific_delivery_partner_to_order(order: dict, delivery_partner: dict, phase: str, status: str):
    reserved_driver = await reserve_delivery_partner(db, delivery_partner["id"])
    if not reserved_driver:
        return None

    updated = await assign_order_to_reserved_driver(db, order, reserved_driver, phase, status)
    if updated:
        logger.info(
            "Assigned delivery partner %s to order %s for phase=%s",
            reserved_driver["id"],
            order.get("id"),
            phase,
        )
        return await enrich_order_with_locations(updated)

    await release_delivery_partner(db, reserved_driver["id"])
    return None


async def assign_delivery_partner_to_order(order: dict, phase: str, status: str, exclude_ids: Optional[List[str]] = None):
    reference_geo_location = await get_assignment_reference_geo(order, phase)
    if not reference_geo_location:
        logger.warning(
            "Assignment failed for order %s phase=%s: missing reference location",
            order.get("id"),
            phase,
        )
        return None

    if phase == "pickup" and not normalize_geo_location(order.get("pickup_geo_location")):
        now = datetime.now(timezone.utc).isoformat()
        await db.orders.update_one(
            {"id": order["id"]},
            {"$set": {"pickup_geo_location": reference_geo_location, "updated_at": now}},
        )
        order = {**order, "pickup_geo_location": reference_geo_location, "updated_at": now}

    attempted_ids = set(exclude_ids or [])
    for search_radius in sorted({DELIVERY_SEARCH_RADIUS_METERS, DELIVERY_EXTENDED_SEARCH_RADIUS_METERS}):
        candidates = await find_candidate_delivery_partners(
            reference_geo_location,
            exclude_ids=list(attempted_ids),
            max_distance=search_radius,
        )
        if not candidates:
            continue

        for delivery_partner in candidates:
            attempted_ids.add(delivery_partner["id"])
            assigned = await assign_specific_delivery_partner_to_order(order, delivery_partner, phase, status)
            if assigned:
                return assigned

    if len(attempted_ids) == len(exclude_ids or []):
        reason = await get_assignment_failure_reason(reference_geo_location)
        logger.info(
            "Assignment failed for order %s phase=%s: %s",
            order.get("id"),
            phase,
            reason,
        )
        return None

    logger.info(
        "Assignment failed for order %s phase=%s: all candidate drivers were taken concurrently",
        order.get("id"),
        phase,
    )
    return None


async def find_pending_orders_near_driver(delivery_partner: dict, limit: int = 25) -> List[dict]:
    geo_location = get_geo_location(delivery_partner)
    if not geo_location:
        return []

    pickup_orders = await db.orders.find(
        {
            "status": "accepted",
            "delivery_partner_id": "",
            "pickup_geo_location": {
                "$near": {
                    "$geometry": geo_location,
                    "$maxDistance": DELIVERY_EXTENDED_SEARCH_RADIUS_METERS,
                }
            },
        },
        {"_id": 0},
    ).limit(limit).to_list(limit)

    legacy_pickup_orders = await db.orders.find(
        {
            "status": "accepted",
            "delivery_partner_id": "",
            "$or": [
                {"pickup_geo_location": None},
                {"pickup_geo_location": {"$exists": False}},
            ],
            "tailor_geo_location": {
                "$near": {
                    "$geometry": geo_location,
                    "$maxDistance": DELIVERY_EXTENDED_SEARCH_RADIUS_METERS,
                }
            },
        },
        {"_id": 0},
    ).limit(limit).to_list(limit)

    hydrated_legacy_orders: List[dict] = []
    for order in legacy_pickup_orders:
        fallback_pickup_geo = await get_assignment_reference_geo(order, "pickup")
        if fallback_pickup_geo:
            await db.orders.update_one(
                {"id": order["id"]},
                {
                    "$set": {
                        "pickup_geo_location": fallback_pickup_geo,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                },
            )
            order = {**order, "pickup_geo_location": fallback_pickup_geo}
        hydrated_legacy_orders.append(order)

    pickup_order_map = {order["id"]: order for order in pickup_orders}
    for order in hydrated_legacy_orders:
        pickup_order_map.setdefault(order["id"], order)

    ready_orders = await db.orders.find(
        {
            "status": "ready",
            "delivery_partner_id": "",
            "tailor_geo_location": {
                "$near": {
                    "$geometry": geo_location,
                    "$maxDistance": DELIVERY_EXTENDED_SEARCH_RADIUS_METERS,
                }
            },
        },
        {"_id": 0},
    ).limit(limit).to_list(limit)

    return sorted(list(pickup_order_map.values()) + ready_orders, key=lambda order: order.get("created_at", ""))


async def dispatch_orders_for_delivery_partner(delivery_partner_id: str) -> int:
    delivery_partner = await db.users.find_one(
        {
            "id": delivery_partner_id,
            "role": "delivery",
            "status": "active",
            "is_available": True,
        },
        {"_id": 0},
    )
    if not delivery_partner:
        return 0
    if not get_geo_location(delivery_partner):
        logger.info("Assignment failed for driver %s: missing geo_location", delivery_partner_id)
        return 0

    nearby_orders = await find_pending_orders_near_driver(delivery_partner)
    for order in nearby_orders:
        phase = "return" if order["status"] == "ready" else "pickup"
        target_status = "delivery_assigned" if phase == "return" else "pickup_assigned"
        assigned = await assign_specific_delivery_partner_to_order(order, delivery_partner, phase, target_status)
        if assigned:
            logger.info(
                "Driver-centric dispatch assigned order %s to driver %s",
                order["id"],
                delivery_partner_id,
            )
            return 1

    logger.info("No nearby pending orders found for driver %s", delivery_partner_id)
    return 0


async def retry_pending_delivery_assignments() -> int:
    assigned_count = 0
    drivers = await db.users.find(
        {
            "role": "delivery",
            "status": "active",
            "is_available": True,
            "geo_location": {"$exists": True},
        },
        {"_id": 0, "id": 1},
    ).to_list(100)

    for driver in drivers:
        assigned_count += await dispatch_orders_for_delivery_partner(driver["id"])

    logger.info("Retried pending delivery assignments via driver-centric dispatch: assigned=%s", assigned_count)
    return assigned_count


# ===================== PYDANTIC MODELS =====================

class UserRegister(BaseModel):
    name: str
    email: str
    phone: str
    password: str
    role: str
    city: str = ""
    pincode: str = ""
    address: str = ""
    height: str | None = None
    weight: str | None = None
    gender: str | None = None
    bodyType: str | None = None
    body_measurements: Optional[dict] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

class UserLogin(BaseModel):
    email: str
    password: str

class UserProfileUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    city: Optional[str] = None
    pincode: Optional[str] = None
    address: Optional[str] = None
    experience: Optional[str] = None
    profile_photo: Optional[str] = None
    specialities: Optional[List[str]] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

class ServiceCreate(BaseModel):
    service_name: str
    category: str
    price: float
    complexity: Optional[str] = None
    price_min: Optional[float] = None
    price_max: Optional[float] = None

class OrderCreate(BaseModel):
    tailor_id: str
    service_id: Optional[str] = None
    service_type: str
    description: str
    measurement_type: str = "manual"
    send_reference_cloth: bool = False
    reference_cloth_note: Optional[str] = None
    reference_image: Optional[str] = None
    pickup_address: str
    delivery_address: Optional[str] = None
    payment_method: str = "online"

class ReviewCreate(BaseModel):
    order_id: str
    rating: int
    comment: str

class WorkingHoursUpdate(BaseModel):
    working_hours: dict

class SettingsUpdate(BaseModel):
    commission_percentage: float

class DeliveryAvailabilityUpdate(BaseModel):
    is_available: bool

class DeliveryLocationUpdate(BaseModel):
    latitude: float
    longitude: float


class DeliveryPickupDetailsUpdate(BaseModel):
    measurement_received: Optional[bool] = None
    measurement_note: Optional[str] = None
    measurements: Optional[Dict[str, float]] = None
    reference_cloth_received: Optional[bool] = None
    reference_cloth_note: Optional[str] = None


def normalize_pickup_measurements(measurements: Optional[Dict[str, float]]) -> Dict[str, float]:
    if not measurements or not isinstance(measurements, dict):
        return {}

    normalized: Dict[str, float] = {}
    for key, value in measurements.items():
        normalized_key = str(key or "").strip().lower().replace(" ", "_")
        if not normalized_key:
            continue
        try:
            numeric_value = round(float(value), 2)
        except (TypeError, ValueError):
            continue
        if numeric_value <= 0:
            continue
        normalized[normalized_key] = numeric_value
    return normalized


def normalize_service_payload(data: ServiceCreate) -> Dict[str, Any]:
    service_name = data.service_name.strip()
    category = data.category.strip()
    if not service_name or not category:
        raise HTTPException(status_code=400, detail="Service name and category are required")

    base_price = float(data.price)
    min_price = float(data.price_min) if data.price_min is not None else base_price
    max_price = float(data.price_max) if data.price_max is not None else max(base_price, min_price)

    if min_price <= 0 or max_price <= 0:
        raise HTTPException(status_code=400, detail="Price values must be greater than zero")

    if min_price > max_price:
        min_price, max_price = max_price, min_price

    if base_price < min_price or base_price > max_price:
        base_price = min_price

    return {
        "service_name": service_name,
        "category": category,
        "complexity": (data.complexity or "").strip(),
        "price": round(base_price, 2),
        "price_min": round(min_price, 2),
        "price_max": round(max_price, 2),
    }


# ===================== AUTH HELPERS =====================

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain: str, hashed: str) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False

def create_token(data: dict) -> str:
    user = {
        "id": data["user_id"],
        "role": data["role"],
        "token_version": data.get("token_version", 1),
    }
    return issue_token_for_user(user)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("user_id")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        user = await db.users.find_one({"id": user_id}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        if user.get("status") == "blocked":
            raise HTTPException(status_code=403, detail="Account blocked")
        token_version = int(payload.get("token_version", 0))
        if token_version != int(user.get("token_version", 1)):
            raise HTTPException(status_code=401, detail="Token has been revoked")
        return user
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


async def get_optional_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials:
        return None
    return await get_current_user(credentials)

async def require_admin(user=Depends(get_current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user

async def require_tailor(user=Depends(get_current_user)):
    if user["role"] != "tailor":
        raise HTTPException(status_code=403, detail="Tailor access required")
    return user

async def require_delivery(user=Depends(get_current_user)):
    if user["role"] != "delivery":
        raise HTTPException(status_code=403, detail="Delivery partner access required")
    return user

async def require_customer(user=Depends(get_current_user)):
    if user["role"] != "customer":
        raise HTTPException(status_code=403, detail="Customer access required")
    return user


async def save_user_measurements(user_id: str, measurements: dict):
    await db.users.update_one(
        {"id": user_id},
        {
            "$set": {
                "body_measurements": measurements,
                "avatar_mesh": None,
                "avatar_generation_status": "none",
                "avatar_generation_error": None,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        },
    )


async def generate_avatar_for_user(user_id: str, measurements: dict):
    if generate_avatar is None:
        raise RuntimeError(f"Avatar generator is unavailable: {AVATAR_IMPORT_ERROR}")
    if not measurements or "error" in measurements:
        raise ValueError("Valid measurements are required for avatar generation")

    try:
        await generate_avatar(user_id, measurements, db)
    except Exception:
        logger.exception("Avatar generation failed for user %s", user_id)
        raise


def schedule_avatar_generation(background_tasks: BackgroundTasks, user_id: str, measurements: dict):
    if enqueue_avatar_generation_task and worker_enabled() and enqueue_avatar_generation_task(user_id, measurements):
        logger.info("Enqueued avatar generation for user %s via worker", user_id)
        return

    background_tasks.add_task(generate_avatar_for_user, user_id, measurements)
    logger.info("Scheduled avatar generation for user %s via FastAPI background task", user_id)


# ===================== AUTH ROUTES =====================

@api_router.post("/auth/register")
async def register(data: UserRegister):
    existing = await db.users.find_one({"email": data.email.lower()}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    if data.role not in ["customer", "tailor", "delivery"]:
        raise HTTPException(status_code=400, detail="Invalid role")

    city_val = data.city.strip() if data.city else ""
    pincode_val = data.pincode.strip() if data.pincode else ""
    address_val = data.address.strip() if data.address else ""
    location_str = f"{city_val}, {pincode_val}".strip(", ") if city_val or pincode_val else ""
    geo_location = build_geo_location(data.latitude, data.longitude)
    customer_measurements = data.body_measurements if data.role == "customer" and isinstance(data.body_measurements, dict) else {}
    
    user = {
        "id": str(uuid.uuid4()),
        "name": data.name,
        "email": data.email.lower(),
        "phone": data.phone,
        "password_hash": hash_password(data.password),
        "role": data.role,
        "city": city_val,
        "pincode": pincode_val,
        "address": address_val,
        "location": location_str,
        "geo_location": geo_location,
        "gender": data.gender,
        "height": data.height if data.role == "customer" else None,
        "weight": data.weight if data.role == "customer" else None,
        "bodyType": data.bodyType if data.role == "customer" else None,
        "rating": 0.0,
        "rating_count": 0,
        "status": "pending" if data.role == "tailor" else "active",
        "is_available": data.role == "delivery",
        "specialities": [],
        "experience": "",
        "working_hours": {},
        "profile_photo": "",
        "body_measurements": customer_measurements,
        "avatar_mesh": None,
        "avatar_generation_status": "none",
        "avatar_generation_error": None,
        "token_version": 1,
        
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user)
    user.pop("_id", None)

    safe_user = build_safe_user(user)
    token = issue_token_for_user(user)
    return {"token": token, "user": safe_user}

@api_router.post("/auth/login")
async def login(data: UserLogin):
    user = await db.users.find_one({"email": data.email.lower()}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    password_hash = user.get("password_hash")
    if not verify_password(data.password, password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if user.get("status") == "blocked":
        raise HTTPException(status_code=403, detail="Account blocked")

    token = issue_token_for_user(user)
    safe_user = build_safe_user(user)
    return {"token": token, "user": safe_user}


@api_router.get("/auth/me")
async def get_me(user=Depends(get_current_user)):
    return {k: v for k, v in user.items() if k != "password_hash"}

@api_router.put("/auth/profile")
async def update_profile(data: UserProfileUpdate, user=Depends(get_current_user)):
    update = {k: v for k, v in data.dict(exclude_unset=True).items() if v is not None}
    latitude = update.pop("latitude", None)
    longitude = update.pop("longitude", None)
    if latitude is not None or longitude is not None:
        existing_geo = get_geo_location(user)
        existing_longitude = existing_geo["coordinates"][0] if existing_geo else None
        existing_latitude = existing_geo["coordinates"][1] if existing_geo else None
        update["geo_location"] = build_geo_location(
            latitude if latitude is not None else existing_latitude,
            longitude if longitude is not None else existing_longitude,
        )
    # Auto-compute location from city + pincode if provided
    if "city" in update or "pincode" in update:
        city = update.get("city", user.get("city", ""))
        pincode = update.get("pincode", user.get("pincode", ""))
        update["location"] = f"{city}, {pincode}".strip(", ") if city or pincode else ""
    if update:
        await db.users.update_one({"id": user["id"]}, {"$set": update})
    updated = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    return updated


# ===================== TAILOR LISTING (for customers) =====================

@api_router.get("/tailors")
async def list_tailors(
    specialty: Optional[str] = None,
    min_rating: Optional[float] = None,
    max_price: Optional[float] = None,
    location: Optional[str] = None,
    city: Optional[str] = None,
    pincode: Optional[str] = None,
    search: Optional[str] = None,
):
    query = {"role": "tailor", "status": "active"}
    if specialty:
        query["specialities"] = {"$in": [specialty]}
    if min_rating:
        query["rating"] = {"$gte": min_rating}
    if city:
        query["city"] = {"$regex": f"^{city}$", "$options": "i"}
    elif pincode:
        query["pincode"] = pincode
    elif location:
        query["$or"] = [
            {"city": {"$regex": location, "$options": "i"}},
            {"pincode": {"$regex": location, "$options": "i"}},
            {"location": {"$regex": location, "$options": "i"}},
        ]
    if search:
        search_cond = [
            {"name": {"$regex": search, "$options": "i"}},
            {"specialities": {"$elemMatch": {"$regex": search, "$options": "i"}}},
        ]
        if "$or" in query:
            query["$and"] = [{"$or": query.pop("$or")}, {"$or": search_cond}]
        else:
            query["$or"] = search_cond

    tailors = await db.users.find(query, {"_id": 0, "password_hash": 0}).to_list(100)
    for tailor in tailors:
        services = await db.tailor_services.find({"tailor_id": tailor["id"]}, {"_id": 0}).to_list(100)
        tailor["services"] = services
        if services:
            min_prices = [float(s.get("price_min", s.get("price", 0))) for s in services]
            max_prices = [float(s.get("price_max", s.get("price", 0))) for s in services]
            tailor["min_price"] = min(min_prices)
            tailor["max_price"] = max(max_prices)
        else:
            tailor["min_price"] = 0
            tailor["max_price"] = 0

    if max_price:
        tailors = [t for t in tailors if t.get("min_price", 0) <= max_price]
    return tailors

@api_router.get("/tailors/{tailor_id}")
async def get_tailor(tailor_id: str):
    tailor = await db.users.find_one({"id": tailor_id, "role": "tailor"}, {"_id": 0, "password_hash": 0})
    if not tailor:
        raise HTTPException(status_code=404, detail="Tailor not found")
    services = await db.tailor_services.find({"tailor_id": tailor_id}, {"_id": 0}).to_list(100)
    reviews = await db.reviews.find({"tailor_id": tailor_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    for review in reviews:
        customer = await db.users.find_one({"id": review["customer_id"]}, {"_id": 0, "name": 1})
        review["customer_name"] = customer["name"] if customer else "Unknown"
    tailor["services"] = services
    tailor["reviews"] = reviews
    return tailor


# ===================== ORDER ROUTES =====================

@api_router.post("/orders")
async def create_order(data: OrderCreate, user=Depends(require_customer)):
    tailor = await db.users.find_one({"id": data.tailor_id, "role": "tailor"}, {"_id": 0})
    if not tailor:
        raise HTTPException(status_code=404, detail="Tailor not found")

    service = None
    if data.service_id:
        service = await db.tailor_services.find_one(
            {"id": data.service_id, "tailor_id": data.tailor_id}, {"_id": 0}
        )

    if not service:
        service = await db.tailor_services.find_one(
            {"tailor_id": data.tailor_id, "service_name": data.service_type}, {"_id": 0}
        )

    base_price = float(service.get("price", service.get("price_min", 500))) if service else 500.0

    measurement_type = (data.measurement_type or "manual").strip().lower()
    if measurement_type not in {"ai", "manual", "expert"}:
        measurement_type = "manual"

    # Expert-assisted measurement carries an extra fee, while AI/manual stay free.
    measurement_fee = 49.0 if measurement_type == "expert" else 0.0
    price = round(base_price + measurement_fee, 2)

    settings = await db.settings.find_one({"key": "commission_percentage"}, {"_id": 0})
    commission_pct = settings["value"] if settings else 10.0
    commission_amount = round(price * commission_pct / 100, 2)

    customer_geo_location = get_geo_location(user)
    tailor_geo_location = get_geo_location(tailor)
    pickup_geo_location = customer_geo_location or tailor_geo_location

    order = {
        "id": str(uuid.uuid4()),
        "customer_id": user["id"],
        "customer_name": user["name"],
        "customer_phone": user["phone"],
        "customer_city": user.get("city", ""),
        "customer_address": user.get("address", "") or data.pickup_address,
        "customer_geo_location": customer_geo_location,
        "tailor_id": data.tailor_id,
        "tailor_name": tailor["name"],
        "tailor_phone": tailor["phone"],
        "tailor_city": tailor.get("city", ""),
        "tailor_address": tailor.get("address", ""),
        "tailor_geo_location": tailor_geo_location,
        "pickup_geo_location": pickup_geo_location,
        "delivery_partner_id": "",
        "delivery_partner_name": "",
        "delivery_partner_phone": "",
        "delivery_phase": "",
        "service_id": (service or {}).get("id", data.service_id or ""),
        "service_type": (service or {}).get("service_name", data.service_type),
        "service_category": (service or {}).get("category", ""),
        "service_complexity": (service or {}).get("complexity", ""),
        "service_price_min": float((service or {}).get("price_min", base_price)),
        "service_price_max": float((service or {}).get("price_max", base_price)),
        "service_base_price": round(base_price, 2),
        "description": data.description,
        "reference_image": data.reference_image or "",
        "measurement_type": measurement_type,
        "measurement_fee": measurement_fee,
        "send_reference_cloth": bool(data.send_reference_cloth),
        "reference_cloth_note": (data.reference_cloth_note or "").strip(),
        "pickup_measurement_received": False,
        "pickup_measurement_note": "",
        "pickup_measurements": {},
        "pickup_reference_cloth_received": False,
        "pickup_reference_cloth_note": "",
        "pickup_details_updated_at": "",
        "pickup_details_updated_by": "",
        "pickup_address": data.pickup_address,
        "delivery_address": data.delivery_address or data.pickup_address,
        "price": price,
        "commission_amount": commission_amount,
        "status": "placed",
        "payment_status": "pending" if data.payment_method == "online" else "cod",
        "payment_method": data.payment_method,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    await db.orders.insert_one(order)
    order.pop("_id", None)
    return await enrich_order_with_locations(order)

@api_router.get("/orders/my")
async def get_my_orders(user=Depends(require_customer)):
    orders = await db.orders.find({"customer_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return await enrich_orders_with_locations(orders)

@api_router.get("/orders/tailor")
async def get_tailor_orders(user=Depends(require_tailor)):
    orders = await db.orders.find({"tailor_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return await enrich_orders_with_locations(orders)

@api_router.get("/orders/delivery")
async def get_delivery_orders(user=Depends(require_delivery)):
    orders = await db.orders.find({"delivery_partner_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return await enrich_orders_with_locations(orders)

@api_router.get("/orders/{order_id}")
async def get_order(order_id: str, user=Depends(get_current_user)):
    order = await get_order_for_user(order_id, user)
    return await enrich_order_with_locations(order)

@api_router.put("/orders/{order_id}/accept")
async def accept_order(order_id: str, user=Depends(require_tailor)):
    order = await db.orders.find_one({"id": order_id, "tailor_id": user["id"]}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["status"] not in ["placed", "accepted", "pickup_assigned"]:
        raise HTTPException(status_code=400, detail="Order cannot be accepted in current status")

    assigned = await assign_delivery_partner_to_order(order, "pickup", "pickup_assigned")
    now = datetime.now(timezone.utc).isoformat()
    if assigned:
        await db.orders.update_one({"id": order_id}, {"$set": {"tailor_accepted_at": now}})
        updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
        return await enrich_order_with_locations(updated)

    await db.orders.update_one(
        {"id": order_id},
        {"$set": {
            "status": "accepted",
            "delivery_partner_id": "",
            "delivery_partner_name": "",
            "delivery_partner_phone": "",
            "delivery_phase": "",
            "tailor_accepted_at": now,
            "updated_at": now,
        }}
    )
    await retry_pending_delivery_assignments()
    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return await enrich_order_with_locations(updated)

@api_router.put("/orders/{order_id}/reject")
async def reject_order(order_id: str, user=Depends(require_tailor)):
    order = await db.orders.find_one({"id": order_id, "tailor_id": user["id"]}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    await release_delivery_partner(db, order.get("delivery_partner_id", ""))
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {
            "status": "rejected",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }}
    )
    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return await enrich_order_with_locations(updated)

@api_router.put("/orders/{order_id}/status")
async def update_order_status(order_id: str, status: str = Body(..., embed=True), user=Depends(get_current_user)):
    order = await get_order_for_user(order_id, user)
    ensure_transition_allowed(user, order, status)

    if status == "accepted":
        assigned = await assign_delivery_partner_to_order(order, "pickup", "pickup_assigned")
        now = datetime.now(timezone.utc).isoformat()
        if assigned:
            await db.orders.update_one({"id": order_id}, {"$set": {"tailor_accepted_at": now}})
            updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
            return await enrich_order_with_locations(updated)

        await db.orders.update_one(
            {"id": order_id, "tailor_id": user["id"]},
            {"$set": {
                "status": "accepted",
                "delivery_partner_id": "",
                "delivery_partner_name": "",
                "delivery_partner_phone": "",
                "delivery_phase": "",
                "tailor_accepted_at": now,
                "updated_at": now,
            }},
        )
        await retry_pending_delivery_assignments()
        updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
        return await enrich_order_with_locations(updated)

    if status == "rejected":
        await release_delivery_partner(db, order.get("delivery_partner_id", ""))
        await db.orders.update_one(
            {"id": order_id},
            {"$set": {"status": "rejected", "updated_at": datetime.now(timezone.utc).isoformat()}},
        )
        updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
        return await enrich_order_with_locations(updated)

    if status == "ready":
        assigned = await assign_delivery_partner_to_order(order, "return", "delivery_assigned")
        if assigned:
            return assigned

    update_data = {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}
    if status in ["delivered_to_tailor", "ready", "cancelled"]:
        update_data["delivery_partner_id"] = ""
        update_data["delivery_partner_name"] = ""
        update_data["delivery_partner_phone"] = ""
        update_data["delivery_phase"] = ""
    await db.orders.update_one({"id": order_id}, {"$set": update_data})
    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return await enrich_order_with_locations(updated)


# ===================== REVIEW ROUTES =====================

@api_router.post("/reviews")
async def create_review(data: ReviewCreate, user=Depends(require_customer)):
    order = await db.orders.find_one({"id": data.order_id, "customer_id": user["id"]}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    existing = await db.reviews.find_one({"order_id": data.order_id}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Review already exists for this order")

    review = {
        "id": str(uuid.uuid4()),
        "order_id": data.order_id,
        "customer_id": user["id"],
        "customer_name": user["name"],
        "tailor_id": order["tailor_id"],
        "rating": max(1, min(5, data.rating)),
        "comment": data.comment,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.reviews.insert_one(review)
    review.pop("_id", None)

    all_reviews = await db.reviews.find({"tailor_id": order["tailor_id"]}, {"_id": 0}).to_list(1000)
    avg_rating = round(sum(r["rating"] for r in all_reviews) / len(all_reviews), 1)
    await db.users.update_one(
        {"id": order["tailor_id"]},
        {"$set": {"rating": avg_rating, "rating_count": len(all_reviews)}}
    )
    return review

@api_router.get("/reviews/tailor/{tailor_id}")
async def get_tailor_reviews(tailor_id: str):
    reviews = await db.reviews.find({"tailor_id": tailor_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return reviews


# ===================== TAILOR SERVICE ROUTES =====================

@api_router.get("/tailor/services")
async def get_my_services(user=Depends(require_tailor)):
    services = await db.tailor_services.find({"tailor_id": user["id"]}, {"_id": 0}).to_list(100)
    return services

@api_router.post("/tailor/services")
async def add_service(data: ServiceCreate, user=Depends(require_tailor)):
    normalized = normalize_service_payload(data)
    service = {
        "id": str(uuid.uuid4()),
        "tailor_id": user["id"],
        **normalized,
    }
    await db.tailor_services.insert_one(service)
    service.pop("_id", None)
    return service

@api_router.put("/tailor/services/{service_id}")
async def update_service(service_id: str, data: ServiceCreate, user=Depends(require_tailor)):
    normalized = normalize_service_payload(data)
    result = await db.tailor_services.update_one(
        {"id": service_id, "tailor_id": user["id"]},
        {"$set": normalized}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Service not found")
    updated = await db.tailor_services.find_one({"id": service_id}, {"_id": 0})
    return updated

@api_router.delete("/tailor/services/{service_id}")
async def delete_service(service_id: str, user=Depends(require_tailor)):
    result = await db.tailor_services.delete_one({"id": service_id, "tailor_id": user["id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Service not found")
    return {"message": "Service deleted"}

@api_router.put("/tailor/working-hours")
async def update_working_hours(data: WorkingHoursUpdate, user=Depends(require_tailor)):
    await db.users.update_one({"id": user["id"]}, {"$set": {"working_hours": data.working_hours}})
    return {"message": "Working hours updated"}

@api_router.get("/tailor/earnings")
async def get_tailor_earnings(user=Depends(require_tailor)):
    delivered = await db.orders.find(
        {"tailor_id": user["id"], "status": "delivered"}, {"_id": 0}
    ).to_list(1000)
    total_earnings = sum(o["price"] - o["commission_amount"] for o in delivered)

    pending = await db.orders.find(
        {"tailor_id": user["id"], "status": {"$in": ["accepted", "in_stitching", "completed", "ready"]}}, {"_id": 0}
    ).to_list(1000)
    pending_earnings = sum(o["price"] - o["commission_amount"] for o in pending)

    withdrawals = await db.withdrawals.find({"tailor_id": user["id"]}, {"_id": 0}).to_list(100)
    total_withdrawn = sum(w["amount"] for w in withdrawals if w["status"] == "approved")

    return {
        "total_earnings": total_earnings,
        "pending_earnings": pending_earnings,
        "total_withdrawn": total_withdrawn,
        "available_balance": total_earnings - total_withdrawn,
        "total_orders": len(delivered),
        "recent_orders": delivered[:10],
        "withdrawals": withdrawals
    }

@api_router.post("/tailor/withdraw")
async def request_withdrawal(amount: float = Body(..., embed=True), user=Depends(require_tailor)):
    withdrawal = {
        "id": str(uuid.uuid4()),
        "tailor_id": user["id"],
        "tailor_name": user["name"],
        "amount": amount,
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    await db.withdrawals.insert_one(withdrawal)
    withdrawal.pop("_id", None)
    return withdrawal


# ===================== TAILOR SPECIALITIES =====================

class TailorSpecialitiesUpdate(BaseModel):
    specialities: List[str]


@api_router.put("/tailor/specialities")
async def update_tailor_specialities(
    data: TailorSpecialitiesUpdate,
    user=Depends(require_tailor)
):
    await db.users.update_one(
        {"id": user["id"]},
        {
            "$set": {
                "specialities": data.specialities,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }
        }
    )

    updated = await db.users.find_one(
        {"id": user["id"]},
        {"_id": 0, "password_hash": 0}
    )

    return {
        "message": "Specialities updated",
        "specialities": updated.get("specialities", [])
    }

# ===================== DELIVERY ROUTES =====================

@api_router.put("/delivery/availability")
async def update_delivery_availability(data: DeliveryAvailabilityUpdate, user=Depends(require_delivery)):
    if data.is_available:
        active_order = await get_active_delivery_order_for_driver(user["id"])
        if active_order:
            await db.users.update_one(
                {"id": user["id"]},
                {"$set": {"is_available": False}},
            )
            logger.info(
                "Ignoring availability enable for driver %s because order %s is still active in status=%s",
                user["id"],
                active_order["id"],
                active_order["status"],
            )
            return await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})

    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"is_available": data.is_available}},
    )
    if data.is_available:
        await dispatch_orders_for_delivery_partner(user["id"])
    updated = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    return updated


@api_router.get("/user/avatar")
async def get_user_avatar(user=Depends(get_current_user)):
    current = await db.users.find_one(
        {"id": user["id"]},
        {"_id": 0, "avatar_mesh": 1, "avatar_generation_status": 1},
    )
    status = (current or {}).get("avatar_generation_status") or "none"
    mesh_url = (current or {}).get("avatar_mesh")
    if not mesh_url:
        return {"avatar_ready": False, "mesh_url": None, "status": status}
    return {"avatar_ready": True, "mesh_url": mesh_url, "status": "ready"}

@api_router.put("/delivery/location")
async def update_delivery_location(data: DeliveryLocationUpdate, user=Depends(require_delivery)):
    geo_location = build_geo_location(data.latitude, data.longitude)
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"geo_location": geo_location}},
    )
    await dispatch_orders_for_delivery_partner(user["id"])
    updated = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    return updated

@api_router.get("/delivery/assignments")
async def get_delivery_assignments(user=Depends(require_delivery)):
    orders = await db.orders.find(
        {
            "delivery_partner_id": user["id"],
            "status": {"$in": ["pickup_assigned", "delivery_assigned", "delivery_accepted", "picked_up", "out_for_delivery"]},
        },
        {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return await enrich_orders_with_locations(orders)

@api_router.put("/delivery/{order_id}/accept")
async def accept_delivery_assignment(order_id: str, user=Depends(require_delivery)):
    order = await db.orders.find_one({"id": order_id, "delivery_partner_id": user["id"]}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["status"] not in ["pickup_assigned", "delivery_assigned"]:
        raise HTTPException(status_code=400, detail="Order cannot be accepted in current status")

    phase = order.get("delivery_phase") or ("return" if order["status"] == "delivery_assigned" else "pickup")
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {
            "status": "delivery_accepted",
            "delivery_phase": phase,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }}
    )
    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return await enrich_order_with_locations(updated)

@api_router.put("/delivery/{order_id}/decline")
async def decline_delivery_assignment(order_id: str, user=Depends(require_delivery)):
    order = await db.orders.find_one({"id": order_id, "delivery_partner_id": user["id"]}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["status"] not in ["pickup_assigned", "delivery_assigned"]:
        raise HTTPException(status_code=400, detail="Order cannot be declined in current status")

    phase = order.get("delivery_phase") or ("return" if order["status"] == "delivery_assigned" else "pickup")
    await db.orders.update_one(
        {"id": order_id, "delivery_partner_id": user["id"]},
        {"$set": {
            "delivery_partner_id": "",
            "delivery_partner_name": "",
            "delivery_partner_phone": "",
            "delivery_phase": phase,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    await release_delivery_partner(db, user["id"])
    cleared_order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    reassigned = await assign_delivery_partner_to_order(cleared_order, phase, order["status"], exclude_ids=[user["id"]])
    if reassigned:
        return reassigned

    fallback_status = "accepted" if phase == "pickup" else "ready"
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {
            "delivery_partner_id": "",
            "delivery_partner_name": "",
            "delivery_partner_phone": "",
            "delivery_phase": "",
            "status": fallback_status,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }}
    )
    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return await enrich_order_with_locations(updated)


@api_router.put("/delivery/{order_id}/pickup-details")
async def update_pickup_details(order_id: str, data: DeliveryPickupDetailsUpdate, user=Depends(require_delivery)):
    order = await db.orders.find_one({"id": order_id, "delivery_partner_id": user["id"]}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    phase = order.get("delivery_phase") or ("return" if order["status"] == "delivery_assigned" else "pickup")
    if phase != "pickup":
        raise HTTPException(status_code=400, detail="Pickup details are only allowed for pickup assignments")

    if order["status"] not in ["pickup_assigned", "delivery_accepted", "picked_up"]:
        raise HTTPException(status_code=400, detail="Pickup details cannot be updated in current status")

    update_data: Dict[str, Any] = {}
    if data.measurement_received is not None:
        update_data["pickup_measurement_received"] = bool(data.measurement_received)
    if data.measurement_note is not None:
        update_data["pickup_measurement_note"] = data.measurement_note.strip()
    if data.measurements is not None:
        normalized_measurements = normalize_pickup_measurements(data.measurements)
        update_data["pickup_measurements"] = normalized_measurements
        if normalized_measurements:
            update_data["pickup_measurement_received"] = True
    if data.reference_cloth_received is not None:
        update_data["pickup_reference_cloth_received"] = bool(data.reference_cloth_received)
    if data.reference_cloth_note is not None:
        update_data["pickup_reference_cloth_note"] = data.reference_cloth_note.strip()

    if not update_data:
        return await enrich_order_with_locations(order)

    now = datetime.now(timezone.utc).isoformat()
    update_data["pickup_details_updated_at"] = now
    update_data["pickup_details_updated_by"] = user["id"]
    update_data["updated_at"] = now

    await db.orders.update_one({"id": order_id}, {"$set": update_data})
    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return await enrich_order_with_locations(updated)

@api_router.put("/delivery/{order_id}/update")
async def update_delivery_status(order_id: str, status: str = Body(..., embed=True), user=Depends(require_delivery)):
    order = await db.orders.find_one({"id": order_id, "delivery_partner_id": user["id"]}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    phase = order.get("delivery_phase") or ("return" if order["status"] in ["delivery_assigned", "out_for_delivery", "delivered"] else "pickup")
    allowed_statuses = {
        "pickup": {
            "pickup_assigned": "delivery_accepted",
            "delivery_accepted": "picked_up",
            "picked_up": "delivered_to_tailor",
        },
        "return": {
            "delivery_assigned": "delivery_accepted",
            "delivery_accepted": "out_for_delivery",
            "out_for_delivery": "delivered",
        },
    }
    expected_next = allowed_statuses.get(phase, {}).get(order["status"])
    if expected_next != status:
        raise HTTPException(status_code=400, detail="Invalid delivery status")

    update_data = {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}
    if status == "delivered_to_tailor":
        update_data.update({
            "delivery_partner_id": "",
            "delivery_partner_name": "",
            "delivery_partner_phone": "",
            "delivery_phase": "",
        })
        await release_delivery_partner(db, user["id"])
    if status == "delivered":
        update_data["delivery_phase"] = ""
        await release_delivery_partner(db, user["id"])
    await db.orders.update_one({"id": order_id}, {"$set": update_data})
    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return await enrich_order_with_locations(updated)

@api_router.get("/delivery/earnings")
async def get_delivery_earnings(user=Depends(require_delivery)):
    orders = await db.orders.find(
        {"delivery_partner_id": user["id"], "status": "delivered"}, {"_id": 0}
    ).to_list(1000)
    delivery_fee = 50
    return {
        "total_earnings": len(orders) * delivery_fee,
        "total_deliveries": len(orders),
        "delivery_fee": delivery_fee,
        "recent_deliveries": await enrich_orders_with_locations(orders[:10])
    }


# ===================== ADMIN ROUTES =====================

@api_router.get("/admin/users")
async def admin_list_users(role: Optional[str] = None, user=Depends(require_admin)):
    query = {}
    if role:
        query["role"] = role
    users = await db.users.find(query, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(1000)
    return users

@api_router.put("/admin/users/{user_id}/toggle-block")
async def admin_toggle_block(user_id: str, user=Depends(require_admin)):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    new_status = "blocked" if target["status"] != "blocked" else "active"
    await db.users.update_one(
        {"id": user_id},
        {
            "$set": {"status": new_status},
            "$inc": {"token_version": 1},
        },
    )
    return {"message": f"User {new_status}", "status": new_status}

@api_router.put("/admin/approve-tailor/{tailor_id}")
async def admin_approve_tailor(tailor_id: str, user=Depends(require_admin)):
    result = await db.users.update_one(
        {"id": tailor_id, "role": "tailor"},
        {"$set": {"status": "active"}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Tailor not found or already active")
    return {"message": "Tailor approved"}

@api_router.get("/admin/orders")
async def admin_list_orders(status: Optional[str] = None, user=Depends(require_admin)):
    query = {}
    if status:
        query["status"] = status
    orders = await db.orders.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return orders

@api_router.get("/admin/analytics")
async def admin_analytics(user=Depends(require_admin)):
    total_users = await db.users.count_documents({})
    total_customers = await db.users.count_documents({"role": "customer"})
    total_tailors = await db.users.count_documents({"role": "tailor"})
    total_delivery = await db.users.count_documents({"role": "delivery"})
    total_orders = await db.orders.count_documents({})
    delivered_orders = await db.orders.count_documents({"status": "delivered"})

    delivered = await db.orders.find({"status": "delivered"}, {"_id": 0}).to_list(10000)
    total_revenue = sum(o["price"] for o in delivered)
    total_commission = sum(o["commission_amount"] for o in delivered)

    pending_tailors = await db.users.count_documents({"role": "tailor", "status": "pending"})
    pending_withdrawals = await db.withdrawals.count_documents({"status": "pending"})

    return {
        "total_users": total_users,
        "total_customers": total_customers,
        "total_tailors": total_tailors,
        "total_delivery": total_delivery,
        "total_orders": total_orders,
        "delivered_orders": delivered_orders,
        "total_revenue": total_revenue,
        "total_commission": total_commission,
        "pending_tailors": pending_tailors,
        "pending_withdrawals": pending_withdrawals
    }

@api_router.get("/admin/settings")
async def get_settings(user=Depends(require_admin)):
    settings = await db.settings.find({}, {"_id": 0}).to_list(100)
    return {s["key"]: s["value"] for s in settings}

@api_router.put("/admin/settings")
async def update_settings(data: SettingsUpdate, user=Depends(require_admin)):
    await db.settings.update_one(
        {"key": "commission_percentage"},
        {"$set": {"value": data.commission_percentage}},
        upsert=True
    )
    return {"message": "Settings updated"}

@api_router.get("/admin/withdrawals")
async def admin_list_withdrawals(user=Depends(require_admin)):
    withdrawals = await db.withdrawals.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return withdrawals

@api_router.put("/admin/withdrawals/{withdrawal_id}/approve")
async def admin_approve_withdrawal(withdrawal_id: str, user=Depends(require_admin)):
    result = await db.withdrawals.update_one(
        {"id": withdrawal_id, "status": "pending"},
        {"$set": {"status": "approved", "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Withdrawal not found or already processed")
    return {"message": "Withdrawal approved"}


# ===================== RAZORPAY PAYMENT =====================

@api_router.post("/payment/create-order")
async def create_payment_order(order_id: str = Body(..., embed=True), user=Depends(require_customer)):
    order = await db.orders.find_one({"id": order_id, "customer_id": user["id"]}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("payment_method") != "online":
        raise HTTPException(status_code=400, detail="Payment order is only available for online payments")
    if order.get("payment_status") == "completed":
        raise HTTPException(status_code=400, detail="Payment already completed")

    amount_paise = int(order["price"] * 100)

    try:
        razorpay_order = razorpay_client.order.create({
            "amount": amount_paise,
            "currency": "INR",
            "payment_capture": 1,
            "notes": {
                "stitchly_order_id": order_id,
                "customer_id": user["id"],
                "service_type": order.get("service_type", ""),
            }
        })
    except Exception as e:
        logger.error(f"Razorpay order creation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Payment gateway error: {str(e)}")

    await db.orders.update_one(
        {"id": order_id},
        {"$set": {
            "razorpay_order_id": razorpay_order["id"],
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )

    return {
        "razorpay_order_id": razorpay_order["id"],
        "razorpay_key_id": RAZORPAY_KEY_ID,
        "amount": amount_paise,
        "currency": "INR",
        "order_id": order_id,
        "customer_name": user["name"],
        "customer_email": user["email"],
        "customer_phone": user["phone"],
    }


@api_router.post("/payment/verify")
async def verify_payment(
    order_id: str = Body(...),
    razorpay_payment_id: str = Body(...),
    razorpay_order_id: str = Body(...),
    razorpay_signature: str = Body(...),
    user=Depends(require_customer),
):
    order = await db.orders.find_one({"id": order_id, "customer_id": user["id"]}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("payment_method") != "online":
        raise HTTPException(status_code=400, detail="Payment verification is only available for online payments")
    stored_razorpay_order_id = order.get("razorpay_order_id")
    if not stored_razorpay_order_id:
        raise HTTPException(status_code=400, detail="Payment order has not been created")
    if stored_razorpay_order_id != razorpay_order_id:
        raise HTTPException(status_code=400, detail="Razorpay order mismatch")
    if (
        order.get("payment_status") == "completed"
        and order.get("razorpay_payment_id") == razorpay_payment_id
        and order.get("razorpay_signature") == razorpay_signature
    ):
        return {
            "verified": True,
            "message": "Payment already verified",
            "order_id": order_id,
            "amount": order["price"],
            "commission": order.get("commission_amount", 0),
            "tailor_earnings": round(order["price"] - order.get("commission_amount", 0), 2),
            "payment_id": razorpay_payment_id,
        }

    # Verify signature
    message = f"{razorpay_order_id}|{razorpay_payment_id}"
    expected_signature = hmac.new(
        RAZORPAY_KEY_SECRET.encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected_signature, razorpay_signature):
        await db.orders.update_one(
            {"id": order_id},
            {"$set": {
                "payment_status": "failed",
                "razorpay_payment_id": razorpay_payment_id,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }}
        )
        raise HTTPException(status_code=400, detail="Payment verification failed - invalid signature")

    # Payment verified - update order
    settings = await db.settings.find_one({"key": "commission_percentage"}, {"_id": 0})
    commission_pct = settings["value"] if settings else 10.0
    commission_amount = round(order["price"] * commission_pct / 100, 2)

    update_result = await db.orders.update_one(
        {
            "id": order_id,
            "customer_id": user["id"],
            "payment_status": {"$ne": "completed"},
            "razorpay_order_id": razorpay_order_id,
        },
        {"$set": {
            "payment_status": "completed",
            "razorpay_payment_id": razorpay_payment_id,
            "razorpay_order_id": razorpay_order_id,
            "razorpay_signature": razorpay_signature,
            "commission_amount": commission_amount,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    if update_result.modified_count == 0:
        latest = await db.orders.find_one({"id": order_id, "customer_id": user["id"]}, {"_id": 0})
        if (
            latest
            and latest.get("payment_status") == "completed"
            and latest.get("razorpay_payment_id") == razorpay_payment_id
            and latest.get("razorpay_signature") == razorpay_signature
        ):
            return {
                "verified": True,
                "message": "Payment already verified",
                "order_id": order_id,
                "amount": latest["price"],
                "commission": latest.get("commission_amount", commission_amount),
                "tailor_earnings": round(latest["price"] - latest.get("commission_amount", commission_amount), 2),
                "payment_id": razorpay_payment_id,
            }
        raise HTTPException(status_code=409, detail="Payment verification conflict")

    logger.info(f"Payment verified for order {order_id}: ₹{order['price']} (commission: ₹{commission_amount})")

    return {
        "verified": True,
        "message": "Payment verified successfully",
        "order_id": order_id,
        "amount": order["price"],
        "commission": commission_amount,
        "tailor_earnings": round(order["price"] - commission_amount, 2),
        "payment_id": razorpay_payment_id,
    }


@api_router.get("/payment/status/{order_id}")
async def get_payment_status(order_id: str, user=Depends(get_current_user)):
    order = await get_order_for_user(order_id, user)
    return {
        "order_id": order_id,
        "payment_status": order.get("payment_status", "pending"),
        "payment_method": order.get("payment_method", "online"),
        "razorpay_order_id": order.get("razorpay_order_id", ""),
        "razorpay_payment_id": order.get("razorpay_payment_id", ""),
        "amount": order.get("price", 0),
        "commission_amount": order.get("commission_amount", 0),
    }


@api_router.get("/payment/checkout/{order_id}")
async def razorpay_checkout_page(order_id: str):
    """Serve Razorpay checkout HTML page for WebView"""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    amount_paise = int(order["price"] * 100)
    razorpay_order_id = order.get("razorpay_order_id", "")

    html = f"""<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Stitchly Payment</title>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #FAFAF9; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }}
  .container {{ max-width: 400px; width: 100%; text-align: center; }}
  .logo {{ font-family: serif; font-size: 32px; font-weight: bold; color: #0F766E; margin-bottom: 8px; }}
  .subtitle {{ color: #78716C; font-size: 14px; margin-bottom: 32px; }}
  .card {{ background: white; border-radius: 16px; padding: 24px; border: 1px solid #E7E5E4; box-shadow: 0 2px 8px rgba(0,0,0,0.04); margin-bottom: 24px; }}
  .amount-label {{ color: #78716C; font-size: 14px; margin-bottom: 4px; }}
  .amount {{ font-size: 36px; font-weight: bold; color: #0F766E; margin-bottom: 4px; }}
  .order-info {{ color: #78716C; font-size: 13px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #E7E5E4; }}
  .pay-btn {{ background: #0F766E; color: white; border: none; border-radius: 999px; padding: 16px 32px; font-size: 16px; font-weight: 600; cursor: pointer; width: 100%; transition: opacity 0.2s; }}
  .pay-btn:hover {{ opacity: 0.9; }}
  .pay-btn:disabled {{ opacity: 0.5; cursor: not-allowed; }}
  .secure {{ color: #78716C; font-size: 12px; margin-top: 16px; }}
  .secure svg {{ vertical-align: middle; margin-right: 4px; }}
  .status {{ padding: 20px; border-radius: 12px; margin-top: 20px; display: none; }}
  .status.success {{ display: block; background: #F0FDF4; color: #15803D; }}
  .status.failed {{ display: block; background: #FEF2F2; color: #B91C1C; }}
  .spinner {{ display: none; margin: 20px auto; width: 32px; height: 32px; border: 3px solid #E7E5E4; border-top-color: #0F766E; border-radius: 50%; animation: spin 0.8s linear infinite; }}
  @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
</style>
</head><body>
<div class="container">
  <div class="logo">Stitchly</div>
  <div class="subtitle">Secure Payment</div>
  <div class="card">
    <div class="amount-label">Amount to Pay</div>
    <div class="amount">&#8377;{order["price"]}</div>
    <div class="order-info">
      {order.get("service_type", "Tailoring Service")}<br>
      Tailor: {order.get("tailor_name", "")}
    </div>
  </div>
  <button class="pay-btn" id="payBtn" onclick="openRazorpay()">Pay &#8377;{order["price"]}</button>
  <div class="spinner" id="spinner"></div>
  <div class="status" id="statusMsg"></div>
  <div class="secure">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
    Secured by Razorpay
  </div>
</div>
<script>
function openRazorpay() {{
  document.getElementById('payBtn').disabled = true;
  document.getElementById('payBtn').textContent = 'Processing...';
  var options = {{
    key: "{RAZORPAY_KEY_ID}",
    amount: {amount_paise},
    currency: "INR",
    name: "Stitchly",
    description: "{order.get('service_type', 'Tailoring Service')}",
    order_id: "{razorpay_order_id}",
    prefill: {{
      name: "{order.get('customer_name', '')}",
      email: "",
      contact: "{order.get('customer_phone', '')}"
    }},
    theme: {{ color: "#0F766E" }},
    handler: function(response) {{
      document.getElementById('payBtn').style.display = 'none';
      document.getElementById('spinner').style.display = 'block';
      // Post message to WebView
      var msg = JSON.stringify({{
        type: 'PAYMENT_SUCCESS',
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_order_id: response.razorpay_order_id,
        razorpay_signature: response.razorpay_signature,
        order_id: "{order_id}"
      }});
      if (window.ReactNativeWebView) {{
        window.ReactNativeWebView.postMessage(msg);
      }} else {{
        window.parent.postMessage(msg, '*');
      }}
      document.getElementById('spinner').style.display = 'none';
      var st = document.getElementById('statusMsg');
      st.className = 'status success';
      st.innerHTML = '<strong>Payment Successful!</strong><br>Payment ID: ' + response.razorpay_payment_id + '<br>Returning to app...';
    }},
    modal: {{
      ondismiss: function() {{
        document.getElementById('payBtn').disabled = false;
        document.getElementById('payBtn').textContent = 'Pay \\u20B9{order["price"]}';
        var msg = JSON.stringify({{ type: 'PAYMENT_CANCELLED', order_id: "{order_id}" }});
        if (window.ReactNativeWebView) {{
          window.ReactNativeWebView.postMessage(msg);
        }} else {{
          window.parent.postMessage(msg, '*');
        }}
      }}
    }}
  }};
  var rzp = new Razorpay(options);
  rzp.on('payment.failed', function(response) {{
    document.getElementById('payBtn').disabled = false;
    document.getElementById('payBtn').textContent = 'Retry Payment';
    var st = document.getElementById('statusMsg');
    st.className = 'status failed';
    st.innerHTML = '<strong>Payment Failed</strong><br>' + response.error.description;
    var msg = JSON.stringify({{ type: 'PAYMENT_FAILED', order_id: "{order_id}", error: response.error.description }});
    if (window.ReactNativeWebView) {{
      window.ReactNativeWebView.postMessage(msg);
    }} else {{
      window.parent.postMessage(msg, '*');
    }}
  }});
  rzp.open();
}}
// Auto-open on load
setTimeout(openRazorpay, 500);
</script>
</body></html>"""
    return HTMLResponse(content=html)


# ===================== SEED DATA =====================

@api_router.post("/seed")
async def seed_data():
    existing = await db.users.find_one({"email": "admin@stitchly.com"})
    if existing:
        return {"message": "Data already seeded", "seeded": False}

    admin = {
        "id": str(uuid.uuid4()), "name": "Admin", "email": "admin@stitchly.com",
        "phone": "9999999999", "password_hash": hash_password("admin123"),
        "role": "admin", "city": "Mumbai", "pincode": "400001",
        "address": "Stitchly HQ, BKC, Mumbai", "location": "Mumbai, 400001",
        "geo_location": build_geo_location(19.0607, 72.8697),
        "rating": 0.0, "rating_count": 0,
        "status": "active", "is_available": False, "specialities": [], "experience": "",
        "working_hours": {}, "profile_photo": "", "body_measurements": {}, "avatar_mesh": None, "avatar_generation_status": "none", "avatar_generation_error": None, "token_version": 1, "created_at": datetime.now(timezone.utc).isoformat()
    }

    tailor_data = [
        {"name": "Ravi Kumar", "email": "ravi@stitchly.com", "phone": "9876543210",
         "city": "Mumbai", "pincode": "400001", "address": "Shop 12, Crawford Market, Mumbai",
         "location": "Mumbai, 400001", "latitude": 18.9476, "longitude": 72.8331, "specialities": ["Blouse", "Lehenga", "Saree Draping"],
         "experience": "15 years", "rating": 4.8, "rating_count": 124},
        {"name": "Priya Sharma", "email": "priya@stitchly.com", "phone": "9876543211",
         "city": "Delhi", "pincode": "110001", "address": "45 Chandni Chowk, Old Delhi",
         "location": "Delhi, 110001", "latitude": 28.6505, "longitude": 77.2303, "specialities": ["Men's Suit", "Kurta", "Sherwani"],
         "experience": "10 years", "rating": 4.5, "rating_count": 89},
        {"name": "Mohammed Iqbal", "email": "iqbal@stitchly.com", "phone": "9876543212",
         "city": "Mumbai", "pincode": "400050", "address": "Bandra West, Linking Road, Mumbai",
         "location": "Mumbai, 400050", "latitude": 19.0596, "longitude": 72.8295, "specialities": ["Alteration", "Blouse", "Dress"],
         "experience": "8 years", "rating": 4.6, "rating_count": 56},
    ]
    tailors = []
    for td in tailor_data:
        tailor = {
            "id": str(uuid.uuid4()), "name": td["name"], "email": td["email"],
            "phone": td["phone"], "password_hash": hash_password("tailor123"),
            "role": "tailor", "city": td["city"], "pincode": td["pincode"],
            "address": td["address"], "location": td["location"],
            "geo_location": build_geo_location(td["latitude"], td["longitude"]),
            "rating": td["rating"],
            "rating_count": td["rating_count"], "status": "active", "is_available": False,
            "specialities": td["specialities"], "experience": td["experience"],
            "working_hours": {"monday": "9:00-18:00", "tuesday": "9:00-18:00",
                "wednesday": "9:00-18:00", "thursday": "9:00-18:00",
                "friday": "9:00-18:00", "saturday": "10:00-14:00"},
            "profile_photo": "", "body_measurements": {}, "avatar_mesh": None, "avatar_generation_status": "none", "avatar_generation_error": None, "token_version": 1, "created_at": datetime.now(timezone.utc).isoformat()
        }
        tailors.append(tailor)

    customer_data = [
        {"name": "Anita Desai", "email": "anita@test.com", "phone": "9800000001",
         "city": "Mumbai", "pincode": "400001", "address": "123 Marine Drive, Mumbai",
         "location": "Mumbai, 400001", "latitude": 18.9440, "longitude": 72.8237},
        {"name": "Rahul Verma", "email": "rahul@test.com", "phone": "9800000002",
         "city": "Delhi", "pincode": "110001", "address": "56 Connaught Place, Delhi",
         "location": "Delhi, 110001", "latitude": 28.6315, "longitude": 77.2167},
    ]
    customers = []
    for cd in customer_data:
        customer = {
            "id": str(uuid.uuid4()), "name": cd["name"], "email": cd["email"],
            "phone": cd["phone"], "password_hash": hash_password("customer123"),
            "role": "customer", "city": cd["city"], "pincode": cd["pincode"],
            "address": cd["address"], "location": cd["location"],
            "geo_location": build_geo_location(cd["latitude"], cd["longitude"]), "rating": 0.0,
            "rating_count": 0, "status": "active", "is_available": False, "specialities": [],
            "experience": "", "working_hours": {}, "profile_photo": "", "body_measurements": {}, "avatar_mesh": None, "avatar_generation_status": "none", "avatar_generation_error": None, "token_version": 1,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        customers.append(customer)

    delivery = {
        "id": str(uuid.uuid4()), "name": "Suresh Driver", "email": "suresh@stitchly.com",
        "phone": "9800000003", "password_hash": hash_password("delivery123"),
        "role": "delivery", "city": "Mumbai", "pincode": "400001",
        "address": "Fort, Mumbai", "location": "Mumbai, 400001",
        "geo_location": build_geo_location(18.9398, 72.8355), "rating": 4.2,
        "rating_count": 45, "status": "active", "is_available": True, "specialities": [],
        "experience": "", "working_hours": {}, "profile_photo": "", "body_measurements": {}, "avatar_mesh": None, "avatar_generation_status": "none", "avatar_generation_error": None, "token_version": 1,
        "created_at": datetime.now(timezone.utc).isoformat()
    }

    delivery2 = {
        "id": str(uuid.uuid4()), "name": "Amit Courier", "email": "amit@stitchly.com",
        "phone": "9800000004", "password_hash": hash_password("delivery123"),
        "role": "delivery", "city": "Delhi", "pincode": "110001",
        "address": "Connaught Place, Delhi", "location": "Delhi, 110001",
        "geo_location": build_geo_location(28.6317, 77.2197),
        "rating": 4.0, "rating_count": 22, "status": "active", "is_available": True, "specialities": [],
        "experience": "", "working_hours": {}, "profile_photo": "", "body_measurements": {}, "avatar_mesh": None, "avatar_generation_status": "none", "avatar_generation_error": None, "token_version": 1,
        "created_at": datetime.now(timezone.utc).isoformat()
    }

    all_users = [admin] + tailors + customers + [delivery, delivery2]
    await db.users.insert_many(all_users)

    service_data = [
        {"tailor_id": tailors[0]["id"], "service_name": "Blouse Stitching", "price": 800, "category": "Blouse"},
        {"tailor_id": tailors[0]["id"], "service_name": "Lehenga", "price": 5000, "category": "Lehenga"},
        {"tailor_id": tailors[0]["id"], "service_name": "Saree Blouse Premium", "price": 1500, "category": "Blouse"},
        {"tailor_id": tailors[1]["id"], "service_name": "Men's Suit", "price": 8000, "category": "Men's Suit"},
        {"tailor_id": tailors[1]["id"], "service_name": "Kurta Pajama", "price": 2500, "category": "Kurta"},
        {"tailor_id": tailors[1]["id"], "service_name": "Sherwani", "price": 15000, "category": "Sherwani"},
        {"tailor_id": tailors[2]["id"], "service_name": "Alteration", "price": 300, "category": "Alteration"},
        {"tailor_id": tailors[2]["id"], "service_name": "Blouse Stitching", "price": 600, "category": "Blouse"},
        {"tailor_id": tailors[2]["id"], "service_name": "Dress Stitching", "price": 2000, "category": "Dress"},
    ]
    services = [{"id": str(uuid.uuid4()), **sd} for sd in service_data]
    await db.tailor_services.insert_many(services)

    sample_orders = [
        {
            "id": str(uuid.uuid4()), "customer_id": customers[0]["id"],
            "customer_name": customers[0]["name"], "customer_phone": customers[0]["phone"],
            "tailor_id": tailors[0]["id"], "tailor_name": tailors[0]["name"],
            "tailor_phone": tailors[0]["phone"],
            "delivery_partner_id": delivery["id"], "delivery_partner_name": delivery["name"],
            "service_type": "Blouse Stitching", "description": "Red silk blouse with gold border",
            "reference_image": "", "pickup_address": "123 Marine Drive, Mumbai",
            "delivery_address": "123 Marine Drive, Mumbai",
            "customer_address": "123 Marine Drive, Mumbai", "tailor_address": tailors[0]["address"],
            "pickup_geo_location": customers[0]["geo_location"],
            "customer_geo_location": customers[0]["geo_location"], "tailor_geo_location": tailors[0]["geo_location"],
            "delivery_partner_phone": delivery["phone"], "delivery_phase": "return",
            "price": 800, "commission_amount": 80, "status": "delivered",
            "payment_status": "completed", "payment_method": "online",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        },
        {
            "id": str(uuid.uuid4()), "customer_id": customers[0]["id"],
            "customer_name": customers[0]["name"], "customer_phone": customers[0]["phone"],
            "tailor_id": tailors[0]["id"], "tailor_name": tailors[0]["name"],
            "tailor_phone": tailors[0]["phone"],
            "delivery_partner_id": "", "delivery_partner_name": "",
            "service_type": "Lehenga", "description": "Blue designer lehenga for wedding",
            "reference_image": "", "pickup_address": "123 Marine Drive, Mumbai",
            "delivery_address": "123 Marine Drive, Mumbai",
            "customer_address": "123 Marine Drive, Mumbai", "tailor_address": tailors[0]["address"],
            "pickup_geo_location": customers[0]["geo_location"],
            "customer_geo_location": customers[0]["geo_location"], "tailor_geo_location": tailors[0]["geo_location"],
            "delivery_partner_phone": "", "delivery_phase": "",
            "price": 5000, "commission_amount": 500, "status": "placed",
            "payment_status": "pending", "payment_method": "online",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        },
    ]
    await db.orders.insert_many(sample_orders)
    await db.settings.insert_one({"key": "commission_percentage", "value": 10.0})

    review = {
        "id": str(uuid.uuid4()), "order_id": sample_orders[0]["id"],
        "customer_id": customers[0]["id"], "customer_name": customers[0]["name"],
        "tailor_id": tailors[0]["id"], "rating": 5,
        "comment": "Excellent work! The blouse fits perfectly.",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.reviews.insert_one(review)

    return {
        "message": "Seed data created successfully", "seeded": True,
        "credentials": {
            "admin": {"email": "admin@stitchly.com", "password": "admin123"},
            "tailor1": {"email": "ravi@stitchly.com", "password": "tailor123"},
            "tailor2": {"email": "priya@stitchly.com", "password": "tailor123"},
            "tailor3": {"email": "iqbal@stitchly.com", "password": "tailor123"},
            "customer1": {"email": "anita@test.com", "password": "customer123"},
            "customer2": {"email": "rahul@test.com", "password": "customer123"},
            "delivery": {"email": "suresh@stitchly.com", "password": "delivery123"}
        }
    }


# ===================== SPECIALITIES ENDPOINT =====================

@api_router.get("/specialities")
async def get_specialities():
    return ["Blouse", "Lehenga", "Saree Draping", "Men's Suit", "Kurta",
            "Sherwani", "Alteration", "Dress", "Salwar Kameez", "Anarkali"]


@api_router.get("/cities")
async def get_cities():
    """Get list of cities where tailors are available"""
    cities = await db.users.distinct("city", {"role": "tailor", "status": "active", "city": {"$ne": ""}})
    return sorted(cities)


# ===================== SETUP =====================

app.include_router(api_router)
app.mount("/avatars", StaticFiles(directory=str(LOCAL_AVATAR_DIR)), name="avatars")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    LOCAL_AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    await db.users.create_index("id", unique=True)
    await db.users.create_index("email", unique=True)
    await db.users.create_index("avatar_mesh")
    await db.users.create_index("avatar_generation_status")
    await db.tailor_services.create_index("id", unique=True)
    await db.tailor_services.create_index("tailor_id")
    await db.orders.create_index("id", unique=True)
    await db.orders.create_index("customer_id")
    await db.orders.create_index("tailor_id")
    await db.orders.create_index("delivery_partner_id")
    await db.orders.create_index([("status", 1), ("delivery_partner_id", 1), ("created_at", 1)])
    await db.orders.create_index([("pickup_geo_location", "2dsphere")])
    await db.orders.create_index([("tailor_geo_location", "2dsphere")])
    await db.reviews.create_index("id", unique=True)
    await db.reviews.create_index("tailor_id")
    await db.withdrawals.create_index("id", unique=True)
    await db.users.create_index("city")
    await db.users.create_index("pincode")
    await db.users.create_index([("geo_location", "2dsphere")])
    await db.users.create_index([("role", 1), ("city", 1), ("status", 1)])
    await db.users.create_index([("role", 1), ("status", 1), ("is_available", 1)])
    try:
        assigned_count = await retry_pending_delivery_assignments()
        logger.info("Startup dispatch retry completed: assigned=%s", assigned_count)
    except Exception:
        logger.exception("Startup dispatch retry failed")
    logger.info("Stitchly API started - indexes created")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()



# ===================== AI MEASUREMENT ENDPOINTS =====================


@app.post("/ai/check-position")
async def check_position(
    image: UploadFile = File(...),
    height_cm: float = Form(...),
    view: str = Form("front"),
    pitch: Optional[float] = Form(None),
    roll: Optional[float] = Form(None),
):
    ensure_ai_dependencies()

    image_path = _save_upload_to_temp(image, f"position_{view}")
    pose_view = _detect_pose_view(image_path)
    overlay = _format_overlay(pose_view)
    feedback = _estimate_position_feedback(view.lower(), pose_view, pitch=pitch, roll=roll)

    return {
        "success": True,
        "instruction": feedback["instruction"],
        "ready_to_capture": feedback["ready_to_capture"],
        "quality_score": feedback["quality_score"],
        "landmarks": overlay["landmarks"],
        "silhouette": overlay["silhouette"],
        "pose_confidence": overlay["pose_confidence"],
        "image_width": int(pose_view.get("image_width") or 0),
        "image_height": int(pose_view.get("image_height") or 0),
        "height_cm": height_cm,
        "view": view.lower(),
        "pitch": pitch,
        "roll": roll,
    }


async def _run_measurement_pipeline(
    background_tasks: BackgroundTasks,
    front_image: UploadFile,
    side_image: UploadFile,
    back_image: UploadFile,
    height_cm: float,
    user: Optional[dict],
    front_image_2: Optional[UploadFile] = None,
    front_image_3: Optional[UploadFile] = None,
    side_image_2: Optional[UploadFile] = None,
    side_image_3: Optional[UploadFile] = None,
    back_image_2: Optional[UploadFile] = None,
    back_image_3: Optional[UploadFile] = None,
):
    front_views = _detect_pose_candidates("front", _non_empty_uploads(front_image, front_image_2, front_image_3))
    side_views = _detect_pose_candidates("side", _non_empty_uploads(side_image, side_image_2, side_image_3))
    back_views = _detect_pose_candidates("back", _non_empty_uploads(back_image, back_image_2, back_image_3))

    if not front_views or not side_views or not back_views:
        fallback_measurements = calculate_measurements(
            front_views[0] if front_views else {},
            side_views[0] if side_views else {},
            back_views[0] if back_views else {},
            height_cm,
        )
        if fallback_measurements.get("measurements"):
            fallback_warnings = list(fallback_measurements.get("warnings") or [])
            fallback_warnings.append("Scan not perfect, using limited view estimation.")
            fallback_measurements["warnings"] = fallback_warnings
            front_views = front_views or [{}]
            side_views = side_views or [{}]
            back_views = back_views or [{}]
            measurement_candidates = [fallback_measurements]
        else:
            return {"error": "Please stand straight and ensure full body is visible"}
    else:
        measurement_candidates: List[dict] = []

    last_error: Optional[dict] = None
    pipeline_warnings: List[str] = []
    sample_count = max(len(front_views), len(side_views), len(back_views))

    for index in range(sample_count):
        front_view = front_views[min(index, len(front_views) - 1)]
        side_view = side_views[min(index, len(side_views) - 1)]
        back_view = back_views[min(index, len(back_views) - 1)]

        if not front_view.get("landmarks"):
            pipeline_warnings.append("Front view landmarks were weak.")
        if not side_view.get("landmarks"):
            pipeline_warnings.append("Side view landmarks were weak.")
        if not back_view.get("landmarks"):
            pipeline_warnings.append("Back view landmarks were weak.")

        measurements = calculate_measurements(front_view, side_view, back_view, height_cm)
        if "error" in measurements:
            last_error = measurements

            if measurements.get("measurements"):
                soft_candidate = dict(measurements)
                soft_warnings = list(soft_candidate.get("warnings") or [])
                if measurements.get("error"):
                    soft_warnings.append(str(measurements.get("error")))
                soft_candidate["warnings"] = soft_warnings
                soft_candidate.pop("error", None)
                measurement_candidates.append(soft_candidate)
            continue

        measurement_candidates.append(measurements)

    if not measurement_candidates:
        strongest_view = max(
            [*front_views, *side_views, *back_views],
            key=lambda view: float(view.get("pose_confidence", 0.0)) + (0.01 * len(view.get("landmarks") or [])),
        )

        if strongest_view.get("landmarks"):
            fallback_measurements = calculate_measurements(strongest_view, strongest_view, strongest_view, height_cm)
            if fallback_measurements.get("measurements"):
                fallback_warnings = list(fallback_measurements.get("warnings") or [])
                fallback_warnings.append("Generated from limited scan data.")
                fallback_measurements["warnings"] = fallback_warnings
                fallback_measurements.pop("error", None)
                measurement_candidates.append(fallback_measurements)

    if not measurement_candidates:
        return last_error or {"error": "Please stand straight and ensure full body is visible"}

    measurements = _aggregate_measurement_candidates(measurement_candidates)

    front_view = front_views[0]
    side_view = side_views[0]
    back_view = back_views[0]

    measurements_for_storage = dict(measurements)
    measurements_for_storage.pop("scan_artifacts", None)

    if user:
        await save_user_measurements(user["id"], measurements_for_storage)
        schedule_avatar_generation(background_tasks, user["id"], measurements_for_storage)

    ui_measurements = measurements.get("measurements") or _build_ui_measurements(measurements)
    confidence = dict(measurements.get("confidence") or {})
    quality_score = float(measurements.get("quality_score", confidence.get("overall", 0.0)))
    if "overall" not in confidence:
        confidence["overall"] = round(quality_score, 3)
    warnings = list(measurements.get("warnings") or [])
    for warning in pipeline_warnings:
        if warning and warning not in warnings:
            warnings.append(warning)

    return {
        "success": True,
        "raw_measurements": measurements,
        "measurements": ui_measurements,
        "confidence": confidence,
        "quality_score": round(quality_score, 3),
        "warnings": warnings,
        "measurement_details": measurements.get("measurement_details", {}),
        "legacy_measurements": {
            **_build_avatar_measurements(measurements),
            "neck_cm": round(float(measurements.get("neck_cm", 0.0)), 2),
            "hip_cm": round(float(measurements.get("hip_circumference_cm", measurements.get("hip_width_cm", 0.0))), 2),
            "torso_depth_cm": round(float(measurements.get("torso_depth_cm", 0.0)), 2),
        },
        "quality": {
            "overall_confidence": round(quality_score, 3),
            "pixel_to_cm": float(measurements.get("pixel_to_cm", 0.0)),
        },
        "sample_count": len(measurement_candidates),
        "overlays": {
            "front": _format_overlay(front_view),
            "side": _format_overlay(side_view),
            "back": _format_overlay(back_view),
        },
    }


@app.post("/ai/measure")
async def measure_body(
    background_tasks: BackgroundTasks,
    front_image: UploadFile = File(...),
    front_image_2: Optional[UploadFile] = File(None),
    front_image_3: Optional[UploadFile] = File(None),
    side_image: UploadFile = File(...),
    side_image_2: Optional[UploadFile] = File(None),
    side_image_3: Optional[UploadFile] = File(None),
    back_image: UploadFile = File(...),
    back_image_2: Optional[UploadFile] = File(None),
    back_image_3: Optional[UploadFile] = File(None),
    height_cm: float = Form(...),
    user=Depends(get_optional_user),
):
    ensure_ai_dependencies()

    result = await _run_measurement_pipeline(
        background_tasks=background_tasks,
        front_image=front_image,
        side_image=side_image,
        back_image=back_image,
        height_cm=height_cm,
        user=user,
        front_image_2=front_image_2,
        front_image_3=front_image_3,
        side_image_2=side_image_2,
        side_image_3=side_image_3,
        back_image_2=back_image_2,
        back_image_3=back_image_3,
    )
    return result


@app.post("/ai/scan-body")
async def scan_body(
    background_tasks: BackgroundTasks,
    front_image: UploadFile = File(...),
    front_image_2: Optional[UploadFile] = File(None),
    front_image_3: Optional[UploadFile] = File(None),
    side_image: UploadFile = File(...),
    side_image_2: Optional[UploadFile] = File(None),
    side_image_3: Optional[UploadFile] = File(None),
    back_image: UploadFile = File(...),
    back_image_2: Optional[UploadFile] = File(None),
    back_image_3: Optional[UploadFile] = File(None),
    height_cm: float = Form(...),
    user=Depends(get_optional_user),
):
    """Backward-compatible endpoint kept for older mobile clients."""
    ensure_ai_dependencies()

    result = await _run_measurement_pipeline(
        background_tasks=background_tasks,
        front_image=front_image,
        side_image=side_image,
        back_image=back_image,
        height_cm=height_cm,
        user=user,
        front_image_2=front_image_2,
        front_image_3=front_image_3,
        side_image_2=side_image_2,
        side_image_3=side_image_3,
        back_image_2=back_image_2,
        back_image_3=back_image_3,
    )

    if "error" in result:
        return result

    front_overlay = result.get("overlays", {}).get("front", {})
    return {
        "success": True,
        "measurements": result.get("raw_measurements", {}),
        "confidence": result.get("confidence", {}),
        "quality_score": result.get("quality_score", 0.0),
        "warnings": result.get("warnings", []),
        "landmarks": front_overlay.get("landmarks", []),
        "silhouette": front_overlay.get("silhouette", []),
        "measurement_details": result.get("measurement_details", {}),
    }
