"""Owner-scoped persistence for explicit Second Brain research memos.

Completed answers stay transient until the user saves one.  Saving captures an
immutable synthesis and citation snapshot; PATCH only changes organization
metadata.  Memos are not indexed as evidence by this router.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.auth.deps import get_current_user
from backend.models.brain_memo import BrainMemoORM
from backend.services.brain.technical_context import BrainTechnicalContext, InvalidBrainTechnicalReferences, validate_brain_technical_references
from backend.models.notes import NoteORM
from backend.models.user import User
from backend.api.routes.notes import NoteOut, _reindex_user_brain, _serialize as serialize_note
from backend.services.brain.indexer import _collect_chunks

router = APIRouter(prefix="/brain/memos", tags=["brain"])

BrainSource = Literal["note", "journal", "portfolio", "holding", "transaction"]


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("generated_at must include a timezone")
    return value.astimezone(timezone.utc)


def _isoformat_utc(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None or value.utcoffset() is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat()


def _symbol(value: str | None) -> str | None:
    normalized = (value or "").strip().upper()
    return normalized or None


def _tags(values: list[str] | None) -> list[str]:
    normalized: list[str] = []
    for raw in values or []:
        value = str(raw or "").strip()
        if value and value not in normalized:
            normalized.append(value)
    return normalized


class CitationSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    n: int = Field(ge=1)
    source: BrainSource
    title: str = Field(max_length=256)
    symbol: str | None = Field(default=None, max_length=64)
    snippet: str = Field(max_length=2000)
    score: float = Field(ge=-1, le=1)
    effective_at: str | None = None
    recorded_at: str | None = None
    updated_at: str | None = None
    route: str | None = Field(default=None, max_length=512)
    ref_id: str = Field(min_length=1, max_length=64)
    chunk_index: int | None = Field(default=None, ge=0)
    content_hash: str | None = Field(default=None, max_length=64)


class BrainMemoCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=2000)
    answer: str = Field(min_length=1, max_length=100000)
    sources: list[BrainSource] = Field(min_length=1, max_length=5)
    citations: list[CitationSnapshot] = Field(default_factory=list, max_length=20)
    generated_at: datetime
    llm: bool | None = None
    llm_provider: str | None = Field(default=None, max_length=128)
    llm_model: str | None = Field(default=None, max_length=256)
    technical_context: BrainTechnicalContext | None = None
    title: str = Field(default="", max_length=256)
    tags: list[str] = Field(default_factory=list, max_length=32)
    annotation: str = Field(default="", max_length=10000)
    symbol: str | None = Field(default=None, max_length=64)
    pinned: bool = False

    @field_validator("question", "answer")
    @classmethod
    def require_visible_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("must contain visible text")
        return normalized

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, values: list[str]) -> list[str]:
        normalized = _tags(values)
        if any(len(value) > 64 for value in normalized):
            raise ValueError("tags must be at most 64 characters")
        return normalized

    @field_validator("generated_at")
    @classmethod
    def require_generation_timezone(cls, value: datetime) -> datetime:
        return _utc(value)

    @field_validator("sources")
    @classmethod
    def unique_sources(cls, values: list[BrainSource]) -> list[BrainSource]:
        return list(dict.fromkeys(values))

    @model_validator(mode="after")
    def keep_technical_references_resolvable(self):
        if self.technical_context is not None and self.llm:
            try:
                validate_brain_technical_references(self.answer, self.technical_context,
                    [citation.model_dump() for citation in self.citations])
            except InvalidBrainTechnicalReferences as exc:
                raise ValueError("Saved answer must use the supplied private and technical references") from exc
        return self


class BrainMemoUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=256)
    tags: list[str] | None = Field(default=None, max_length=32)
    annotation: str | None = Field(default=None, max_length=10000)
    symbol: str | None = Field(default=None, max_length=64)
    pinned: bool | None = None

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        normalized = _tags(values)
        if any(len(value) > 64 for value in normalized):
            raise ValueError("tags must be at most 64 characters")
        return normalized


class BrainMemoPromoteNote(BaseModel):
    """User-reviewed copy, never a silent transcription of model output."""

    title: str = Field(default="", max_length=256)
    body: str = Field(min_length=1, max_length=10000)
    symbol: str | None = Field(default=None, max_length=64)
    tags: list[str] = Field(default_factory=list, max_length=32)
    effective_at: datetime | None = None

    @field_validator("body")
    @classmethod
    def require_reviewed_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("body must contain visible text")
        return normalized

    @field_validator("tags")
    @classmethod
    def normalize_tags(cls, values: list[str]) -> list[str]:
        normalized = _tags(values)
        if any(len(value) > 64 for value in normalized):
            raise ValueError("tags must be at most 64 characters")
        return normalized

    @field_validator("effective_at")
    @classmethod
    def require_effective_timezone(cls, value: datetime | None) -> datetime | None:
        return _utc(value) if value is not None else None


class BrainMemoSummary(BaseModel):
    id: str
    title: str
    question: str
    answer_preview: str
    symbol: str | None
    tags: list[str]
    annotation: str
    pinned: bool
    citation_count: int
    generated_at: str
    created_at: str
    updated_at: str


class BrainMemoOut(BrainMemoSummary):
    answer: str
    sources: list[BrainSource]
    citations: list[CitationSnapshot]
    llm: bool | None
    llm_provider: str | None
    llm_model: str | None
    technical_context: BrainTechnicalContext | None = None


class CitationEvidenceStatus(BaseModel):
    n: int
    status: Literal["current", "changed", "unavailable", "unverifiable"]


class BrainMemoEvidenceStatus(BaseModel):
    status: Literal["current", "stale", "unverifiable"]
    checked_at: str
    citations: list[CitationEvidenceStatus]


def _owned_memo(db: Session, memo_id: str, user_id: str) -> BrainMemoORM:
    row = (
        db.query(BrainMemoORM)
        .filter(BrainMemoORM.id == memo_id, BrainMemoORM.user_id == user_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Brain memo not found")
    return row


def _summary(row: BrainMemoORM) -> BrainMemoSummary:
    answer = row.answer.strip()
    return BrainMemoSummary(
        id=row.id,
        title=row.title,
        question=row.question,
        answer_preview=answer[:280] + ("…" if len(answer) > 280 else ""),
        symbol=row.symbol,
        tags=list(row.tags or []),
        annotation=row.annotation,
        pinned=bool(row.pinned),
        citation_count=len(row.citations or []),
        generated_at=_isoformat_utc(row.generated_at) or "",
        created_at=_isoformat_utc(row.created_at) or "",
        updated_at=_isoformat_utc(row.updated_at) or "",
    )


def _full(row: BrainMemoORM) -> BrainMemoOut:
    summary = _summary(row)
    return BrainMemoOut(
        **summary.model_dump(),
        answer=row.answer,
        sources=list(row.sources or []),
        citations=[CitationSnapshot.model_validate(item) for item in row.citations or []],
        llm=row.llm,
        llm_provider=row.llm_provider,
        llm_model=row.llm_model,
        technical_context=row.technical_context,
    )


@router.get("", response_model=list[BrainMemoSummary])
def list_brain_memos(
    symbol: str | None = Query(default=None),
    pinned: bool | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[BrainMemoSummary]:
    query = db.query(BrainMemoORM).filter(BrainMemoORM.user_id == current_user.id)
    normalized_symbol = _symbol(symbol)
    if normalized_symbol:
        query = query.filter(BrainMemoORM.symbol == normalized_symbol)
    if pinned is not None:
        query = query.filter(BrainMemoORM.pinned.is_(pinned))
    rows = (
        query.order_by(BrainMemoORM.pinned.desc(), BrainMemoORM.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [_summary(row) for row in rows]


@router.post("", response_model=BrainMemoOut, status_code=201)
def create_brain_memo(
    payload: BrainMemoCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BrainMemoOut:
    question = payload.question
    title = payload.title.strip() or question[:256]
    row = BrainMemoORM(
        user_id=current_user.id,
        question=question,
        answer=payload.answer,
        sources=list(payload.sources),
        citations=[citation.model_dump(mode="json") for citation in payload.citations],
        generated_at=payload.generated_at,
        llm=payload.llm,
        llm_provider=(payload.llm_provider or "").strip() or None,
        llm_model=(payload.llm_model or "").strip() or None,
        technical_context=payload.technical_context.model_dump(mode="json") if payload.technical_context is not None else None,
        title=title,
        tags=payload.tags,
        annotation=payload.annotation.strip(),
        symbol=_symbol(payload.symbol),
        pinned=payload.pinned,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _full(row)


@router.get("/{memo_id}", response_model=BrainMemoOut)
def get_brain_memo(
    memo_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BrainMemoOut:
    return _full(_owned_memo(db, memo_id, current_user.id))


@router.get("/{memo_id}/evidence-status", response_model=BrainMemoEvidenceStatus)
def get_brain_memo_evidence_status(
    memo_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BrainMemoEvidenceStatus:
    """Compare the dated citation snapshot with live owner-scoped records.

    This deliberately does not trust the embedding index, which may still be
    awaiting reindex after a source edit, and never rewrites the saved memo.
    A hash change means evidence *identity* changed, not that a claim was
    disproven; callers should review the current source before reuse.
    """
    memo = _owned_memo(db, memo_id, current_user.id)
    citations = [CitationSnapshot.model_validate(item) for item in memo.citations or []]
    source_refs: dict[str, set[str]] = {}
    for citation in citations:
        if citation.content_hash and citation.chunk_index is not None:
            source_refs.setdefault(citation.source, set()).add(citation.ref_id)
    live_chunks = _collect_chunks(db, current_user.id, source_refs=source_refs)
    live_hashes = {
        (chunk["source"], chunk["meta_json"]["source_ref_id"], chunk["meta_json"]["chunk_index"]):
        chunk["content_hash"]
        for chunk in live_chunks
    }

    results: list[CitationEvidenceStatus] = []
    for citation in citations:
        if not citation.content_hash or citation.chunk_index is None:
            status = "unverifiable"
        else:
            current_hash = live_hashes.get((citation.source, citation.ref_id, citation.chunk_index))
            status = (
                "unavailable" if current_hash is None else
                "current" if current_hash == citation.content_hash else "changed"
            )
        results.append(CitationEvidenceStatus(n=citation.n, status=status))

    if any(item.status in ("changed", "unavailable") for item in results):
        overall = "stale"
    elif results and all(item.status == "current" for item in results):
        overall = "current"
    else:
        overall = "unverifiable"
    return BrainMemoEvidenceStatus(
        status=overall,
        checked_at=datetime.now(timezone.utc).isoformat(),
        citations=results,
    )


@router.post("/{memo_id}/promote-to-note", response_model=NoteOut, status_code=201)
def promote_brain_memo_to_note(
    memo_id: str,
    payload: BrainMemoPromoteNote,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> NoteOut:
    memo = _owned_memo(db, memo_id, current_user.id)
    note = NoteORM(
        user_id=current_user.id,
        context="brain_memo",
        ref_id=memo.id,
        title=payload.title.strip(),
        body=payload.body,
        symbol=_symbol(payload.symbol),
        tags=payload.tags,
        effective_at=payload.effective_at or memo.generated_at,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    background.add_task(_reindex_user_brain, current_user.id)
    return serialize_note(note)


@router.patch("/{memo_id}", response_model=BrainMemoOut)
def update_brain_memo(
    memo_id: str,
    payload: BrainMemoUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BrainMemoOut:
    row = _owned_memo(db, memo_id, current_user.id)
    if payload.title is not None:
        row.title = payload.title.strip() or row.question[:256]
    if payload.tags is not None:
        row.tags = payload.tags
    if payload.annotation is not None:
        row.annotation = payload.annotation.strip()
    if "symbol" in payload.model_fields_set:
        row.symbol = _symbol(payload.symbol)
    if payload.pinned is not None:
        row.pinned = payload.pinned
    db.commit()
    db.refresh(row)
    return _full(row)


@router.delete("/{memo_id}", status_code=204)
def delete_brain_memo(
    memo_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    row = _owned_memo(db, memo_id, current_user.id)
    db.delete(row)
    db.commit()
