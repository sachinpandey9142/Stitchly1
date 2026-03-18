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
from typing import List, Optional
from datetime import datetime, timezone
from jose import jwt, JWTError
from passlib.context import CryptContext
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
    from ai.body3d.body_reconstruction import add_frame, average_landmarks
    from ai.pose_detector import detect_landmarks
    from ai.measurement_calculator import calculate_measurements
except Exception as exc:
    cv2 = None
    AI_IMPORT_ERROR = exc

frame_buffer = []
MAX_FRAMES = 10

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
    return get_geo_location(customer)


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
                "$maxDistance": DELIVERY_SEARCH_RADIUS_METERS,
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

    candidates = await find_candidate_delivery_partners(reference_geo_location, exclude_ids=exclude_ids)
    if not candidates:
        reason = await get_assignment_failure_reason(reference_geo_location)
        logger.info(
            "Assignment failed for order %s phase=%s: %s",
            order.get("id"),
            phase,
            reason,
        )
        return None

    for delivery_partner in candidates:
        assigned = await assign_specific_delivery_partner_to_order(order, delivery_partner, phase, status)
        if assigned:
            return assigned

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
                    "$maxDistance": DELIVERY_SEARCH_RADIUS_METERS,
                }
            },
        },
        {"_id": 0},
    ).limit(limit).to_list(limit)

    ready_orders = await db.orders.find(
        {
            "status": "ready",
            "delivery_partner_id": "",
            "tailor_geo_location": {
                "$near": {
                    "$geometry": geo_location,
                    "$maxDistance": DELIVERY_SEARCH_RADIUS_METERS,
                }
            },
        },
        {"_id": 0},
    ).limit(limit).to_list(limit)

    return sorted(pickup_orders + ready_orders, key=lambda order: order.get("created_at", ""))


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
    price: float
    category: str

class OrderCreate(BaseModel):
    tailor_id: str
    service_type: str
    description: str
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


# ===================== AUTH HELPERS =====================

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)

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
        "body_measurements": {},
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
    if not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if user["status"] == "blocked":
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
        prices = [s["price"] for s in services] if services else [0]
        tailor["min_price"] = min(prices)
        tailor["max_price"] = max(prices)

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

    service = await db.tailor_services.find_one(
        {"tailor_id": data.tailor_id, "service_name": data.service_type}, {"_id": 0}
    )
    price = service["price"] if service else 500

    settings = await db.settings.find_one({"key": "commission_percentage"}, {"_id": 0})
    commission_pct = settings["value"] if settings else 10.0
    commission_amount = round(price * commission_pct / 100, 2)

    customer_geo_location = get_geo_location(user)
    tailor_geo_location = get_geo_location(tailor)
    pickup_geo_location = customer_geo_location

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
        "service_type": data.service_type,
        "description": data.description,
        "reference_image": data.reference_image or "",
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
    service = {
        "id": str(uuid.uuid4()),
        "tailor_id": user["id"],
        "service_name": data.service_name,
        "price": data.price,
        "category": data.category
    }
    await db.tailor_services.insert_one(service)
    service.pop("_id", None)
    return service

