"""Owner-scoped snapshots of fundamentals observed on explicit retrieval."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Index, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.shared.db import Base


class FundamentalCaptureORM(Base):
    __tablename__ = "market_fundamental_captures"
    __table_args__ = (
        Index("ix_fund_captures_owner_symbol_time", "user_id", "symbol", "captured_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    symbol: Mapped[str] = mapped_column(String(64), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    examined_count: Mapped[int] = mapped_column(Integer, nullable=False)
    records: Mapped[list] = mapped_column(JSON, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
