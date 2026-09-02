"""The private second brain: retrieve over the user's writing, then synthesize.

This is the north-star feature — an AI research partner grounded in *your own*
journal, theses, and notes that helps you invest without being fooled (by the
market, by hype, or by yourself). It never invents facts: answers are built only
from retrieved chunks, every claim is cited back to a source, and it says plainly
when your notes don't cover the question.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from backend.config.settings import get_settings
from backend.services.brain.indexer import reindex_user
from backend.services.brain.vector_store import VectorMatch, make_vector_store
from backend.services.embeddings import EmbeddingError, get_embedding_service
from backend.services.llm_client import LLMError, get_llm_client
from backend.shared.db import engine

logger = logging.getLogger(__name__)

BRAIN_SOURCES = ("note", "journal", "portfolio", "holding", "transaction")
_BRAIN_SOURCE_SET = frozenset(BRAIN_SOURCES)

SYSTEM_PROMPT = """You are the user's private "second brain" — a research partner \
that helps them invest without being fooled by markets, by hype, or by themselves.

You will be given CONTEXT: numbered excerpts from the user's OWN trading journal, \
portfolio theses, and position notes. Answer the QUESTION using ONLY that context.

Rules:
- Ground every claim in the context. Cite sources inline like [1], [2] using the \
numbers provided.
- If the context doesn't contain enough to answer, say so plainly and suggest what \
the user could journal to close the gap. Never invent trades, numbers, or notes.
- Be concise and concrete. Surface patterns the user might be blind to (recurring \
emotions, setups that lose money, theses that drifted) — act as a check against \
their own biases, not a cheerleader.
- Plain language. You are a thinking partner, not a financial advisor; don't give \
buy/sell directives."""


def _format_context(matches: list[VectorMatch]) -> str:
    blocks: list[str] = []
    for i, m in enumerate(matches, start=1):
        blocks.append(f"[{i}] ({m.chunk.source}) {m.chunk.title}\n{m.chunk.chunk_text}")
    return "\n\n".join(blocks)


def _normalize_sources(sources: list[str] | None) -> list[str]:
    """Validate, deduplicate, and stabilize a requested private-source scope."""
    if sources is None:
        return list(BRAIN_SOURCES)
    normalized = list(dict.fromkeys(str(source).strip().lower() for source in sources))
    if not normalized:
        raise ValueError("At least one brain source is required")
    invalid = [source for source in normalized if source not in _BRAIN_SOURCE_SET]
    if invalid:
        raise ValueError(f"Unknown brain sources: {', '.join(invalid)}")
    return normalized


def _with_scope(payload: dict[str, Any], sources: list[str]) -> dict[str, Any]:
    return {**payload, "sources": sources}


