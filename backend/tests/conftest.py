import copy
import inspect
import math
import os
import re
import sys
import types
from pathlib import Path

import pytest
import httpx
from fastapi.testclient import TestClient
from jose import jwt


if "app" not in inspect.signature(httpx.Client.__init__).parameters:
    _original_httpx_client_init = httpx.Client.__init__

    def _compat_httpx_client_init(self, *args, **kwargs):
        kwargs.pop("app", None)
        return _original_httpx_client_init(self, *args, **kwargs)

    httpx.Client.__init__ = _compat_httpx_client_init


os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "stitchly_test")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("RAZORPAY_KEY_ID", "rzp_test_123")
os.environ.setdefault("RAZORPAY_KEY_SECRET", "rzp_secret_123")
os.environ.setdefault("CORS_ALLOWED_ORIGINS", "http://localhost:3000")

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _install_ai_stubs():
    sys.modules.setdefault("cv2", types.ModuleType("cv2"))
    try:
        import numpy as numpy_module
    except Exception:
        numpy_module = types.ModuleType("numpy")
        numpy_module.ndarray = object
    sys.modules.setdefault("numpy", numpy_module)

    ai_module = sys.modules.setdefault("ai", types.ModuleType("ai"))
    ai_module.__path__ = [str(BACKEND_DIR / "ai")]
    body3d_module = sys.modules.setdefault("ai.body3d", types.ModuleType("ai.body3d"))
    body3d_module.__path__ = [str(BACKEND_DIR / "ai" / "body3d")]
    reconstruction_module = types.ModuleType("ai.body3d.body_reconstruction")
    reconstruction_module.add_frame = lambda *args, **kwargs: None
    reconstruction_module.average_landmarks = lambda *args, **kwargs: []
    pose_module = types.ModuleType("ai.pose_detector")
    pose_module.detect_landmarks = lambda *args, **kwargs: []
    measurement_module = types.ModuleType("ai.measurement_calculator")
    measurement_module.calculate_measurements = lambda *args, **kwargs: {"shoulder_width_cm": 40}

    ai_module.body3d = body3d_module
    body3d_module.body_reconstruction = reconstruction_module

    sys.modules["ai.body3d.body_reconstruction"] = reconstruction_module
    sys.modules["ai.pose_detector"] = pose_module
    sys.modules["ai.measurement_calculator"] = measurement_module


_install_ai_stubs()

import server  # noqa: E402


def _test_hash_password(password: str) -> str:
    return f"test-hash::{password}"


def _test_verify_password(plain_password: str, hashed_password: str) -> bool:
    return hashed_password == _test_hash_password(plain_password)


server.hash_password = _test_hash_password
server.verify_password = _test_verify_password


class FakeResult:
    def __init__(self, modified_count=0, deleted_count=0, inserted_id=None):
        self.modified_count = modified_count
        self.deleted_count = deleted_count
        self.inserted_id = inserted_id


class FakeCursor:
    def __init__(self, documents):
        self._documents = [copy.deepcopy(document) for document in documents]
        self._limit = None

    def sort(self, field, direction):
        reverse = direction == -1
        self._documents.sort(key=lambda document: document.get(field), reverse=reverse)
        return self

    def limit(self, value):
        self._limit = value
        return self

    async def to_list(self, length):
        documents = self._documents
        if self._limit is not None:
            documents = documents[: self._limit]
        if length is not None:
            documents = documents[:length]
        return [copy.deepcopy(document) for document in documents]

    def __aiter__(self):
        self._iter_documents = list(self._documents)
        if self._limit is not None:
            self._iter_documents = self._iter_documents[: self._limit]
        self._iter_index = 0
        return self

    async def __anext__(self):
        if self._iter_index >= len(self._iter_documents):
            raise StopAsyncIteration
        document = copy.deepcopy(self._iter_documents[self._iter_index])
        self._iter_index += 1
        return document


def _haversine_meters(first, second):
    lon1, lat1 = map(math.radians, first)
    lon2, lat2 = map(math.radians, second)
    delta_lon = lon2 - lon1
    delta_lat = lat2 - lat1
    hav = math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(hav))


