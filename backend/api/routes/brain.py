"""Private second-brain RAG API — ask/reindex/status over the user's own writing.

Mounted under "/api" → /api/brain/*. Authed per-user (never /api/v1, which is
exempt from auth): a user's brain is built only from their own journal, theses,
and notes and never leaves the machine.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.models.user import User
from backend.services.brain import brain_service
from backend.services.brain.indexer import reindex_user

router = APIRouter(prefix="/brain", tags=["brain"])


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    k: int = Field(default=6, ge=1, le=20)


class Citation(BaseModel):
    n: int
    source: str
    title: str
    symbol: str | None = None
    snippet: str
    score: float
    route: str | None = None
    ref_id: str


class AskResponse(BaseModel):
    answer: str
    citations: list[Citation] = []
    indexed_chunks: int | None = None
    llm: bool | None = None
    error: str | None = None


class ReindexResponse(BaseModel):
    indexed: int
    removed: int
    total: int
    backend: str
    dim: int
    sources: int


class StatusResponse(BaseModel):
    indexed_chunks: int
    backend: str
    embed_model: str


@router.post("/ask", response_model=AskResponse)
async def brain_ask(
    payload: AskRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AskResponse:
    result = await brain_service.ask(db, current_user.id, payload.question, k=payload.k)
    return AskResponse(**result)


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
