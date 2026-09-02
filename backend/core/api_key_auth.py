import hashlib
import hmac
import secrets

from fastapi import Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.models.api_key import APIKeyORM
from backend.shared.db import SessionLocal


def generate_api_key() -> tuple[str, str, str]:
    """Generate API key. Returns (full_key, prefix, hash)."""
    raw = secrets.token_urlsafe(32)
    full_key = f"otui_{raw}"
    prefix = full_key[:12]
    key_hash = hashlib.sha256(full_key.encode()).hexdigest()
    return full_key, prefix, key_hash


def verify_api_key(provided_key: str, stored_hash: str) -> bool:
    candidate = hashlib.sha256(provided_key.encode()).hexdigest()
    return hmac.compare_digest(candidate, stored_hash)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


async def get_api_key_user(
    request: Request,
    db: Session = Depends(get_db),
) -> APIKeyORM:
    """FastAPI dependency: extract and validate X-API-Key header."""
    key = request.headers.get("X-API-Key")
    if not key:
        raise HTTPException(status_code=401, detail="Missing X-API-Key header")

    # Look up by prefix
    prefix = key[:12]
    candidates = (
        db.query(APIKeyORM)
        .filter(APIKeyORM.key_prefix == prefix, APIKeyORM.is_active == 1)
        .all()
    )
    api_key = next(
        (candidate for candidate in candidates if verify_api_key(key, candidate.key_hash)),
        None,
    )
    if api_key is None:
        raise HTTPException(status_code=401, detail="Invalid API key")

    # Update last_used_at
    api_key.last_used_at = func.now()
    db.commit()
    return api_key


async def get_write_api_key(api_key: APIKeyORM = Depends(get_api_key_user)) -> APIKeyORM:
    """Require an active API key explicitly created with write permission."""
    if api_key.permissions != "read_write":
        raise HTTPException(status_code=403, detail="API key requires read_write permission")
    return api_key
