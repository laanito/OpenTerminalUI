"""Generic per-user notes — the frictionless capture layer for the second brain.

One model for jotting a thought *anywhere*: on a stock you're researching, a
watchlist name you're tracking, a news article you're reacting to, a position you
hold, or nothing in particular. The second brain indexes these so "write a thought
→ the brain remembers it" is a one-step loop, instead of requiring a full journal
trade. ``symbol`` is optional (a note can be general), ``context`` records where it
was captured, and ``ref_id`` optionally links back to the source object.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from backend.shared.db import Base

# Where a note was captured. "general" = standalone (the Notes hub).
NOTE_CONTEXTS = ("general", "security", "watchlist", "news", "holding", "transaction")


class NoteORM(Base):
    __tablename__ = "notes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    symbol: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    context: Mapped[str] = mapped_column(String(32), default="general", index=True)
    # Optional link back to the source object (e.g. news article id, holding id).
    ref_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    title: Mapped[str] = mapped_column(String(256), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