def _project_document(document, projection):
    if not projection:
        return copy.deepcopy(document)

    include_fields = {field for field, value in projection.items() if value}
    if include_fields:
        projected = {field: copy.deepcopy(document[field]) for field in include_fields if field in document}
        if projection.get("_id", 1) and "_id" in document:
            projected["_id"] = copy.deepcopy(document["_id"])
        return projected

    projected = copy.deepcopy(document)
    for field, value in projection.items():
        if value == 0:
            projected.pop(field, None)
    return projected


def _matches_condition(field_value, condition):
    if not isinstance(condition, dict):
        return field_value == condition

    regex_options = condition.get("$options", "")
    for operator, value in condition.items():
        if operator == "$in" and field_value not in value:
            return False
        if operator == "$nin" and field_value in value:
            return False
        if operator == "$ne" and field_value == value:
            return False
        if operator == "$gte" and not (field_value >= value):
            return False
        if operator == "$exists":
            exists = field_value is not None
            if bool(value) != exists:
                return False
        if operator == "$regex":
            if field_value is None:
                return False
            flags = re.IGNORECASE if "i" in regex_options else 0
            if re.search(value, str(field_value), flags) is None:
                return False
        if operator == "$near":
            if not field_value:
                return False
            coordinates = field_value.get("coordinates", [])
            target = value["$geometry"]["coordinates"]
            max_distance = value.get("$maxDistance", 0)
            if len(coordinates) != 2 or _haversine_meters(coordinates, target) > max_distance:
                return False
    return True


def _matches_query(document, query):
    for key, value in query.items():
        if key == "$or":
            if not any(_matches_query(document, item) for item in value):
                return False
            continue
        if key == "$and":
            if not all(_matches_query(document, item) for item in value):
                return False
            continue
        if not _matches_condition(document.get(key), value):
            return False
    return True


class FakeCollection:
    def __init__(self, documents=None):
        self.documents = [copy.deepcopy(document) for document in (documents or [])]
        self.indexes = []

    async def find_one(self, query, projection=None):
        for document in self.documents:
            if _matches_query(document, query):
                return _project_document(document, projection)
        return None

    def find(self, query, projection=None):
        matched = [_project_document(document, projection) for document in self.documents if _matches_query(document, query)]
        return FakeCursor(matched)

    async def insert_one(self, document):
        self.documents.append(copy.deepcopy(document))
        return FakeResult(inserted_id=document.get("id"))

    async def insert_many(self, documents):
        for document in documents:
            self.documents.append(copy.deepcopy(document))
        return FakeResult(inserted_id=None)

    async def update_one(self, query, update, upsert=False):
        modified_count = 0
        for document in self.documents:
            if _matches_query(document, query):
                if "$set" in update:
                    for key, value in update["$set"].items():
                        document[key] = copy.deepcopy(value)
                if "$inc" in update:
                    for key, value in update["$inc"].items():
                        document[key] = int(document.get(key, 0)) + value
                modified_count = 1
                break
        if modified_count == 0 and upsert:
            new_document = copy.deepcopy(query)
            if "$set" in update:
                new_document.update(copy.deepcopy(update["$set"]))
            self.documents.append(new_document)
            modified_count = 1
        return FakeResult(modified_count=modified_count)

    async def delete_one(self, query):
        for index, document in enumerate(self.documents):
            if _matches_query(document, query):
                del self.documents[index]
                return FakeResult(deleted_count=1)
        return FakeResult(deleted_count=0)

    async def count_documents(self, query):
        return sum(1 for document in self.documents if _matches_query(document, query))

    async def distinct(self, field, query):
        values = []
        for document in self.documents:
            if _matches_query(document, query) and document.get(field) not in values:
                values.append(document.get(field))
        return values

    async def create_index(self, keys, unique=False):
        self.indexes.append({"keys": keys, "unique": unique})
        return str(keys)

    async def find_one_and_update(self, query, update, projection=None, return_document=None):
        for document in self.documents:
            if _matches_query(document, query):
                before = copy.deepcopy(document)
                if "$set" in update:
                    for key, value in update["$set"].items():
                        document[key] = copy.deepcopy(value)
                if "$inc" in update:
                    for key, value in update["$inc"].items():
                        document[key] = int(document.get(key, 0)) + value
                use_after = getattr(return_document, "name", None) == "AFTER" or return_document in (True, 1)
                updated = copy.deepcopy(document) if use_after else before
                return _project_document(updated, projection)
        return None


