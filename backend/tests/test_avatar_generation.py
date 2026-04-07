from pathlib import Path

import pytest

import server
from ai import avatar_generator, smpl_model
from storage import avatar_storage
from worker import avatar_worker


VALID_MEASUREMENTS = {
    "shoulder_width_cm": 42.0,
    "chest_cm": 96.0,
    "waist_cm": 82.0,
    "hip_width_cm": 38.0,
    "arm_length_cm": 60.0,
    "leg_length_cm": 92.0,
}


class _FakeNumpy:
    float32 = "float32"
    int64 = "int64"

    @staticmethod
    def zeros(size, dtype=None):
        return [0.0] * size

    @staticmethod
    def clip(values, minimum, maximum):
        return [max(minimum, min(value, maximum)) for value in values]

    @staticmethod
    def asarray(values, dtype=None):
        return values


class _FakeTensor:
    def __init__(self, data):
        self._data = data

    def unsqueeze(self, dim):
        return self

    def detach(self):
        return self

    def cpu(self):
        return self

    def numpy(self):
        return self._data


class _FakeTorch:
    float32 = "float32"

    @staticmethod
    def tensor(data, dtype=None):
        return _FakeTensor(data)

    class _NoGrad:
        def __enter__(self):
            return None

        def __exit__(self, exc_type, exc, tb):
            return False

    @staticmethod
    def no_grad():
        return _FakeTorch._NoGrad()


class _FakeModelOutput:
    def __init__(self, vertices):
        self.vertices = [_FakeTensor(vertices)]


class _FakeSmplModel:
    faces = [[0, 1, 2]]

    def eval(self):
        return self

    def __call__(self, betas=None, return_verts=True):
        return _FakeModelOutput([[0.0, 0.0, 0.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]])


def _fake_landmarks():
    landmarks = []
    for index in range(33):
        landmarks.append({"x": 0.5, "y": 0.5, "z": 0.0, "visibility": 0.99})

    landmarks[0].update({"x": 0.50, "y": 0.10})
    landmarks[11].update({"x": 0.40, "y": 0.20})
    landmarks[12].update({"x": 0.60, "y": 0.20})
    landmarks[13].update({"x": 0.35, "y": 0.35})
    landmarks[14].update({"x": 0.65, "y": 0.35})
    landmarks[15].update({"x": 0.30, "y": 0.50})
    landmarks[16].update({"x": 0.70, "y": 0.50})
    landmarks[23].update({"x": 0.43, "y": 0.50})
    landmarks[24].update({"x": 0.57, "y": 0.50})
    landmarks[25].update({"x": 0.44, "y": 0.75})
    landmarks[26].update({"x": 0.56, "y": 0.75})
    landmarks[27].update({"x": 0.44, "y": 0.95})
    landmarks[28].update({"x": 0.56, "y": 0.95})
    return landmarks


def test_valid_measurements_generate_vertices(monkeypatch):
    monkeypatch.setattr(smpl_model, "np", _FakeNumpy(), raising=False)
    monkeypatch.setattr(smpl_model, "torch", _FakeTorch(), raising=False)
    monkeypatch.setattr(smpl_model, "_NUMPY_IMPORT_ERROR", None, raising=False)
    monkeypatch.setattr(smpl_model, "_TORCH_IMPORT_ERROR", None, raising=False)
    monkeypatch.setattr(smpl_model, "_SMPLX_IMPORT_ERROR", None, raising=False)
    monkeypatch.setattr(smpl_model, "load_smpl_model", lambda: _FakeSmplModel(), raising=False)
    monkeypatch.setattr(smpl_model, "_normalize_mesh_scale", lambda vertices, measurements: vertices, raising=False)

    vertices, faces = smpl_model.generate_body_mesh(VALID_MEASUREMENTS)

    assert len(vertices) == 3
    assert faces == [[0, 1, 2]]


def test_invalid_measurements_rejected():
    with pytest.raises(ValueError):
        smpl_model.validate_measurements({"shoulder_width_cm": 80.0})


def test_glb_file_exported(monkeypatch):
    class _FakeMesh:
        def __init__(self, vertices=None, faces=None, process=False):
            self.vertices = vertices
            self.faces = faces

        def export(self, output_path=None, file_type="glb"):
            if output_path is None:
                return b"glb"
            Path(output_path).write_bytes(b"glb")
            return b"glb"

    class _FakeTrimeshModule:
        Trimesh = _FakeMesh

    monkeypatch.setattr(avatar_generator, "trimesh", _FakeTrimeshModule(), raising=False)
    monkeypatch.setattr(avatar_generator, "_TRIMESH_IMPORT_ERROR", None, raising=False)

    mesh_bytes = avatar_generator.export_mesh([[0, 0, 0]], [[0, 1, 2]])
    assert mesh_bytes == b"glb"


def test_avatar_status_api_works(client, auth_headers, fake_db):
    not_ready = client.get("/api/user/avatar", headers=auth_headers("customer-1"))
    assert not_ready.status_code == 200
    assert not_ready.json() == {"avatar_ready": False, "mesh_url": None, "status": "none"}

    fake_db.users.documents[0]["avatar_mesh"] = "/avatars/customer-1.glb"
    fake_db.users.documents[0]["avatar_generation_status"] = "ready"
    ready = client.get("/api/user/avatar", headers=auth_headers("customer-1"))

    assert ready.status_code == 200
    assert ready.json() == {"avatar_ready": True, "mesh_url": "/avatars/customer-1.glb", "status": "ready"}