def _citations(matches: list[VectorMatch]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i, m in enumerate(matches, start=1):
        meta = getattr(m.chunk, "meta_json", None) or {}
        snippet = m.chunk.chunk_text
        out.append(
            {
                "n": i,
                "source": m.chunk.source,
                "title": m.chunk.title,
                "symbol": m.chunk.symbol,
                "snippet": snippet[:280] + ("…" if len(snippet) > 280 else ""),
                "score": round(m.score, 4),
                "route": meta.get("route"),
                # Chunk rows use an internal deterministic key. Citations keep the
                # original record ID so existing deep links/API consumers remain
                # stable across the v1.3 reindex.
                "ref_id": str(meta.get("source_ref_id", m.chunk.ref_id)),
                "chunk_index": meta.get("chunk_index"),
            }
        )
    return out


async def related_notes(
    db: Session,
    user_id: str,
    query_text: str,
    *,
    exclude_symbol: str | None = None,
    k: int = 4,
    min_score: float = 0.2,
) -> list[dict[str, Any]]:
    """Semantically retrieve the user's OWN notes related to a query.

    Used to ground an adversarial read (the "interrogate this stock" card) in the
    user's *broader* thinking — notes on other tickers or themes that echo the
    thesis under scrutiny, not just the same-ticker notes. Same-ticker notes are
    folded in directly by the caller, so ``exclude_symbol`` drops them here to keep
    "related" meaning "elsewhere in your writing".

    Best-effort and never raises: an empty brain, a disabled/unreachable embedder,
    or a pgvector hiccup all degrade to an empty list, so callers can treat related
    notes as a bonus on top of the precise same-ticker match. ``min_score`` is a
    gentle cosine floor that drops clearly-unrelated notes when the user has only a
    handful indexed.
    """
    query_text = (query_text or "").strip()
    if not query_text:
        return []

    embedder = get_embedding_service()
    store = make_vector_store(engine, embedder.dim)
    if store.count(db, user_id) == 0:
        return []

    try:
        query_vector = await embedder.embed_query(query_text)
    except EmbeddingError as exc:
        logger.info("related_notes: embeddings unavailable (%s); skipping.", exc)
        return []

    exclude = (exclude_symbol or "").strip().upper() or None
    # Over-fetch so the symbol/score filtering below still yields up to k.
    matches = store.search(db, user_id, query_vector, k=k + 8, sources=["note"])
    out: list[dict[str, Any]] = []
    for m in matches:
        if m.score < min_score:
            continue
        sym = (m.chunk.symbol or "").strip().upper() or None
        if exclude and sym == exclude:
            continue  # same-ticker notes are the caller's direct grounding, not "related"
        out.append(
            {
                "symbol": sym,
                "title": m.chunk.title,
                "text": m.chunk.chunk_text,
                "score": round(m.score, 4),
            }
        )
        if len(out) >= k:
            break
    return out


async def status(db: Session, user_id: str) -> dict[str, Any]:
    embedder = get_embedding_service()
    store = make_vector_store(engine, embedder.dim)
    counts = store.count_by_source(db, user_id)
    return {
        "indexed_chunks": store.count(db, user_id),
        "source_counts": {source: counts.get(source, 0) for source in BRAIN_SOURCES},
        "backend": "pgvector" if store.use_pgvector else "numpy",
        "embed_model": get_settings().llm_embed_model,
    }


async def ask(
    db: Session,
    user_id: str,
    question: str,
    *,
    k: int = 6,
    sources: list[str] | None = None,
) -> dict[str, Any]:
    active_sources = _normalize_sources(sources)
    question = (question or "").strip()
    if not question:
        return _with_scope(
            {"answer": "Ask me something about your trades, theses, or notes.", "citations": []},
            active_sources,
        )

    settings = get_settings()
    embedder = get_embedding_service()
    store = make_vector_store(engine, embedder.dim)

    # Seamless first use: if nothing is indexed yet, build the index on the fly.
    if store.count(db, user_id) == 0:
        try:
            await reindex_user(db, user_id)
        except (EmbeddingError, LLMError) as exc:
            logger.warning("Auto-index failed: %s", exc)

    if store.count(db, user_id) == 0:
        return _with_scope(
            {
                "answer": (
                    "Your second brain is empty. Add some trade journal entries, a "
                    "portfolio thesis, or position notes, then ask again — I only ever "
                    "answer from your own writing."
                ),
                "citations": [],
                "indexed_chunks": 0,
            },
            active_sources,
        )

    try:
        query_vector = await embedder.embed_query(question)
    except EmbeddingError as exc:
        return _with_scope(
            {
                "answer": f"I couldn't generate an embedding to search your notes: {exc}",
                "citations": [],
                "error": "embeddings_unavailable",
            },
            active_sources,
        )

    search_sources = None if sources is None else active_sources
    matches = store.search(db, user_id, query_vector, k=k, sources=search_sources)
    if not matches:
        return _with_scope(
            {
                "answer": "I don't have anything in the selected private sources about that yet.",
                "citations": [],
            },
            active_sources,
        )

    if not settings.llm_enabled:
        # Retrieval still works without a chat model — return the sources directly.
        return _with_scope(
            {
                "answer": (
                    "The language model is disabled, so here are the most relevant "
                    "excerpts from the selected private sources."
                ),
                "citations": _citations(matches),
                "llm": False,
            },
            active_sources,
        )

    context = _format_context(matches)
    user_msg = f"CONTEXT:\n{context}\n\nQUESTION: {question}"
    try:
        client = get_llm_client()
        answer = await client.chat(
            [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.2,
            max_tokens=600,
        )
    except LLMError as exc:
        logger.warning("Brain synthesis failed: %s", exc)
        return _with_scope(
            {
                "answer": (
                    "I found relevant private writing but couldn't reach the language model to "
                    "synthesize an answer. Here are the sources."
                ),
                "citations": _citations(matches),
                "error": "llm_unavailable",
            },
            active_sources,
        )

    return _with_scope(
        {"answer": answer.strip(), "citations": _citations(matches), "llm": True},
        active_sources,
    )
