def _create_order(client, headers, payment_method="cod"):
    response = client.post(
        "/api/orders",
        headers=headers,
        json={
            "tailor_id": "tailor-1",
            "service_type": "Blouse Stitching",
            "description": "Production test order",
            "pickup_address": "123 Marine Drive",
            "payment_method": payment_method,
        },
    )
    assert response.status_code == 200
    return response.json()


def test_login_issues_expiring_jwt(client, decode_token):
    response = client.post(
        "/api/auth/login",
        json={"email": "customer@test.com", "password": "password123"},
    )

    assert response.status_code == 200
    token = response.json()["token"]
    claims = decode_token(token)

    assert claims["user_id"] == "customer-1"
    assert claims["role"] == "customer"
    assert claims["token_version"] == 1
    assert claims["exp"] > claims["iat"]


def test_order_access_is_restricted_to_participants(client, auth_headers):
    order = _create_order(client, auth_headers("customer-1"))

    forbidden_order = client.get(f"/api/orders/{order['id']}", headers=auth_headers("customer-2"))
    forbidden_payment = client.get(f"/api/payment/status/{order['id']}", headers=auth_headers("customer-2"))

    assert forbidden_order.status_code == 403
    assert forbidden_payment.status_code == 403


def test_customer_can_cancel_placed_order_but_not_jump_states(client, auth_headers):
    cancel_target = _create_order(client, auth_headers("customer-1"))
    cancelled = client.put(
        f"/api/orders/{cancel_target['id']}/status",
        headers=auth_headers("customer-1"),
        json={"status": "cancelled"},
    )

    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"

    invalid_target = _create_order(client, auth_headers("customer-1"))
    invalid = client.put(
        f"/api/orders/{invalid_target['id']}/status",
        headers=auth_headers("customer-1"),
        json={"status": "delivered"},
    )

    assert invalid.status_code == 400
    assert "transition" in invalid.json()["detail"].lower()


def test_delivery_updates_require_assigned_driver(client, auth_headers):
    order = _create_order(client, auth_headers("customer-1"))

    accepted = client.put(f"/api/orders/{order['id']}/accept", headers=auth_headers("tailor-1"))
    assert accepted.status_code == 200
    accepted_order = accepted.json()
    assert accepted_order["status"] == "pickup_assigned"
    assert accepted_order["delivery_partner_id"] == "delivery-1"

    other_driver_accept = client.put(f"/api/delivery/{order['id']}/accept", headers=auth_headers("delivery-2"))
    assert other_driver_accept.status_code == 404

    assigned_driver_accept = client.put(f"/api/delivery/{order['id']}/accept", headers=auth_headers("delivery-1"))
    assert assigned_driver_accept.status_code == 200
    assert assigned_driver_accept.json()["status"] == "delivery_accepted"

    other_driver_update = client.put(
        f"/api/delivery/{order['id']}/update",
        headers=auth_headers("delivery-2"),
        json={"status": "picked_up"},
    )
    assert other_driver_update.status_code == 404


def test_delivery_pickup_details_are_saved_for_tailor(client, auth_headers):
    create_order = client.post(
        "/api/orders",
        headers=auth_headers("customer-1"),
        json={
            "tailor_id": "tailor-1",
            "service_type": "Blouse Stitching",
            "description": "Capture pickup measurements",
            "pickup_address": "123 Marine Drive",
            "payment_method": "cod",
            "measurement_type": "expert",
            "send_reference_cloth": True,
            "reference_cloth_note": "Blue sample blouse",
        },
    )
    assert create_order.status_code == 200
    order_id = create_order.json()["id"]

    accepted = client.put(f"/api/orders/{order_id}/accept", headers=auth_headers("tailor-1"))
    assert accepted.status_code == 200
    assert accepted.json()["delivery_partner_id"] == "delivery-1"

    pickup_details = client.put(
        f"/api/delivery/{order_id}/pickup-details",
        headers=auth_headers("delivery-1"),
        json={
            "measurement_received": True,
            "measurement_note": "Customer confirmed measurements.",
            "measurements": {
                "chest_cm": 92,
                "waist_cm": 74.5,
                "hip_cm": 98,
            },
            "reference_cloth_received": True,
            "reference_cloth_note": "Received 1 reference cloth",
        },
    )
    assert pickup_details.status_code == 200
    payload = pickup_details.json()
    assert payload["pickup_measurement_received"] is True
    assert payload["pickup_measurements"]["chest_cm"] == 92.0
    assert payload["pickup_reference_cloth_received"] is True
    assert payload["pickup_reference_cloth_note"] == "Received 1 reference cloth"

    tailor_view = client.get(f"/api/orders/{order_id}", headers=auth_headers("tailor-1"))
    assert tailor_view.status_code == 200
    tailor_payload = tailor_view.json()
    assert tailor_payload["pickup_measurement_received"] is True
    assert tailor_payload["pickup_measurements"]["waist_cm"] == 74.5
    assert tailor_payload["pickup_reference_cloth_received"] is True
