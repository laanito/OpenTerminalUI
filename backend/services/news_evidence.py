"""Validated append-only storage boundary, independent of provider/cache lifetimes.

Callers supply exact evidence, not provider settings or arbitrary metadata. No
network calls, implicit scoring, legacy backfill, commits or cleanup occur here.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from typing import Literal
from uuid import uuid4

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.models.news_evidence import NewsSentimentAssessmentORM, NewsTextSnapshotORM


class NewsText(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    schema_version: Literal[1] = 1
    title: str = Field(max_length=16384)
    summary: str = Field(default="", max_length=65536)
    source_url: str = Field(max_length=8192)
    publisher: str = Field(max_length=1024)
    published_at: AwareDatetime | None = None
    retrieved_at: AwareDatetime
    text_scope: Literal["headline_only", "headline_and_summary"]
    truncated: bool = False
    symbols: tuple[str, ...] = Field(default=(), max_length=20)

    @model_validator(mode="after")
    def check_text(self):
        if not self.title.strip() and not self.summary.strip():
            raise ValueError("Evidence must contain text")
        if self.text_scope == "headline_only" and self.summary:
            raise ValueError("Headline-only evidence cannot include a summary")
        if any(not symbol.strip() or len(symbol) > 64 for symbol in self.symbols):
            raise ValueError("Invalid symbol context")
        return self

    @property
    def content_hash(self) -> str:
        # Preserve exact whitespace and boundaries. URL is not text identity.
        encoded = json.dumps([self.title, self.summary], ensure_ascii=False, separators=(",", ":"))
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


class SentimentAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    schema_version: Literal[1] = 1
    target_symbol: str | None = Field(default=None, min_length=1, max_length=64)
    meaning: Literal["text_tone", "asset_implication"]
    method: str = Field(min_length=1, max_length=128)
    method_version: str = Field(min_length=1, max_length=128)
    provider: str | None = Field(default=None, max_length=128)
    model: str | None = Field(default=None, max_length=256)
    prompt_version: str | None = Field(default=None, max_length=128)
    # Exact composed/scoped text supplied to the scorer, including truncation.
    input_text: str = Field(min_length=1, max_length=131072)
    scored_at: AwareDatetime
    status: Literal["complete", "fallback", "failed"]
    score: float | None = Field(default=None, ge=-1, le=1, allow_inf_nan=False)
    label: Literal["bullish", "bearish", "neutral"] | None = None
    rationale: str | None = Field(default=None, max_length=16384)
    confidence: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    confidence_kind: Literal["heuristic", "not_provided"] = "not_provided"
    failure_code: str | None = Field(default=None, min_length=1, max_length=128)

    @model_validator(mode="after")
    def check_result(self):
        if self.meaning == "asset_implication" and not (self.target_symbol or "").strip():
            raise ValueError("Asset implication requires a target symbol")
        if self.status == "failed":
            if not self.failure_code or any(value is not None for value in (self.score, self.label, self.confidence, self.rationale)):
                raise ValueError("Failed assessments require a code and no result")
        elif self.score is None or self.label is None:
            raise ValueError("Completed/fallback assessments require a score and label")
        if self.method == "llm" and not all((self.provider, self.model, self.prompt_version)):
            raise ValueError("LLM assessments require public provider/model/prompt identity")
        if self.status == "complete" and self.failure_code is not None:
            raise ValueError("Completed assessments cannot carry a failure code")
        if self.status == "fallback" and not self.failure_code:
            raise ValueError("Fallback must preserve its reason")
        if (self.confidence is None) != (self.confidence_kind == "not_provided"):
            raise ValueError("Confidence must declare its heuristic meaning")
        return self


def capture_text(db: Session, *, user_id: str, evidence: NewsText) -> NewsTextSnapshotORM:
    row = NewsTextSnapshotORM(
        id=str(uuid4()), user_id=user_id, captured_at=datetime.now(timezone.utc),
        content_hash=evidence.content_hash, payload=evidence.model_dump(mode="json"),
    )
    db.add(row)
    db.flush()
    return row


def get_text(db: Session, *, user_id: str, snapshot_id: str) -> NewsTextSnapshotORM | None:
    return db.scalar(select(NewsTextSnapshotORM).where(
        NewsTextSnapshotORM.id == snapshot_id, NewsTextSnapshotORM.user_id == user_id,
    ))


def append_assessment(db: Session, *, user_id: str, snapshot_id: str, assessment: SentimentAssessment) -> NewsSentimentAssessmentORM:
    if get_text(db, user_id=user_id, snapshot_id=snapshot_id) is None:
        raise LookupError("News snapshot not found")
    row = NewsSentimentAssessmentORM(
        id=str(uuid4()), user_id=user_id, snapshot_id=snapshot_id,
        recorded_at=datetime.now(timezone.utc), payload=assessment.model_dump(mode="json"),
    )
    db.add(row)
    db.flush()
    return row


def get_assessment(db: Session, *, user_id: str, assessment_id: str) -> NewsSentimentAssessmentORM | None:
    return db.scalar(select(NewsSentimentAssessmentORM).where(
        NewsSentimentAssessmentORM.id == assessment_id, NewsSentimentAssessmentORM.user_id == user_id,
    ))
