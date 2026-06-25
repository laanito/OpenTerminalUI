"""Dialect-aware vector store for the second-brain index.

Two retrieval paths behind one interface, chosen at runtime by the DB dialect:

* **pgvector** (default on Postgres) — a real ``vector`` column with an ``ivfflat``
  cosine index, queried with the ``<=>`` distance operator. Scales to large
  indexes and uses an ANN index.
* **numpy cosine fallback** (SQLite, or Postgres without the ``pgvector``
  extension) — loads the user's chunks and ranks them with an in-process cosine
  similarity. Zero extra infrastructure and plenty fast for one person's journal
  and notes (hundreds–low-thousands of chunks).

Both paths persist the canonical embedding as portable JSON on
:class:`BrainChunkORM`, so the index survives a dialect change. The pgvector path
additionally mirrors the vector into its native column; if anything pgvector
specific fails (extension missing, dimension drift after a model swap) it falls
back to the numpy path rather than erroring.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from backend.models.brain import BrainChunkORM

logger = logging.getLogger(__name__)


@dataclass
class VectorMatch:
    chunk: BrainChunkORM
    score: float  # cosine similarity in [-1, 1]; higher is closer


def _cosine_topk(
    query: list[float], rows: list[BrainChunkORM], k: int
) -> list[VectorMatch]:
    """Rank ``rows`` by cosine similarity to ``query`` using numpy."""
    import numpy as np

    q = np.asarray(query, dtype=np.float32)
    q_norm = float(np.linalg.norm(q))
    if q_norm == 0.0:
        return []
    q = q / q_norm

    scored: list[VectorMatch] = []
    for row in rows:
        vec = row.vector_json or []
        if not vec or len(vec) != q.shape[0]:
            continue  # dimension drift (model changed) — skip until re-indexed
        v = np.asarray(vec, dtype=np.float32)
        v_norm = float(np.linalg.norm(v))
        if v_norm == 0.0:
            continue
        score = float(np.dot(q, v / v_norm))
        scored.append(VectorMatch(chunk=row, score=score))

    scored.sort(key=lambda m: m.score, reverse=True)
    return scored[:k]


class VectorStore:
    """Persists embeddings and retrieves nearest chunks for a user."""

    def __init__(self, *, use_pgvector: bool) -> None:
        self.use_pgvector = use_pgvector

    # ---- persistence -----------------------------------------------------

    def upsert(self, db: Session, user_id: str, chunks: list[dict]) -> int:
        """Insert or update one row per (source, ref_id). Returns rows written."""
        written = 0
        for chunk in chunks:
            row = (
                db.query(BrainChunkORM)
                .filter(
                    BrainChunkORM.user_id == user_id,
                    BrainChunkORM.source == chunk["source"],
                    BrainChunkORM.ref_id == str(chunk["ref_id"]),
                )
                .first()
            )
            vector = chunk["vector"]
            fields = dict(
                symbol=chunk.get("symbol"),
                title=chunk.get("title", ""),
                chunk_text=chunk.get("chunk_text", ""),
                meta_json=chunk.get("meta_json", {}),
                content_hash=chunk.get("content_hash", ""),
                dim=len(vector),
                vector_json=vector,
            )
            if row is None:
                row = BrainChunkORM(
                    user_id=user_id,
                    source=chunk["source"],
                    ref_id=str(chunk["ref_id"]),
                    **fields,
                )
                db.add(row)
            elif row.content_hash == chunk.get("content_hash") and row.dim == len(vector):
                continue  # unchanged — skip the write entirely
            else:
                for key, value in fields.items():
                    setattr(row, key, value)
            written += 1
        db.commit()

        if self.use_pgvector and written:
            self._sync_pgvector(db, user_id)
        return written

    def delete_missing(self, db: Session, user_id: str, keep: set[tuple[str, str]]) -> int:
        """Drop rows whose (source, ref_id) is no longer present in the sources."""
        rows = db.query(BrainChunkORM).filter(BrainChunkORM.user_id == user_id).all()
        removed = 0
        for row in rows:
            if (row.source, row.ref_id) not in keep:
                db.delete(row)
                removed += 1
        if removed:
            db.commit()
            if self.use_pgvector:
                self._sync_pgvector(db, user_id)
        return removed

    def count(self, db: Session, user_id: str) -> int:
        return db.query(BrainChunkORM).filter(BrainChunkORM.user_id == user_id).count()

    # ---- retrieval -------------------------------------------------------

    def search(
        self,
        db: Session,
        user_id: str,
        query_vector: list[float],
        *,
        k: int = 6,
        sources: list[str] | None = None,
    ) -> list[VectorMatch]:
        if not query_vector:
            return []
        if self.use_pgvector:
            try:
                return self._search_pgvector(db, user_id, query_vector, k, sources)
            except Exception as exc:  # noqa: BLE001 - degrade to numpy, never fail the query
                logger.warning("pgvector search failed (%s); using numpy fallback.", exc)
        return self._search_numpy(db, user_id, query_vector, k, sources)

    def _search_numpy(
        self, db: Session, user_id: str, query_vector: list[float], k: int, sources: list[str] | None
    ) -> list[VectorMatch]:
        q = db.query(BrainChunkORM).filter(BrainChunkORM.user_id == user_id)
        if sources:
            q = q.filter(BrainChunkORM.source.in_(sources))
        return _cosine_topk(query_vector, q.all(), k)

    # ---- pgvector internals ---------------------------------------------

    def _vector_literal(self, vector: list[float]) -> str:
        return "[" + ",".join(repr(float(x)) for x in vector) + "]"

    def _sync_pgvector(self, db: Session, user_id: str) -> None:
        """Mirror vector_json into the native pgvector column for a user's rows."""
        try:
            rows = db.query(BrainChunkORM).filter(BrainChunkORM.user_id == user_id).all()
            for row in rows:
                if not row.vector_json:
                    continue
                db.execute(
                    text("UPDATE brain_chunks SET embedding = :v WHERE id = :id"),
                    {"v": self._vector_literal(row.vector_json), "id": row.id},
                )
            db.commit()
        except Exception as exc:  # noqa: BLE001 - search still works via numpy
            db.rollback()
            logger.warning("pgvector column sync failed (%s); numpy search will be used.", exc)

    def _search_pgvector(
        self, db: Session, user_id: str, query_vector: list[float], k: int, sources: list[str] | None
    ) -> list[VectorMatch]:
        params = {"q": self._vector_literal(query_vector), "uid": user_id, "k": k}
        source_clause = ""
        if sources:
            source_clause = " AND source IN :sources"
            params["sources"] = tuple(sources)
        sql = text(
            "SELECT id, (1 - (embedding <=> :q)) AS score "
            "FROM brain_chunks "
            "WHERE user_id = :uid AND embedding IS NOT NULL" + source_clause + " "
            "ORDER BY embedding <=> :q LIMIT :k"
        )
        if sources:
            sql = sql.bindparams(bindparam("sources", expanding=True))
        result = db.execute(sql, params).fetchall()
        if not result:
            return []
        id_to_score = {r[0]: float(r[1]) for r in result}
        rows = (
            db.query(BrainChunkORM)
            .filter(BrainChunkORM.id.in_(list(id_to_score.keys())))
            .all()
        )
        matches = [VectorMatch(chunk=row, score=id_to_score.get(row.id, 0.0)) for row in rows]
        matches.sort(key=lambda m: m.score, reverse=True)
        return matches


