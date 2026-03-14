from datetime import datetime, timedelta, timezone

from jose import jwt


DEFAULT_TOKEN_TTL_HOURS = 24


def build_token_payload(user: dict, ttl_hours: int = DEFAULT_TOKEN_TTL_HOURS) -> dict:
    issued_at = datetime.now(timezone.utc)
    token_version = int(user.get("token_version", 1))
    return {
        "user_id": user["id"],
        "role": user["role"],
        "token_version": token_version,
        "iat": int(issued_at.timestamp()),
        "exp": int((issued_at + timedelta(hours=ttl_hours)).timestamp()),
    }


def create_access_token(user: dict, secret: str, algorithm: str, ttl_hours: int = DEFAULT_TOKEN_TTL_HOURS) -> str:
    payload = build_token_payload(user, ttl_hours=ttl_hours)
    return jwt.encode(payload, secret, algorithm=algorithm)
