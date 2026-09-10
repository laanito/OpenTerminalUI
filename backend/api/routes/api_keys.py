from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Literal, Optional
from datetime import datetime

from backend.shared.db import SessionLocal
from backend.models.api_key import APIKeyORM
from backend.models.user import User
from backend.core.api_key_auth import generate_api_key
from backend.auth.deps import get_current_user

router = APIRouter()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class APIKeyCreate(BaseModel):
    name: str
    permissions: Literal["read", "read_write"] = "read"

class APIKeyResponse(BaseModel):
    id: int
    name: str
    prefix: str
    permissions: str
    is_active: int
    last_used_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True

class APIKeyNewResponse(APIKeyResponse):
    key: str # Full key only returned once


def _response_payload(api_key: APIKeyORM) -> dict[str, object]:
    """Map the persistence name ``key_prefix`` to the public ``prefix`` field."""
    return {
        "id": api_key.id,
        "name": api_key.name,
        "prefix": api_key.key_prefix,
        "permissions": api_key.permissions,
        "is_active": api_key.is_active,
        "last_used_at": api_key.last_used_at,
        "created_at": api_key.created_at,
    }

@router.post("/settings/api-keys", response_model=APIKeyNewResponse)
def create_api_key(
    data: APIKeyCreate, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    full_key, prefix, key_hash = generate_api_key()
    
    new_key = APIKeyORM(
        name=data.name,
        key_prefix=prefix,
        key_hash=key_hash,
        permissions=data.permissions,
        user_id=current_user.id
    )
    db.add(new_key)
    db.commit()
    db.refresh(new_key)
    
    return {**_response_payload(new_key), "key": full_key}

@router.get("/settings/api-keys", response_model=List[APIKeyResponse])
def list_api_keys(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    keys = db.query(APIKeyORM).filter(
        APIKeyORM.is_active == 1,
        APIKeyORM.user_id == current_user.id
    ).all()
    return [_response_payload(api_key) for api_key in keys]

@router.delete("/settings/api-keys/{key_id}")
def revoke_api_key(
    key_id: int, 
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    api_key = db.query(APIKeyORM).filter(
        APIKeyORM.id == key_id,
        APIKeyORM.user_id == current_user.id
    ).first()
    if not api_key:
        raise HTTPException(status_code=404, detail="API key not found")
    
    api_key.is_active = 0
    db.commit()
    return {"status": "revoked"}
