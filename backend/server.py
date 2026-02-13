"""Stitchly Backend API - 3-Sided Tailoring Marketplace"""

from fastapi import FastAPI, APIRouter, Depends, HTTPException, Body, Query, Request
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

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"

RAZORPAY_KEY_ID = os.environ['RAZORPAY_KEY_ID']
RAZORPAY_KEY_SECRET = os.environ['RAZORPAY_KEY_SECRET']
razorpay_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=False)

app = FastAPI(title="Stitchly API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


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


# ===================== AUTH HELPERS =====================

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)

def create_token(data: dict) -> str:
    return jwt.encode(data, JWT_SECRET, algorithm=JWT_ALGORITHM)

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
        return user
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

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
        "rating": 0.0,
        "rating_count": 0,
        "status": "pending" if data.role == "tailor" else "active",
        "specialities": [],
        "experience": "",
        "working_hours": {},
        "profile_photo": "",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user)
    user.pop("_id", None)

    safe_user = {k: v for k, v in user.items() if k != "password_hash"}
    token = create_token({"user_id": user["id"], "role": user["role"]})
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

    token = create_token({"user_id": user["id"], "role": user["role"]})
    safe_user = {k: v for k, v in user.items() if k != "password_hash"}
    return {"token": token, "user": safe_user}

@api_router.get("/auth/me")
async def get_me(user=Depends(get_current_user)):
    return {k: v for k, v in user.items() if k != "password_hash"}

