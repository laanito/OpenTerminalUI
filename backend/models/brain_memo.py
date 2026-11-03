"""Durable, owner-scoped snapshots of completed Second Brain answers.

A memo preserves what the system concluded from a specific evidence set at a
specific time.  The question, answer, citations, and generation metadata are
immutable after creation; only the user's organizational metadata may change.
Memos are deliberately not part of the RAG index.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.shared.db import Base


class BrainMemoORM(Base):
    __tablename__ = "brain_memos"
    __table_args__ = (
        Index("ix_brain_memos_user_pinned_created", "user_id", "pinned", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )

    # Immutable synthesis snapshot.
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text)
    sources: Mapped[list] = mapped_column(JSON, default=list)
    citations: Mapped[list] = mapped_column(JSON, default=list)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    llm: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    llm_provider: Mapped[str | None] = mapped_column(String(128), nullable=True)
    llm_model: Mapped[str | None] = mapped_column(String(256), nullable=True)
    # Nullable for legacy memos. Explicit saves retain transient market evidence
    # as captured; it is never backfilled or automatically added to the RAG index.
    technical_context: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # User-managed organization; editing these fields never rewrites the snapshot.
    title: Mapped[str] = mapped_column(String(256), default="")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    annotation: Mapped[str] = mapped_column(Text, default="")
    symbol: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
