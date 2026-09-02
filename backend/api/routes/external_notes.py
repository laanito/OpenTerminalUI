"""Narrow API-key ingestion contract for external Second Brain notes.

This is deliberately an HTTP upsert, not a general MCP surface. Automations such
as Hermes can submit one summary per stable external object without holding a
browser JWT or creating duplicates when a job retries.
"""

from __future__ import annotations

import re
from typing import Literal
from uuid import NAMESPACE_URL, uuid5

from fastapi import APIRouter, BackgroundTasks, Depends, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.api.routes.notes import (
    NoteOut,
    _normalize_symbol,
    _normalize_tags,
    _reindex_user_brain,
    _serialize,
)
from backend.core.api_key_auth import get_write_api_key
from backend.core.rate_limiter import api_key_rate_limiter
from backend.models.api_key import APIKeyORM
from backend.models.notes import NoteORM

router = APIRouter(prefix="/v1/notes", tags=["external-notes"])

NoteContext = Literal["general", "security", "watchlist", "news", "holding", "transaction"]
_SOURCE_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,15}$")


class ExternalNoteUpsert(BaseModel):
    source: str = Field(min_length=1, max_length=16)
    external_id: str = Field(min_length=1, max_length=38)
    body: str = Field(min_length=1, max_length=10000)
    title: str = Field(default="", max_length=256)
    symbol: str | None = Field(default=None, max_length=64)
    context: NoteContext = "general"
    tags: list[str] = Field(default_factory=list, max_length=32)

    @field_validator("source")
    @classmethod
    def normalize_source(cls, value: str) -> str:
        source = value.strip().lower()
        if not _SOURCE_RE.fullmatch(source):
            raise ValueError("source must contain only letters, numbers, _ or -")
        return source

    @field_validator("external_id", "body")
    @classmethod
    def reject_blank(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("value must not be blank")
        return normalized


class ExternalNoteUpsertResponse(BaseModel):
    created: bool
    note: NoteOut


def _stable_note_id(user_id: str, source: str, external_id: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"openterminalui:{user_id}:{source}:{external_id}"))


@router.put("/external", response_model=ExternalNoteUpsertResponse)
def upsert_external_note(
    payload: ExternalNoteUpsert,
    response: Response,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    api_key: APIKeyORM = Depends(get_write_api_key),
    _rate_limit: None = Depends(api_key_rate_limiter),
) -> ExternalNoteUpsertResponse:
    """Create or replace one owner-scoped note using a stable external identity."""
    user_id = api_key.user_id
    note_id = _stable_note_id(user_id, payload.source, payload.external_id)
    row = (
        db.query(NoteORM)
        .filter(NoteORM.id == note_id, NoteORM.user_id == user_id)
        .first()
    )
    created = row is None
    if row is None:
        row = NoteORM(id=note_id, user_id=user_id)
        db.add(row)

    row.symbol = _normalize_symbol(payload.symbol)
    row.context = payload.context
    row.ref_id = f"{payload.source}:{payload.external_id}"
    row.title = payload.title.strip()
    row.body = payload.body
    row.tags = _normalize_tags([*payload.tags, "external", f"source:{payload.source}"])
    db.commit()
    db.refresh(row)

    if created:
        response.status_code = 201
    background.add_task(_reindex_user_brain, user_id)
    return ExternalNoteUpsertResponse(created=created, note=_serialize(row))