@api_router.put("/auth/profile")
async def update_profile(data: UserProfileUpdate, user=Depends(get_current_user)):
    update = {k: v for k, v in data.dict(exclude_unset=True).items() if v is not None}
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

    order = {
        "id": str(uuid.uuid4()),
        "customer_id": user["id"],
        "customer_name": user["name"],
        "customer_phone": user["phone"],
        "customer_city": user.get("city", ""),
        "tailor_id": data.tailor_id,
        "tailor_name": tailor["name"],
        "tailor_phone": tailor["phone"],
        "tailor_city": tailor.get("city", ""),
        "delivery_partner_id": "",
        "delivery_partner_name": "",
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
    return order

@api_router.get("/orders/my")
async def get_my_orders(user=Depends(require_customer)):
    orders = await db.orders.find({"customer_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return orders

@api_router.get("/orders/tailor")
async def get_tailor_orders(user=Depends(require_tailor)):
    orders = await db.orders.find({"tailor_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return orders

@api_router.get("/orders/delivery")
async def get_delivery_orders(user=Depends(require_delivery)):
    orders = await db.orders.find({"delivery_partner_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return orders

@api_router.get("/orders/{order_id}")
async def get_order(order_id: str, user=Depends(get_current_user)):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order

@api_router.put("/orders/{order_id}/accept")
async def accept_order(order_id: str, user=Depends(require_tailor)):
    order = await db.orders.find_one({"id": order_id, "tailor_id": user["id"]}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["status"] != "placed":
        raise HTTPException(status_code=400, detail="Order cannot be accepted in current status")

    delivery_partner = await db.users.find_one(
        {"role": "delivery", "status": "active", "city": {"$regex": f"^{user.get('city', '')}$", "$options": "i"}},
        {"_id": 0}
    )
    if not delivery_partner:
        delivery_partner = await db.users.find_one({"role": "delivery", "status": "active"}, {"_id": 0})
    dp_id = delivery_partner["id"] if delivery_partner else ""
    dp_name = delivery_partner["name"] if delivery_partner else ""

    await db.orders.update_one(
        {"id": order_id},
        {"$set": {
            "status": "accepted",
            "delivery_partner_id": dp_id,
            "delivery_partner_name": dp_name,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )
    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return updated

@api_router.put("/orders/{order_id}/reject")
async def reject_order(order_id: str, user=Depends(require_tailor)):
    order = await db.orders.find_one({"id": order_id, "tailor_id": user["id"]}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"status": "rejected", "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return updated

@api_router.put("/orders/{order_id}/status")
async def update_order_status(order_id: str, status: str = Body(..., embed=True), user=Depends(get_current_user)):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    valid_statuses = [
        "placed", "accepted", "pickup_assigned", "picked_up",
        "delivered_to_tailor", "in_stitching", "completed", "ready",
        "collected_from_tailor", "out_for_delivery", "delivered", "rejected"
    ]
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status")

    update_data = {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}
    if status == "delivered":
        update_data["payment_status"] = "completed"
    await db.orders.update_one({"id": order_id}, {"$set": update_data})
    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return updated


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


# ===================== DELIVERY ROUTES =====================

@api_router.get("/delivery/assignments")
async def get_delivery_assignments(user=Depends(require_delivery)):
    orders = await db.orders.find(
        {"delivery_partner_id": user["id"], "status": {"$nin": ["delivered", "rejected", "placed"]}},
        {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return orders

@api_router.put("/delivery/{order_id}/update")
async def update_delivery_status(order_id: str, status: str = Body(..., embed=True), user=Depends(require_delivery)):
    valid = ["picked_up", "delivered_to_tailor", "collected_from_tailor", "out_for_delivery", "delivered"]
    if status not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid delivery status")
    order = await db.orders.find_one({"id": order_id, "delivery_partner_id": user["id"]}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    update_data = {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}
    if status == "delivered":
        update_data["payment_status"] = "completed"
    await db.orders.update_one({"id": order_id}, {"$set": update_data})
    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return updated

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
        "recent_deliveries": orders[:10]
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
    await db.users.update_one({"id": user_id}, {"$set": {"status": new_status}})
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

    # Verify signature
    message = f"{razorpay_order_id}|{razorpay_payment_id}"
    expected_signature = hmac.new(
        RAZORPAY_KEY_SECRET.encode('utf-8'),
        message.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

    if expected_signature != razorpay_signature:
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

    await db.orders.update_one(
        {"id": order_id},
        {"$set": {
            "payment_status": "completed",
            "razorpay_payment_id": razorpay_payment_id,
            "razorpay_order_id": razorpay_order_id,
            "razorpay_signature": razorpay_signature,
            "commission_amount": commission_amount,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }}
    )

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
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
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
        "rating": 0.0, "rating_count": 0,
        "status": "active", "specialities": [], "experience": "",
        "working_hours": {}, "profile_photo": "", "created_at": datetime.now(timezone.utc).isoformat()
    }

    tailor_data = [
        {"name": "Ravi Kumar", "email": "ravi@stitchly.com", "phone": "9876543210",
         "city": "Mumbai", "pincode": "400001", "address": "Shop 12, Crawford Market, Mumbai",
         "location": "Mumbai, 400001", "specialities": ["Blouse", "Lehenga", "Saree Draping"],
         "experience": "15 years", "rating": 4.8, "rating_count": 124},
        {"name": "Priya Sharma", "email": "priya@stitchly.com", "phone": "9876543211",
         "city": "Delhi", "pincode": "110001", "address": "45 Chandni Chowk, Old Delhi",
         "location": "Delhi, 110001", "specialities": ["Men's Suit", "Kurta", "Sherwani"],
         "experience": "10 years", "rating": 4.5, "rating_count": 89},
        {"name": "Mohammed Iqbal", "email": "iqbal@stitchly.com", "phone": "9876543212",
         "city": "Mumbai", "pincode": "400050", "address": "Bandra West, Linking Road, Mumbai",
         "location": "Mumbai, 400050", "specialities": ["Alteration", "Blouse", "Dress"],
         "experience": "8 years", "rating": 4.6, "rating_count": 56},
    ]
    tailors = []
    for td in tailor_data:
        tailor = {
            "id": str(uuid.uuid4()), "name": td["name"], "email": td["email"],
            "phone": td["phone"], "password_hash": hash_password("tailor123"),
            "role": "tailor", "city": td["city"], "pincode": td["pincode"],
            "address": td["address"], "location": td["location"],
            "rating": td["rating"],
            "rating_count": td["rating_count"], "status": "active",
            "specialities": td["specialities"], "experience": td["experience"],
            "working_hours": {"monday": "9:00-18:00", "tuesday": "9:00-18:00",
                "wednesday": "9:00-18:00", "thursday": "9:00-18:00",
                "friday": "9:00-18:00", "saturday": "10:00-14:00"},
            "profile_photo": "", "created_at": datetime.now(timezone.utc).isoformat()
        }
        tailors.append(tailor)

    customer_data = [
        {"name": "Anita Desai", "email": "anita@test.com", "phone": "9800000001",
         "city": "Mumbai", "pincode": "400001", "address": "123 Marine Drive, Mumbai",
         "location": "Mumbai, 400001"},
        {"name": "Rahul Verma", "email": "rahul@test.com", "phone": "9800000002",
         "city": "Delhi", "pincode": "110001", "address": "56 Connaught Place, Delhi",
         "location": "Delhi, 110001"},
    ]
    customers = []
    for cd in customer_data:
        customer = {
            "id": str(uuid.uuid4()), "name": cd["name"], "email": cd["email"],
            "phone": cd["phone"], "password_hash": hash_password("customer123"),
            "role": "customer", "city": cd["city"], "pincode": cd["pincode"],
            "address": cd["address"], "location": cd["location"], "rating": 0.0,
            "rating_count": 0, "status": "active", "specialities": [],
            "experience": "", "working_hours": {}, "profile_photo": "",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        customers.append(customer)

    delivery = {
        "id": str(uuid.uuid4()), "name": "Suresh Driver", "email": "suresh@stitchly.com",
        "phone": "9800000003", "password_hash": hash_password("delivery123"),
        "role": "delivery", "city": "Mumbai", "pincode": "400001",
        "address": "Andheri East, Mumbai", "location": "Mumbai, 400001",
        "rating": 4.2,
        "rating_count": 45, "status": "active", "specialities": [],
        "experience": "", "working_hours": {}, "profile_photo": "",
        "created_at": datetime.now(timezone.utc).isoformat()
    }

    delivery2 = {
        "id": str(uuid.uuid4()), "name": "Amit Courier", "email": "amit@stitchly.com",
        "phone": "9800000004", "password_hash": hash_password("delivery123"),
        "role": "delivery", "city": "Delhi", "pincode": "110001",
        "address": "Karol Bagh, Delhi", "location": "Delhi, 110001",
        "rating": 4.0, "rating_count": 22, "status": "active", "specialities": [],
        "experience": "", "working_hours": {}, "profile_photo": "",
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

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    await db.users.create_index("id", unique=True)
    await db.users.create_index("email", unique=True)
    await db.tailor_services.create_index("id", unique=True)
    await db.tailor_services.create_index("tailor_id")
    await db.orders.create_index("id", unique=True)
    await db.orders.create_index("customer_id")
    await db.orders.create_index("tailor_id")
    await db.orders.create_index("delivery_partner_id")
    await db.reviews.create_index("id", unique=True)
    await db.reviews.create_index("tailor_id")
    await db.withdrawals.create_index("id", unique=True)
    await db.users.create_index("city")
    await db.users.create_index("pincode")
    await db.users.create_index([("role", 1), ("city", 1), ("status", 1)])
    logger.info("Stitchly API started - indexes created")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