def _pgvector_ready(engine, dim: int) -> bool:
    """Enable the pgvector extension + ensure the embedding column/index exist.

    Runs idempotent DDL (CREATE EXTENSION / ADD COLUMN / CREATE INDEX). The
    ALTER/CREATE INDEX take heavy table locks, so a short ``lock_timeout`` makes
    this fail fast to the numpy fallback rather than block behind another
    transaction. Must only be called once per process (see make_vector_store).
    """
    if engine.dialect.name != "postgresql":
        return False
    try:
        with engine.begin() as conn:
            # Fail fast instead of queueing behind a conflicting lock for minutes.
            conn.execute(text("SET LOCAL lock_timeout = '5s'"))
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            conn.execute(
                text(f"ALTER TABLE brain_chunks ADD COLUMN IF NOT EXISTS embedding vector({dim})")
            )
            conn.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_brain_chunks_embedding "
                    "ON brain_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
                )
            )
        return True
    except Exception as exc:  # noqa: BLE001 - no pgvector / lock contention → numpy fallback
        logger.info("pgvector unavailable (%s); second brain will use numpy cosine.", exc)
        return False


# The pgvector setup runs idempotent DDL with table-level locks, so it must run
# ONCE per process — not on every request. Memoize the store per (dialect, dim)
# and serialize first-init so concurrent brain requests can't issue overlapping
# ALTER/CREATE INDEX (which deadlock each other on ACCESS EXCLUSIVE).
_store_cache: dict[tuple[str, int], VectorStore] = {}
_store_lock = threading.Lock()


def make_vector_store(engine, dim: int) -> VectorStore:
    """Build (once) the right store for the active DB, preferring pgvector on Postgres."""
    key = (engine.dialect.name, int(dim))
    cached = _store_cache.get(key)
    if cached is not None:
        return cached
    with _store_lock:
        cached = _store_cache.get(key)
        if cached is not None:
            return cached
        store = VectorStore(use_pgvector=_pgvector_ready(engine, dim))
        _store_cache[key] = store
        return store
