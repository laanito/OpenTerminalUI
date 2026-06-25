"""Generic per-user notes CRUD — the capture layer feeding the second brain.

Authed (per-user, never /api/v1). Mounted under "/api" → /api/notes.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.models.notes import NOTE_CONTEXTS, NoteORM
from backend.models.user import User

router = APIRouter(prefix="/notes", tags=["notes"])


class NoteCreate(BaseModel):
    body: str = Field(min_length=1, max_length=10000)
    symbol: str | None = Field(default=None, max_length=64)
    context: str = Field(default="general", max_length=32)
    ref_id: str | None = Field(default=None, max_length=64)
    title: str = Field(default="", max_length=256)
    tags: list[str] = Field(default_factory=list)


class NoteUpdate(BaseModel):
    body: str | None = Field(default=None, max_length=10000)
    title: str | None = Field(default=None, max_length=256)
    tags: list[str] | None = None


class NoteOut(BaseModel):
    id: str
    symbol: str | None
    context: str
    ref_id: str | None
    title: str
    body: str
    tags: list[str]
    created_at: str | None
    updated_at: str | None


def _serialize(row: NoteORM) -> NoteOut:
    return NoteOut(
        id=row.id,
        symbol=row.symbol,
        context=row.context,
        ref_id=row.ref_id,
        title=row.title,
        body=row.body,
        tags=list(row.tags or []),
        created_at=row.created_at.isoformat() if row.created_at else None,
        updated_at=row.updated_at.isoformat() if row.updated_at else None,
    )


def _normalize_context(context: str) -> str:
    ctx = (context or "general").strip().lower()
    return ctx if ctx in NOTE_CONTEXTS else "general"


def _normalize_symbol(symbol: str | None) -> str | None:
    s = (symbol or "").strip().upper()
    return s or None


def _normalize_tags(tags: list[str] | None) -> list[str]:
    out: list[str] = []
    for raw in tags or []:
        v = str(raw or "").strip()
        if v and v not in out:
            out.append(v)
    return out


@router.get("", response_model=list[NoteOut])
def list_notes(
    symbol: str | None = Query(default=None),
    context: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[NoteOut]:
    q = db.query(NoteORM).filter(NoteORM.user_id == current_user.id)
    sym = _normalize_symbol(symbol)
    if sym:
        q = q.filter(NoteORM.symbol == sym)
    if context:
        q = q.filter(NoteORM.context == _normalize_context(context))
    rows = q.order_by(NoteORM.updated_at.desc()).all()
    return [_serialize(r) for r in rows]


@router.post("", response_model=NoteOut, status_code=201)
def create_note(
    payload: NoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> NoteOut:
    row = NoteORM(
        user_id=current_user.id,
        symbol=_normalize_symbol(payload.symbol),
        context=_normalize_context(payload.context),
        ref_id=(payload.ref_id or None),
        title=payload.title.strip(),
        body=payload.body.strip(),
        tags=_normalize_tags(payload.tags),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize(row)


@router.put("/{note_id}", response_model=NoteOut)
def update_note(
    note_id: str,
    payload: NoteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> NoteOut:
    row = (
        db.query(NoteORM)
        .filter(NoteORM.id == note_id, NoteORM.user_id == current_user.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Note not found")
    if payload.body is not None:
        row.body = payload.body.strip()
    if payload.title is not None:
        row.title = payload.title.strip()
    if payload.tags is not None:
        row.tags = _normalize_tags(payload.tags)
    db.commit()
    db.refresh(row)
    return _serialize(row)


@router.delete("/{note_id}", status_code=204)
def delete_note(
    note_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    row = (
        db.query(NoteORM)
        .filter(NoteORM.id == note_id, NoteORM.user_id == current_user.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Note not found")
    db.delete(row)
    db.commit()
