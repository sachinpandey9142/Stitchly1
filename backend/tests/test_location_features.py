import pytest

import server


def _accepted_order(order_id):
    return {
        "id": order_id,
        "customer_id": "customer-1",
        "customer_name": "Anita",
        "customer_phone": "9000000001",
        "customer_city": "Mumbai",
        "customer_address": "123 Marine Drive",
        "customer_geo_location": {"type": "Point", "coordinates": [72.8237, 18.9440]},
        "tailor_id": "tailor-1",
        "tailor_name": "Ravi",
        "tailor_phone": "9000000003",
        "tailor_city": "Mumbai",
        "tailor_address": "Shop 12, Crawford Market",
        "tailor_geo_location": {"type": "Point", "coordinates": [72.8331, 18.9476]},
        "pickup_geo_location": {"type": "Point", "coordinates": [72.8237, 18.9440]},
        "delivery_partner_id": "",
        "delivery_partner_name": "",
        "delivery_partner_phone": "",
        "delivery_phase": "",
        "service_type": "Blouse Stitching",
        "description": "Dispatch test",
        "pickup_address": "123 Marine Drive",
        "delivery_address": "123 Marine Drive",
        "price": 800,
        "commission_amount": 80,
        "status": "accepted",
        "payment_status": "cod",
        "payment_method": "cod",
        "created_at": "2026-03-14T11:00:00+00:00",
        "updated_at": "2026-03-14T11:00:00+00:00",
    }


@pytest.mark.asyncio
async def test_atomic_assignment_prevents_double_booking(fake_db, monkeypatch):
    monkeypatch.setattr(server, "db", fake_db, raising=False)
    fake_db.users.documents[4]["is_available"] = False
    fake_db.orders.documents.extend([_accepted_order("order-1"), _accepted_order("order-2")])

    order_one = await server.db.orders.find_one({"id": "order-1"}, {"_id": 0})
    order_two = await server.db.orders.find_one({"id": "order-2"}, {"_id": 0})

    first = await server.assign_delivery_partner_to_order(order_one, "pickup", "pickup_assigned")
    second = await server.assign_delivery_partner_to_order(order_two, "pickup", "pickup_assigned")

    assigned_orders = [
        order
        for order in fake_db.orders.documents
        if order.get("delivery_partner_id") == "delivery-1"
    ]

    assert first is not None
    assert second is None
    assert len(assigned_orders) == 1


def test_driver_availability_triggers_driver_centric_assignment(client, auth_headers, fake_db):
    fake_db.users.documents[3]["is_available"] = False

    order_response = client.post(
        "/api/orders",
        headers=auth_headers("customer-1"),
        json={
            "tailor_id": "tailor-1",
            "service_type": "Blouse Stitching",
            "description": "Retry dispatch",
            "pickup_address": "123 Marine Drive",
            "payment_method": "cod",
        },
    )
    order_id = order_response.json()["id"]

    accepted = client.put(f"/api/orders/{order_id}/accept", headers=auth_headers("tailor-1"))
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "accepted"

    availability = client.put(
        "/api/delivery/availability",
        headers=auth_headers("delivery-1"),
        json={"is_available": True},
    )
    assert availability.status_code == 200

    refreshed = client.get(f"/api/orders/{order_id}", headers=auth_headers("tailor-1"))
    assert refreshed.status_code == 200
    assert refreshed.json()["status"] == "pickup_assigned"
    assert refreshed.json()["delivery_partner_id"] == "delivery-1"


def test_order_creation_falls_back_to_tailor_geo_when_customer_geo_missing(client, auth_headers, fake_db):
    fake_db.users.documents[0]["geo_location"] = None

    created = client.post(
        "/api/orders",
        headers=auth_headers("customer-1"),
        json={
            "tailor_id": "tailor-1",
            "service_type": "Blouse Stitching",
            "description": "Missing customer geo",
            "pickup_address": "123 Marine Drive",
            "payment_method": "cod",
        },
    )

    assert created.status_code == 200
    payload = created.json()
    assert payload["customer_geo_location"] is None
    assert payload["pickup_geo_location"] == fake_db.users.documents[2]["geo_location"]


def test_legacy_null_pickup_geo_orders_still_auto_assign_on_driver_availability(client, auth_headers, fake_db):
    fake_db.users.documents[0]["geo_location"] = None
    fake_db.users.documents[3]["is_available"] = False

    created = client.post(
        "/api/orders",
        headers=auth_headers("customer-1"),
        json={
            "tailor_id": "tailor-1",
            "service_type": "Blouse Stitching",
            "description": "Legacy null pickup geo",
            "pickup_address": "123 Marine Drive",
            "payment_method": "cod",
        },
    )
    assert created.status_code == 200
    order_id = created.json()["id"]

    accepted = client.put(f"/api/orders/{order_id}/accept", headers=auth_headers("tailor-1"))
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "accepted"

    # Simulate pre-fix legacy data where pickup geo was persisted as null.
    stored = next(order for order in fake_db.orders.documents if order["id"] == order_id)
    stored["pickup_geo_location"] = None

    availability = client.put(
        "/api/delivery/availability",
        headers=auth_headers("delivery-1"),
        json={"is_available": True},
    )
    assert availability.status_code == 200

    refreshed = client.get(f"/api/orders/{order_id}", headers=auth_headers("tailor-1"))
    assert refreshed.status_code == 200
    assert refreshed.json()["status"] == "pickup_assigned"
    assert refreshed.json()["delivery_partner_id"] == "delivery-1"
    assert refreshed.json()["pickup_geo_location"] is not None


def test_startup_creates_required_geospatial_indexes(client, fake_db):
    order_indexes = {str(index["keys"]) for index in fake_db.orders.indexes}
    user_indexes = {str(index["keys"]) for index in fake_db.users.indexes}

    assert "[('pickup_geo_location', '2dsphere')]" in order_indexes
    assert "[('tailor_geo_location', '2dsphere')]" in order_indexes
    assert "[('geo_location', '2dsphere')]" in user_indexes
