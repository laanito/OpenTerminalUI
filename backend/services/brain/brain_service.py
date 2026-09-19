"""The private second brain: retrieve over the user's writing, then synthesize.

This is the north-star feature — an AI research partner grounded in *your own*
journal, theses, and notes that helps you invest without being fooled (by the
market, by hype, or by yourself). It never invents facts: answers are built only
from retrieved chunks, every claim is cited back to a source, and it says plainly
when your notes don't cover the question.
"""

from __future__ import annotations

import logging
import math
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime, timezone
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
_TEMPORAL_CANDIDATE_MULTIPLIER = 4
_TEMPORAL_MIN_CANDIDATES = 20
_TEMPORAL_RELEVANCE_WINDOW = 0.18
_TEMPORAL_RECENCY_WEIGHT = 0.12
_TEMPORAL_HALF_LIFE_DAYS = 120.0

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
- Treat time as evidence. When excerpts make incompatible claims about the same \
subject, use their EFFECTIVE/UPDATED/RECORDED timestamps to identify the current \
view, explain that the older view was superseded, and cite both. Newer evidence \
does not erase older history and must not override a different subject merely \
because it is recent. If chronology or supersession is ambiguous, say so.
- Plain language. You are a thinking partner, not a financial advisor; don't give \
buy/sell directives."""