@api_router.put("/tailor/services/{service_id}")
async def update_service(service_id: str, data: ServiceCreate, user=Depends(require_tailor)):
    result = await db.tailor_services.update_one(
        {"id": service_id, "tailor_id": user["id"]},
        {"$set": {"service_name": data.service_name, "price": data.price, "category": data.category}}
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
    logger.info("Stitchly API started - indexes created")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()



# ===================== AI MEASUREMENT ENDPOINT =====================
@app.post("/ai/check-position")
async def check_position(
    image: UploadFile = File(...),
    height_cm: float = Form(...)
):
    ensure_ai_dependencies()

    os.makedirs("temp", exist_ok=True)

    file_path = f"temp/{image.filename}"

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(image.file, buffer)

 # ---------------------------------------
# LANDMARK DETECTION
# ---------------------------------------

    landmarks = detect_landmarks(file_path)

    if not landmarks:
        return {"error": "No body detected"}


    # ---------------------------------------
    # ADD FRAME TO BUFFER
    # ---------------------------------------

    frame_buffer.append(landmarks)

    # keep only last MAX_FRAMES frames
    if len(frame_buffer) > MAX_FRAMES:
        frame_buffer.pop(0)


    # ---------------------------------------
    # WAIT UNTIL ENOUGH FRAMES
    # ---------------------------------------

    if len(frame_buffer) < 5:
        return {
            "instruction": "Hold Still...",
            "measurements": None,
            "landmarks": []
        }


    # ---------------------------------------
    # LANDMARK AVERAGING
    # ---------------------------------------

    avg_landmarks = []

    num_landmarks = len(frame_buffer[0])

    for i in range(num_landmarks):

        x_vals = []
        y_vals = []
        z_vals = []

        for frame in frame_buffer:
            x_vals.append(frame[i][0])
            y_vals.append(frame[i][1])
            z_vals.append(frame[i][2])

        avg_landmarks.append((
            sum(x_vals) / len(x_vals),
            sum(y_vals) / len(y_vals),
            sum(z_vals) / len(z_vals)
        ))


    # ---------------------------------------
    # CALCULATE MEASUREMENTS USING SMOOTHED DATA
    # ---------------------------------------

    measurements = calculate_measurements(
        avg_landmarks,
        avg_landmarks,
        avg_landmarks,
        height_cm
    )

    # -----------------------------
    # BODY POSITION ANALYSIS
    # -----------------------------

    instruction = "Perfect Position"

    left_shoulder = landmarks[11]
    right_shoulder = landmarks[12]

    left_hip = landmarks[23]
    right_hip = landmarks[24]

    # BODY CENTER (horizontal alignment)
    body_center = (left_shoulder[0] + right_shoulder[0]) / 2

    if body_center < 0.4:
        instruction = "Move Right"

    elif body_center > 0.6:
        instruction = "Move Left"

    else:

        # DISTANCE CHECK
        shoulder_width = measurements["shoulder_width_cm"]

        if shoulder_width < 35:
            instruction = "Move Closer"

        elif shoulder_width > 60:
            instruction = "Move Back"

        else:

            # BODY TILT CHECK
            shoulder_diff = abs(left_shoulder[1] - right_shoulder[1])

            if shoulder_diff > 0.05:
                instruction = "Stand Straight"

            else:
                instruction = "Perfect Position"

    # -----------------------------
    # FORMAT LANDMARKS
    # -----------------------------

    formatted_landmarks = []

    for x, y, z in avg_landmarks:
        formatted_landmarks.append({
            "x": x,
            "y": y,
            "z": z
        })

    print("Measurements:", measurements)
    print("Instruction:", instruction)

    return {
        "success": True,
        "measurements": measurements,
        "landmarks": formatted_landmarks,
        "instruction": instruction
    }

# ===================== AI MEASUREMENT ENDPOINT =====================


@app.post("/ai/scan-body")
async def scan_body(
    background_tasks: BackgroundTasks,
    front_image: UploadFile = File(...),
    side_image: UploadFile = File(...),
    back_image: UploadFile = File(...),
    height_cm: float = Form(...),
    user=Depends(get_optional_user),
):
    ensure_ai_dependencies()

    os.makedirs("temp", exist_ok=True)

    # -------- Save images --------

    front_path = f"temp/front_{front_image.filename}"
    side_path = f"temp/side_{side_image.filename}"
    back_path = f"temp/back_{back_image.filename}"

    with open(front_path, "wb") as buffer:
        shutil.copyfileobj(front_image.file, buffer)

    with open(side_path, "wb") as buffer:
        shutil.copyfileobj(side_image.file, buffer)

    with open(back_path, "wb") as buffer:
        shutil.copyfileobj(back_image.file, buffer)

    # -------- Detect landmarks --------

    front_landmarks = detect_landmarks(front_path)
    side_landmarks = detect_landmarks(side_path)
    back_landmarks = detect_landmarks(back_path)

    if not front_landmarks or not side_landmarks or not back_landmarks:
        return {"error": "Body detection failed"}

    # -------- Calculate measurements --------

    measurements = calculate_measurements(
        front_landmarks,
        side_landmarks,
        back_landmarks,
        height_cm
    )

    if user and "error" not in measurements:
        await save_user_measurements(user["id"], measurements)
        schedule_avatar_generation(background_tasks, user["id"], measurements)

    # -------- Format landmarks for frontend --------

    formatted_landmarks = []

    for landmark in front_landmarks:
        x, y = landmark.get("x", 0.0), landmark.get("y", 0.0)
        z = landmark.get("z", 0.0)
        formatted_landmarks.append({
            "x": x,
            "y": y,
            "z": z
        })

    return {
        "success": True,
        "measurements": measurements,
        "landmarks": formatted_landmarks
    }
