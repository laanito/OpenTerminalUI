"""Storage for the private "second brain" RAG index.

Each row is one embedded chunk of the user's own writing — a journal entry, a
portfolio thesis, a per-holding note, a transaction memo. The embedding is stored
as portable JSON (``vector_json``) so the index works on SQLite as well as
Postgres; on Postgres a real ``pgvector`` column + ANN index is layered on top by
the vector store. Everything is scoped by ``user_id`` and never leaves the
machine.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from backend.shared.db import Base


class BrainChunkORM(Base):
    __tablename__ = "brain_chunks"
    __table_args__ = (
        # One row per source record; re-indexing upserts in place.
        UniqueConstraint("user_id", "source", "ref_id", name="uq_brain_chunk_user_source_ref"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # journal | portfolio | holding | transaction
    source: Mapped[str] = mapped_column(String(32), index=True)
    ref_id: Mapped[str] = mapped_column(String(64), index=True)
    symbol: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(256), default="")
    chunk_text: Mapped[str] = mapped_column(Text, default="")
    meta_json: Mapped[dict] = mapped_column(JSON, default=dict)
    content_hash: Mapped[str] = mapped_column(String(64), index=True, default="")
    dim: Mapped[int] = mapped_column(Integer, default=0)
    vector_json: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc)
    )