def _parse_timestamp(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    elif value:
        try:
            parsed = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _effective_at(match: VectorMatch) -> datetime | None:
    meta = getattr(match.chunk, "meta_json", None) or {}
    for key in ("effective_at", "updated_at", "recorded_at"):
        parsed = _parse_timestamp(meta.get(key))
        if parsed is not None:
            return parsed
    return None


def _temporal_rerank(
    matches: list[VectorMatch],
    *,
    k: int,
    now: datetime | None = None,
) -> list[VectorMatch]:
    """Blend semantic relevance with bounded recency inside a relevant pool.

    Semantic search remains the gate: only candidates close to the best semantic
    match receive a recency bonus. The bounded signal is strong enough to keep a
    slightly less similar current correction beside an older note, but cannot
    promote an unrelated new note over clearly relevant evidence.
    """
    if not matches or k <= 0:
        return []
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    else:
        current = current.astimezone(timezone.utc)

    best_semantic = max(match.score for match in matches)
    semantic_floor = max(0.2, best_semantic - _TEMPORAL_RELEVANCE_WINDOW)

    def rank_score(match: VectorMatch) -> float:
        if match.score < semantic_floor:
            return match.score
        effective_at = _effective_at(match)
        if effective_at is None:
            return match.score
        age_days = max(0.0, (current - effective_at).total_seconds() / 86_400.0)
        recency = math.pow(0.5, age_days / _TEMPORAL_HALF_LIFE_DAYS)
        return match.score + (_TEMPORAL_RECENCY_WEIGHT * recency)

    reranked = sorted(
        matches,
        key=lambda match: (rank_score(match), match.score),
        reverse=True,
    )
    return reranked[:k]


def _format_context(matches: list[VectorMatch]) -> str:
    blocks: list[str] = []
    for i, m in enumerate(matches, start=1):
        meta = getattr(m.chunk, "meta_json", None) or {}
        temporal = " | ".join(
            f"{label} {meta[key]}"
            for key, label in (
                ("effective_at", "EFFECTIVE"),
                ("updated_at", "UPDATED"),
                ("recorded_at", "RECORDED"),
            )
            if meta.get(key)
        )
        heading = f"[{i}] ({m.chunk.source}) {m.chunk.title}"
        if temporal:
            heading += f"\nTIME: {temporal}"
        blocks.append(f"{heading}\n{m.chunk.chunk_text}")
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


@dataclass(frozen=True)
class _SynthesisRequest:
    sources: list[str]
    citations: list[dict[str, Any]]
    messages: list[dict[str, str]]


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
                "effective_at": meta.get("effective_at"),
                "recorded_at": meta.get("recorded_at"),
                "updated_at": meta.get("updated_at"),
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


async def _prepare_ask(
    db: Session,
    user_id: str,
    question: str,
    *,
    k: int = 6,
    sources: list[str] | None = None,
) -> tuple[dict[str, Any] | None, _SynthesisRequest | None]:
    active_sources = _normalize_sources(sources)
    question = (question or "").strip()
    if not question:
        return (
            _with_scope(
                {"answer": "Ask me something about your trades, theses, or notes.", "citations": []},
                active_sources,
            ),
            None,
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
        return (
            _with_scope(
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
            ),
            None,
        )

    try:
        query_vector = await embedder.embed_query(question)
    except EmbeddingError as exc:
        return (
            _with_scope(
                {
                    "answer": f"I couldn't generate an embedding to search your notes: {exc}",
                    "citations": [],
                    "error": "embeddings_unavailable",
                },
                active_sources,
            ),
            None,
        )

    search_sources = None if sources is None else active_sources
    candidate_k = max(k * _TEMPORAL_CANDIDATE_MULTIPLIER, _TEMPORAL_MIN_CANDIDATES)
    candidates = store.search(
        db,
        user_id,
        query_vector,
        k=candidate_k,
        sources=search_sources,
    )
    matches = _temporal_rerank(candidates, k=k)
    if not matches:
        return (
            _with_scope(
                {
                    "answer": "I don't have anything in the selected private sources about that yet.",
                    "citations": [],
                },
                active_sources,
            ),
            None,
        )

    citations = _citations(matches)
    if not settings.llm_enabled:
        # Retrieval still works without a chat model — return the sources directly.
        return (
            _with_scope(
                {
                    "answer": (
                        "The language model is disabled, so here are the most relevant "
                        "excerpts from the selected private sources."
                    ),
                    "citations": citations,
                    "llm": False,
                },
                active_sources,
            ),
            None,
        )

    context = _format_context(matches)
    user_msg = f"CONTEXT:\n{context}\n\nQUESTION: {question}"
    return (
        None,
        _SynthesisRequest(
            sources=active_sources,
            citations=citations,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
        ),
    )


def _llm_unavailable(request: _SynthesisRequest) -> dict[str, Any]:
    return _with_scope(
        {
            "answer": (
                "I found relevant private writing but couldn't reach the language model to "
                "synthesize an answer. Here are the sources."
            ),
            "citations": request.citations,
            "error": "llm_unavailable",
        },
        request.sources,
    )


async def ask(
    db: Session,
    user_id: str,
    question: str,
    *,
    k: int = 6,
    sources: list[str] | None = None,
) -> dict[str, Any]:
    immediate, request = await _prepare_ask(
        db,
        user_id,
        question,
        k=k,
        sources=sources,
    )
    if immediate is not None:
        return immediate
    assert request is not None

    try:
        client = get_llm_client()
        answer = await client.chat(
            request.messages,
            temperature=0.2,
            max_tokens=600,
        )
    except LLMError as exc:
        logger.warning("Brain synthesis failed: %s", exc)
        return _llm_unavailable(request)

    return _with_scope(
        {"answer": answer.strip(), "citations": request.citations, "llm": True},
        request.sources,
    )


async def ask_stream(
    db: Session,
    user_id: str,
    question: str,
    *,
    k: int = 6,
    sources: list[str] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Yield metadata and answer deltas, or one complete fallback result."""
    immediate, request = await _prepare_ask(
        db,
        user_id,
        question,
        k=k,
        sources=sources,
    )
    if immediate is not None:
        yield {"type": "result", "result": immediate}
        return
    assert request is not None

    yield {
        "type": "start",
        "sources": request.sources,
        "citations": request.citations,
        "llm": True,
    }
    emitted = False
    client = get_llm_client()
    try:
        async for text in client.chat_stream(
            request.messages,
            temperature=0.2,
            max_tokens=600,
        ):
            emitted = True
            yield {"type": "delta", "text": text}
        if not emitted:
            raise LLMError("LLM stream returned no answer text")
    except LLMError as stream_exc:
        # OpenAI-compatible providers vary in their streaming support and chunk
        # shapes. A failed/empty stream does not mean ordinary chat completion is
        # unavailable, so replace any partial output with one complete result.
        logger.warning(
            "Brain streaming synthesis unavailable; retrying without streaming: %s",
            stream_exc,
        )
        try:
            answer = await client.chat(
                request.messages,
                temperature=0.2,
                max_tokens=600,
            )
            if not answer.strip():
                raise LLMError("LLM completion returned no answer text")
        except LLMError as completion_exc:
            logger.warning(
                "Brain non-streaming synthesis fallback failed: %s",
                completion_exc,
            )
            yield {"type": "result", "result": _llm_unavailable(request)}
            return
        yield {
            "type": "result",
            "result": _with_scope(
                {
                    "answer": answer.strip(),
                    "citations": request.citations,
                    "llm": True,
                },
                request.sources,
            ),
        }
        return
    yield {"type": "done"}