class FakeDatabase:
    def __init__(self, seed_documents):
        self.users = FakeCollection(seed_documents["users"])
        self.orders = FakeCollection(seed_documents["orders"])
        self.settings = FakeCollection(seed_documents["settings"])
        self.tailor_services = FakeCollection(seed_documents["tailor_services"])
        self.reviews = FakeCollection(seed_documents["reviews"])
        self.withdrawals = FakeCollection(seed_documents["withdrawals"])


class FakeMotorClient:
    def close(self):
        return None


class FakeRazorpayOrderAPI:
    def __init__(self):
        self.counter = 0

    def create(self, payload):
        self.counter += 1
        return {
            "id": f"order_test_{self.counter}",
            "amount": payload["amount"],
            "currency": payload["currency"],
        }


class FakeRazorpayClient:
    def __init__(self):
        self.order = FakeRazorpayOrderAPI()


def _geo(latitude, longitude):
    return {"type": "Point", "coordinates": [float(longitude), float(latitude)]}


def _seed_documents():
    customer = {
        "id": "customer-1",
        "name": "Anita",
        "email": "customer@test.com",
        "phone": "9000000001",
        "password_hash": server.hash_password("password123"),
        "role": "customer",
        "status": "active",
        "token_version": 1,
        "city": "Mumbai",
        "pincode": "400001",
        "address": "123 Marine Drive",
        "location": "Mumbai, 400001",
        "geo_location": _geo(18.9440, 72.8237),
        "is_available": False,
        "rating": 0.0,
        "rating_count": 0,
        "specialities": [],
        "experience": "",
        "working_hours": {},
        "profile_photo": "",
        "body_measurements": {},
        "avatar_mesh": None,
        "avatar_generation_status": "none",
        "avatar_generation_error": None,
        "created_at": "2026-03-14T10:00:00+00:00",
    }
    customer_two = {
        "id": "customer-2",
        "name": "Rahul",
        "email": "other@test.com",
        "phone": "9000000002",
        "password_hash": server.hash_password("password123"),
        "role": "customer",
        "status": "active",
        "token_version": 1,
        "city": "Mumbai",
        "pincode": "400002",
        "address": "45 Colaba Causeway",
        "location": "Mumbai, 400002",
        "geo_location": _geo(18.9217, 72.8347),
        "is_available": False,
        "rating": 0.0,
        "rating_count": 0,
        "specialities": [],
        "experience": "",
        "working_hours": {},
        "profile_photo": "",
        "body_measurements": {},
        "avatar_mesh": None,
        "avatar_generation_status": "none",
        "avatar_generation_error": None,
        "created_at": "2026-03-14T10:01:00+00:00",
    }
    tailor = {
        "id": "tailor-1",
        "name": "Ravi",
        "email": "tailor@test.com",
        "phone": "9000000003",
        "password_hash": server.hash_password("password123"),
        "role": "tailor",
        "status": "active",
        "token_version": 1,
        "city": "Mumbai",
        "pincode": "400001",
        "address": "Shop 12, Crawford Market",
        "location": "Mumbai, 400001",
        "geo_location": _geo(18.9476, 72.8331),
        "is_available": False,
        "rating": 4.8,
        "rating_count": 50,
        "specialities": ["Blouse"],
        "experience": "10 years",
        "working_hours": {},
        "profile_photo": "",
        "body_measurements": {},
        "avatar_mesh": None,
        "avatar_generation_status": "none",
        "avatar_generation_error": None,
        "created_at": "2026-03-14T10:02:00+00:00",
    }
    delivery = {
        "id": "delivery-1",
        "name": "Suresh",
        "email": "delivery@test.com",
        "phone": "9000000004",
        "password_hash": server.hash_password("password123"),
        "role": "delivery",
        "status": "active",
        "token_version": 1,
        "city": "Mumbai",
        "pincode": "400001",
        "address": "Fort, Mumbai",
        "location": "Mumbai, 400001",
        "geo_location": _geo(18.9398, 72.8355),
        "is_available": True,
        "rating": 4.5,
        "rating_count": 20,
        "specialities": [],
        "experience": "",
        "working_hours": {},
        "profile_photo": "",
        "body_measurements": {},
        "avatar_mesh": None,
        "avatar_generation_status": "none",
        "avatar_generation_error": None,
        "created_at": "2026-03-14T10:03:00+00:00",
    }
    delivery_two = {
        "id": "delivery-2",
        "name": "Amit",
        "email": "delivery2@test.com",
        "phone": "9000000005",
        "password_hash": server.hash_password("password123"),
        "role": "delivery",
        "status": "active",
        "token_version": 1,
        "city": "Mumbai",
        "pincode": "400005",
        "address": "Andheri East",
        "location": "Mumbai, 400005",
        "geo_location": _geo(19.1136, 72.8697),
        "is_available": True,
        "rating": 4.1,
        "rating_count": 10,
        "specialities": [],
        "experience": "",
        "working_hours": {},
        "profile_photo": "",
        "body_measurements": {},
        "avatar_mesh": None,
        "avatar_generation_status": "none",
        "avatar_generation_error": None,
        "created_at": "2026-03-14T10:04:00+00:00",
    }
    admin = {
        "id": "admin-1",
        "name": "Admin",
        "email": "admin@test.com",
        "phone": "9000000006",
        "password_hash": server.hash_password("password123"),
        "role": "admin",
        "status": "active",
        "token_version": 1,
        "city": "Mumbai",
        "pincode": "400001",
        "address": "HQ",
        "location": "Mumbai, 400001",
        "geo_location": _geo(18.95, 72.82),
        "is_available": False,
        "rating": 0.0,
        "rating_count": 0,
        "specialities": [],
        "experience": "",
        "working_hours": {},
        "profile_photo": "",
        "body_measurements": {},
        "avatar_mesh": None,
        "avatar_generation_status": "none",
        "avatar_generation_error": None,
        "created_at": "2026-03-14T10:05:00+00:00",
    }

    return {
        "users": [customer, customer_two, tailor, delivery, delivery_two, admin],
        "orders": [],
        "settings": [{"key": "commission_percentage", "value": 10.0}],
        "tailor_services": [
            {
                "id": "service-1",
                "tailor_id": "tailor-1",
                "service_name": "Blouse Stitching",
                "price": 800,
                "category": "Blouse",
            }
        ],
        "reviews": [],
        "withdrawals": [],
    }


@pytest.fixture()
def fake_db():
    return FakeDatabase(_seed_documents())


@pytest.fixture()
def client(fake_db, monkeypatch):
    monkeypatch.setattr(server, "db", fake_db, raising=False)
    monkeypatch.setattr(server, "client", FakeMotorClient(), raising=False)
    monkeypatch.setattr(server, "razorpay_client", FakeRazorpayClient(), raising=False)
    if hasattr(server, "frame_buffer"):
        server.frame_buffer.clear()
    with TestClient(server.app) as test_client:
        yield test_client


@pytest.fixture()
def auth_headers(fake_db, monkeypatch):
    monkeypatch.setattr(server, "db", fake_db, raising=False)

    def _build(user_id):
        user = next(document for document in fake_db.users.documents if document["id"] == user_id)
        token = server.issue_token_for_user(user)
        return {"Authorization": f"Bearer {token}"}

    return _build


@pytest.fixture()
def jwt_secret():
    return os.environ["JWT_SECRET"]


@pytest.fixture()
def decode_token(jwt_secret):
    def _decode(token):
        return jwt.decode(token, jwt_secret, algorithms=[server.JWT_ALGORITHM])

    return _decode
