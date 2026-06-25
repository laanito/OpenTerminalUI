"""Gather a user's own writing, embed it, and keep the brain index in sync.

Sources (all per-user, all authored by the user themselves):
  * journal entries — the trade narrative + emotion/strategy/setup/notes
  * portfolio descriptions — the portfolio-level thesis
  * per-holding notes — why this position is held
  * transaction notes — the rationale captured at decision time

Each becomes one chunk. Re-indexing is incremental: unchanged rows (same content
hash) are skipped, and rows whose source record disappeared are pruned.
"""

from __future__ import annotations

import hashlib
import logging
from typing import Any

from sqlalchemy.orm import Session

from backend.models.brain import BrainChunkORM  # noqa: F401 - ensures table registered
from backend.models.core import (
    PortfolioHoldingORM,
    PortfolioORM,
    PortfolioTransactionORM,
)
from backend.models.journal import JournalEntry
from backend.services.brain.vector_store import VectorStore, make_vector_store
from backend.services.embeddings import get_embedding_service
from backend.shared.db import engine

logger = logging.getLogger(__name__)


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _fmt_num(value: Any) -> str:
    if value is None:
        return "?"
    try:
        return f"{float(value):,.2f}"
    except (TypeError, ValueError):
        return str(value)


def _journal_text(row: JournalEntry) -> str:
    parts: list[str] = []
    when = row.entry_date.date().isoformat() if row.entry_date else "?"
    parts.append(f"Trade journal — {row.direction} {row.symbol} entered {when}.")
    if row.exit_date or row.pnl is not None:
        outcome = "win" if (row.pnl or 0) > 0 else "loss" if (row.pnl or 0) < 0 else "flat"
        parts.append(
            f"Outcome: {outcome}, P&L {_fmt_num(row.pnl)} ({_fmt_num(row.pnl_pct)}%)."
        )
    if row.strategy:
        parts.append(f"Strategy: {row.strategy}.")
    if row.setup:
        parts.append(f"Setup: {row.setup}.")
    if row.emotion:
        parts.append(f"Emotion at the time: {row.emotion}.")
    if row.rating is not None:
        parts.append(f"Self-rating: {row.rating}/5.")
    if row.tags:
        parts.append("Tags: " + ", ".join(str(t) for t in row.tags) + ".")
    if row.notes:
        parts.append(f"Notes: {row.notes.strip()}")
    return " ".join(parts)


def _collect_chunks(db: Session, user_id: str) -> list[dict]:
    chunks: list[dict] = []

    # 1. Journal entries — always embed (structured context is meaningful even without notes).
    for row in db.query(JournalEntry).filter(JournalEntry.user_id == user_id).all():
        text = _journal_text(row)
        when = row.entry_date.date().isoformat() if row.entry_date else ""
        chunks.append(
            {
                "source": "journal",
                "ref_id": row.id,
                "symbol": row.symbol,
                "title": f"Journal · {row.direction} {row.symbol} {when}".strip(),
                "chunk_text": text,
                "content_hash": _hash(text),
                "meta_json": {
                    "emotion": row.emotion,
                    "strategy": row.strategy,
                    "setup": row.setup,
                    "pnl": row.pnl,
                    "date": when,
                    "route": "/equity/journal",
                },
            }
        )

    # User's portfolios (the join key for holding/transaction notes below).
    portfolios = db.query(PortfolioORM).filter(PortfolioORM.user_id == user_id).all()
    portfolio_ids = [p.id for p in portfolios]

    # 2. Portfolio theses (description).
    for p in portfolios:
        desc = (p.description or "").strip()
        if not desc:
            continue
        text = f"Portfolio thesis — {p.name}: {desc}"
        chunks.append(
            {
                "source": "portfolio",
                "ref_id": p.id,
                "symbol": None,
                "title": f"Portfolio · {p.name}",
                "chunk_text": text,
                "content_hash": _hash(text),
                "meta_json": {"portfolio": p.name, "route": "/equity/portfolio/lab"},
            }
        )

    if portfolio_ids:
        # 3. Per-holding notes.
        holdings = (
            db.query(PortfolioHoldingORM)
            .filter(PortfolioHoldingORM.portfolio_id.in_(portfolio_ids))
            .all()
        )
        for h in holdings:
            note = (h.notes or "").strip()
            if not note:
                continue
            text = f"Position note — {h.symbol}: {note}"
            chunks.append(
                {
                    "source": "holding",
                    "ref_id": h.id,
                    "symbol": h.symbol,
                    "title": f"Position · {h.symbol}",
                    "chunk_text": text,
                    "content_hash": _hash(text),
                    "meta_json": {"symbol": h.symbol, "route": "/equity/portfolio/lab"},
                }
            )

        # 4. Transaction notes.
        txns = (
            db.query(PortfolioTransactionORM)
            .filter(PortfolioTransactionORM.portfolio_id.in_(portfolio_ids))
            .all()
        )
        for t in txns:
            note = (t.notes or "").strip()
            if not note:
                continue
            text = f"Transaction note — {t.type} {t.symbol} on {t.date}: {note}"
            chunks.append(
                {
                    "source": "transaction",
                    "ref_id": t.id,
                    "symbol": t.symbol,
                    "title": f"Transaction · {t.type} {t.symbol}",
                    "chunk_text": text,
                    "content_hash": _hash(text),
                    "meta_json": {"symbol": t.symbol, "type": t.type, "date": t.date},
                }
            )

    return chunks


async def reindex_user(db: Session, user_id: str) -> dict:
    """(Re)build the brain index for one user. Incremental + prunes stale rows."""
    chunks = _collect_chunks(db, user_id)
    embedder = get_embedding_service()
    store: VectorStore = make_vector_store(engine, embedder.dim)

    keep = {(c["source"], str(c["ref_id"])) for c in chunks}
    removed = store.delete_missing(db, user_id, keep)

    written = 0
    if chunks:
        vectors = await embedder.embed_texts([c["chunk_text"] for c in chunks])
        for chunk, vector in zip(chunks, vectors):
            chunk["vector"] = vector
        written = store.upsert(db, user_id, chunks)

    total = store.count(db, user_id)
    return {
        "indexed": written,
        "removed": removed,
        "total": total,
        "backend": "pgvector" if store.use_pgvector else "numpy",
        "dim": embedder.dim,
        "sources": len(chunks),
    }