@pytest.mark.asyncio
async def test_duplicate_generation_prevented(fake_db, monkeypatch):
    fake_db.users.documents[0]["avatar_generation_status"] = "pending"
    monkeypatch.setattr(avatar_generator, "generate_body_mesh_data", lambda measurements: ([[0, 0, 0]], [[0, 1, 2]]), raising=False)
    monkeypatch.setattr(avatar_generator, "save_avatar_mesh", lambda user_id, mesh_bytes: "/avatars/customer-1.glb", raising=False)

    with pytest.raises(RuntimeError):
        await avatar_generator.generate_avatar("customer-1", VALID_MEASUREMENTS, fake_db)


def test_storage_abstraction_works(monkeypatch):
    output_dir = Path("backend") / "temp" / "avatar-storage-test"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "customer-1.glb"
    if output_path.exists():
        output_path.unlink()
    monkeypatch.setattr(avatar_storage, "LOCAL_AVATAR_DIR", output_dir, raising=False)
    url = avatar_storage.save_avatar_mesh("customer-1", b"mesh-bytes")

    assert url == "/avatars/customer-1.glb"
    assert output_path.read_bytes() == b"mesh-bytes"


def test_celery_task_enqueues_correctly(monkeypatch):
    recorded = []

    class _FakeTask:
        @staticmethod
        def delay(user_id, measurements):
            recorded.append((user_id, measurements))

    monkeypatch.setattr(avatar_worker, "celery_app", object(), raising=False)
    monkeypatch.setattr(avatar_worker, "generate_avatar_task", _FakeTask, raising=False)

    enqueued = avatar_worker.enqueue_avatar_generation_task("customer-1", VALID_MEASUREMENTS)

    assert enqueued is True
    assert recorded == [("customer-1", VALID_MEASUREMENTS)]


def test_background_fallback_triggers_generation(client, auth_headers, fake_db, monkeypatch):
    scheduled = []

    async def _fake_generate_avatar_for_user(user_id, measurements):
        scheduled.append((user_id, measurements))

    monkeypatch.setattr(server, "ensure_ai_dependencies", lambda: None, raising=False)
    monkeypatch.setattr(server, "detect_landmarks", lambda path: _fake_landmarks(), raising=False)
    monkeypatch.setattr(server, "calculate_measurements", lambda *args, **kwargs: VALID_MEASUREMENTS, raising=False)
    monkeypatch.setattr(server, "enqueue_avatar_generation_task", lambda user_id, measurements: False, raising=False)
    monkeypatch.setattr(server, "worker_enabled", lambda: False, raising=False)
    monkeypatch.setattr(server, "generate_avatar_for_user", _fake_generate_avatar_for_user, raising=False)

    response = client.post(
        "/ai/scan-body",
        headers=auth_headers("customer-1"),
        files={
            "front_image": ("front.jpg", b"front", "image/jpeg"),
            "side_image": ("side.jpg", b"side", "image/jpeg"),
            "back_image": ("back.jpg", b"back", "image/jpeg"),
        },
        data={"height_cm": "170"},
    )

    assert response.status_code == 200
    assert scheduled == [("customer-1", VALID_MEASUREMENTS)]
    assert fake_db.users.documents[0]["body_measurements"] == VALID_MEASUREMENTS
    assert fake_db.users.documents[0]["avatar_generation_status"] == "none"


def test_measure_endpoint_returns_ui_contract(client, monkeypatch):
    enhanced_measurements = {
        "shoulder_width_cm": 42.0,
        "chest_cm": 96.0,
        "waist_cm": 82.0,
        "hip_width_cm": 38.0,
        "hip_circumference_cm": 98.0,
        "arm_length_cm": 60.0,
        "leg_length_cm": 92.0,
        "neck_cm": 36.0,
        "torso_depth_cm": 22.0,
        "measurement_details": {
            "shoulder": {"value": 42.0, "confidence": 0.92},
            "chest": {"value": 96.0, "confidence": 0.89},
        },
        "confidence": {"overall": 0.9},
        "pixel_to_cm": 0.12,
    }

    monkeypatch.setattr(server, "ensure_ai_dependencies", lambda: None, raising=False)
    monkeypatch.setattr(server, "detect_landmarks", lambda path: _fake_landmarks(), raising=False)
    monkeypatch.setattr(server, "detect_pose", None, raising=False)
    monkeypatch.setattr(server, "calculate_measurements", lambda *args, **kwargs: enhanced_measurements, raising=False)

    response = client.post(
        "/ai/measure",
        files={
            "front_image": ("front.jpg", b"front", "image/jpeg"),
            "side_image": ("side.jpg", b"side", "image/jpeg"),
            "back_image": ("back.jpg", b"back", "image/jpeg"),
        },
        data={"height_cm": "170"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["measurements"]["shoulder"] == 42.0
    assert payload["measurements"]["chest"] == 96.0
    assert payload["measurements"]["hip"] == 98.0
    assert payload["legacy_measurements"]["hip_width_cm"] == 38.0
