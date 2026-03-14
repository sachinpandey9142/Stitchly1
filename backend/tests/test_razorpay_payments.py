import hashlib
import hmac
import os


def _create_order(client, headers, payment_method="online"):
    response = client.post(
        "/api/orders",
        headers=headers,
        json={
            "tailor_id": "tailor-1",
            "service_type": "Blouse Stitching",
            "description": "Payment flow test order",
            "pickup_address": "123 Marine Drive",
            "payment_method": payment_method,
        },
    )
    assert response.status_code == 200
    return response.json()


def _signature(razorpay_order_id, razorpay_payment_id):
    message = f"{razorpay_order_id}|{razorpay_payment_id}"
    return hmac.new(
        os.environ["RAZORPAY_KEY_SECRET"].encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def test_cod_orders_cannot_create_payment_orders(client, auth_headers):
    order = _create_order(client, auth_headers("customer-1"), payment_method="cod")

    response = client.post(
        "/api/payment/create-order",
        headers=auth_headers("customer-1"),
        json={"order_id": order["id"]},
    )

    assert response.status_code == 400
    assert "online" in response.json()["detail"].lower()


def test_verify_payment_requires_matching_razorpay_order_id(client, auth_headers):
    order = _create_order(client, auth_headers("customer-1"))
    payment_order = client.post(
        "/api/payment/create-order",
        headers=auth_headers("customer-1"),
        json={"order_id": order["id"]},
    ).json()

    response = client.post(
        "/api/payment/verify",
        headers=auth_headers("customer-1"),
        json={
            "order_id": order["id"],
            "razorpay_payment_id": "pay_test_1",
            "razorpay_order_id": "order_wrong",
            "razorpay_signature": _signature(payment_order["razorpay_order_id"], "pay_test_1"),
        },
    )

    assert response.status_code == 400
    assert "mismatch" in response.json()["detail"].lower()


def test_verify_payment_is_idempotent(client, auth_headers):
    order = _create_order(client, auth_headers("customer-1"))
    payment_order = client.post(
        "/api/payment/create-order",
        headers=auth_headers("customer-1"),
        json={"order_id": order["id"]},
    ).json()

    payload = {
        "order_id": order["id"],
        "razorpay_payment_id": "pay_test_2",
        "razorpay_order_id": payment_order["razorpay_order_id"],
        "razorpay_signature": _signature(payment_order["razorpay_order_id"], "pay_test_2"),
    }

    first = client.post("/api/payment/verify", headers=auth_headers("customer-1"), json=payload)
    second = client.post("/api/payment/verify", headers=auth_headers("customer-1"), json=payload)
    status = client.get(f"/api/payment/status/{order['id']}", headers=auth_headers("customer-1"))

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["message"] == "Payment already verified"
    assert status.json()["payment_status"] == "completed"


def test_delivery_completion_does_not_complete_payment(client, auth_headers):
    order = _create_order(client, auth_headers("customer-1"))

    accepted = client.put(f"/api/orders/{order['id']}/accept", headers=auth_headers("tailor-1"))
    assert accepted.status_code == 200
    assert accepted.json()["delivery_partner_id"] == "delivery-1"

    assert client.put(f"/api/delivery/{order['id']}/accept", headers=auth_headers("delivery-1")).status_code == 200
    assert client.put(
        f"/api/delivery/{order['id']}/update",
        headers=auth_headers("delivery-1"),
        json={"status": "picked_up"},
    ).status_code == 200
    assert client.put(
        f"/api/delivery/{order['id']}/update",
        headers=auth_headers("delivery-1"),
        json={"status": "delivered_to_tailor"},
    ).status_code == 200

    assert client.put(
        f"/api/orders/{order['id']}/status",
        headers=auth_headers("tailor-1"),
        json={"status": "in_stitching"},
    ).status_code == 200
    assert client.put(
        f"/api/orders/{order['id']}/status",
        headers=auth_headers("tailor-1"),
        json={"status": "completed"},
    ).status_code == 200

    ready = client.put(
        f"/api/orders/{order['id']}/status",
        headers=auth_headers("tailor-1"),
        json={"status": "ready"},
    )
    assert ready.status_code == 200
    assert ready.json()["status"] == "delivery_assigned"

    assert client.put(f"/api/delivery/{order['id']}/accept", headers=auth_headers("delivery-1")).status_code == 200
    assert client.put(
        f"/api/delivery/{order['id']}/update",
        headers=auth_headers("delivery-1"),
        json={"status": "out_for_delivery"},
    ).status_code == 200
    delivered = client.put(
        f"/api/delivery/{order['id']}/update",
        headers=auth_headers("delivery-1"),
        json={"status": "delivered"},
    )

    assert delivered.status_code == 200
    payment_status = client.get(f"/api/payment/status/{order['id']}", headers=auth_headers("customer-1"))
    assert payment_status.status_code == 200
    assert payment_status.json()["payment_status"] == "pending"
