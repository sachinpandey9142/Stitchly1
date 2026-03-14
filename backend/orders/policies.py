from fastapi import HTTPException


ORDER_ACCESS_FIELDS = {
    "customer": "customer_id",
    "tailor": "tailor_id",
    "delivery": "delivery_partner_id",
}

VALID_ORDER_STATUSES = {
    "placed",
    "accepted",
    "pickup_assigned",
    "delivery_accepted",
    "picked_up",
    "delivered_to_tailor",
    "in_stitching",
    "completed",
    "ready",
    "ready_for_delivery",
    "delivery_assigned",
    "out_for_delivery",
    "delivered",
    "rejected",
    "cancelled",
}

ROLE_TRANSITIONS = {
    "customer": {
        "placed": {"cancelled"},
    },
    "tailor": {
        "placed": {"accepted", "rejected"},
        "delivered_to_tailor": {"in_stitching"},
        "in_stitching": {"completed"},
        "completed": {"ready"},
        "ready_for_delivery": {"ready"},
        "ready": {"ready"},
    },
    "delivery": {
        "pickup_assigned": {"delivery_accepted"},
        "delivery_accepted": {"picked_up", "out_for_delivery"},
        "picked_up": {"delivered_to_tailor"},
        "out_for_delivery": {"delivered"},
        "delivery_assigned": {"delivery_accepted"},
    },
}


def ensure_order_access(user: dict, order: dict) -> None:
    if user["role"] == "admin":
        return

    owner_field = ORDER_ACCESS_FIELDS.get(user["role"])
    if not owner_field or order.get(owner_field) != user["id"]:
        raise HTTPException(status_code=403, detail="Not allowed to access this order")


def ensure_transition_allowed(user: dict, order: dict, next_status: str) -> None:
    ensure_order_access(user, order)
    if next_status not in VALID_ORDER_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")

    if user["role"] == "admin":
        return

    allowed = ROLE_TRANSITIONS.get(user["role"], {}).get(order["status"], set())
    if next_status not in allowed:
        raise HTTPException(status_code=400, detail="Invalid status transition")
