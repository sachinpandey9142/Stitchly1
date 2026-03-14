from datetime import datetime, timezone
from typing import Optional

from pymongo import ReturnDocument


async def reserve_delivery_partner(db, delivery_partner_id: str) -> Optional[dict]:
    if not delivery_partner_id:
        return None
    return await db.users.find_one_and_update(
        {
            "id": delivery_partner_id,
            "role": "delivery",
            "status": "active",
            "is_available": True,
        },
        {"$set": {"is_available": False, "updated_at": datetime.now(timezone.utc).isoformat()}},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )


async def release_delivery_partner(db, delivery_partner_id: str) -> None:
    if not delivery_partner_id:
        return
    await db.users.update_one(
        {"id": delivery_partner_id, "role": "delivery"},
        {"$set": {"is_available": True, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )


async def assign_order_to_reserved_driver(
    db,
    order: dict,
    driver: dict,
    phase: str,
    target_status: str,
) -> Optional[dict]:
    now = datetime.now(timezone.utc).isoformat()
    return await db.orders.find_one_and_update(
        {
            "id": order["id"],
            "delivery_partner_id": "",
            "status": order["status"],
        },
        {"$set": {
            "delivery_partner_id": driver["id"],
            "delivery_partner_name": driver["name"],
            "delivery_partner_phone": driver.get("phone", ""),
            "delivery_phase": phase,
            "status": target_status,
            "updated_at": now,
        }},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
