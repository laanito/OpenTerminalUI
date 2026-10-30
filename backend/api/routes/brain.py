"""Private second-brain RAG API — ask/reindex/status over the user's own writing.

Mounted under "/api" → /api/brain/*. Authed per-user (never /api/v1, which is
exempt from auth): a user's brain is built only from their own journal, theses,
and notes and never leaves the machine.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import aclosing, suppress
from typing import Any, Literal

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.models.user import User
from backend.services.brain import brain_service
from backend.services.brain.indexer import reindex_user
from backend.services.llm_profiles import LLMProfileIdentity

router = APIRouter(prefix="/brain", tags=["brain"])

BrainSource = Literal["note", "journal", "portfolio", "holding", "transaction"]
_STREAM_HEARTBEAT_SECONDS = 15.0


async def _with_heartbeats(
    source: AsyncIterator[dict[str, Any]],
    *,
    interval_seconds: float = _STREAM_HEARTBEAT_SECONDS,
) -> AsyncIterator[dict[str, Any]]:
    """Keep an otherwise-idle NDJSON response alive while the model reasons."""
    pending: asyncio.Task[dict[str, Any]] | None = None
    try:
        while True:
            pending = pending or asyncio.create_task(anext(source))
            done, _ = await asyncio.wait({pending}, timeout=interval_seconds)
            if not done:
                yield {"type": "heartbeat"}
                continue
            try:
                event = pending.result()
            except StopAsyncIteration:
                pending = None
                return
            pending = None
            yield event
    finally:
        if pending is not None and not pending.done():
            pending.cancel()
            with suppress(asyncio.CancelledError):
                await pending
        close = getattr(source, "aclose", None)
        if close is not None:
            await close()


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    k: int = Field(default=6, ge=1, le=20)
    sources: list[BrainSource] | None = Field(default=None, min_length=1)


class Citation(BaseModel):
    n: int
    source: str
    title: str
    symbol: str | None = None
    snippet: str
    score: float
    effective_at: str | None = None
    recorded_at: str | None = None
    updated_at: str | None = None
    route: str | None = None
    ref_id: str
    chunk_index: int | None = None
    content_hash: str | None = None


class AskResponse(BaseModel):
    answer: str
    citations: list[Citation] = []
    sources: list[BrainSource]
    indexed_chunks: int | None = None
    llm: bool | None = None
    error: str | None = None
    generated_at: str | None = None
    llm_provider: str | None = None
    llm_model: str | None = None
    model_profile: LLMProfileIdentity | None = None


class ReindexResponse(BaseModel):
    indexed: int
    removed: int
    total: int
    backend: str
    dim: int
    sources: int


class StatusResponse(BaseModel):
    indexed_chunks: int
    source_counts: dict[BrainSource, int]
    backend: str
    embed_model: str


@router.post("/ask", response_model=AskResponse)
async def brain_ask(
    payload: AskRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AskResponse:
    result = await brain_service.ask(
        db,
        current_user.id,
        payload.question,
        k=payload.k,
        sources=payload.sources,
    )
    return AskResponse(**result)


@router.post("/ask/stream")
async def brain_ask_stream(
    payload: AskRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    """Stream one Brain operation with queued identity/deadline metadata before retrieval.

    The operation budget is the selected model timeout plus 120 seconds for
    preparation; browser clients add transport margin. Deltas are provisional
    until done or a replacement result. Interruption requires manual retry.
    """

    async def events():
        source = brain_service.ask_stream(
            db,
            current_user.id,
            payload.question,
            k=payload.k,
            sources=payload.sources,
        )
        async with aclosing(_with_heartbeats(source)) as lifecycle:
            async for event in lifecycle:
                yield json.dumps(event, separators=(",", ":")) + "\n"

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@router.post("/reindex", response_model=ReindexResponse)
async def brain_reindex(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ReindexResponse:
    result = await reindex_user(db, current_user.id)
    return ReindexResponse(**result)


@router.get("/status", response_model=StatusResponse)
async def brain_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StatusResponse:
    result = await brain_service.status(db, current_user.id)
    return StatusResponse(**result)
