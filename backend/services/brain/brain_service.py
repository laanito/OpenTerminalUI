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


def _citations(matches: list[VectorMatch]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i, m in enumerate(matches, start=1):
        meta = m.chunk.meta_json or {}
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
                "ref_id": m.chunk.ref_id,
            }
        )
    return out


async def status(db: Session, user_id: str) -> dict[str, Any]:
    embedder = get_embedding_service()
    store = make_vector_store(engine, embedder.dim)
    return {
        "indexed_chunks": store.count(db, user_id),
        "backend": "pgvector" if store.use_pgvector else "numpy",
        "embed_model": get_settings().llm_embed_model,
    }


async def ask(db: Session, user_id: str, question: str, *, k: int = 6) -> dict[str, Any]:
    question = (question or "").strip()
    if not question:
        return {"answer": "Ask me something about your trades, theses, or notes.", "citations": []}

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
        return {
            "answer": (
                "Your second brain is empty. Add some trade journal entries, a "
                "portfolio thesis, or position notes, then ask again — I only ever "
                "answer from your own writing."
            ),
            "citations": [],
            "indexed_chunks": 0,
        }

    try:
        query_vector = await embedder.embed_query(question)
    except EmbeddingError as exc:
        return {
            "answer": f"I couldn't generate an embedding to search your notes: {exc}",
            "citations": [],
            "error": "embeddings_unavailable",
        }

    matches = store.search(db, user_id, query_vector, k=k)
    if not matches:
        return {
            "answer": "I don't have anything in your notes about that yet.",
            "citations": [],
        }

    if not settings.llm_enabled:
        # Retrieval still works without a chat model — return the sources directly.
        return {
            "answer": (
                "The language model is disabled, so here are the most relevant "
                "excerpts from your own notes."
            ),
            "citations": _citations(matches),
            "llm": False,
        }

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
        return {
            "answer": (
                "I found relevant notes but couldn't reach the language model to "
                "synthesize an answer. Here are the sources."
            ),
            "citations": _citations(matches),
            "error": "llm_unavailable",
        }

    return {"answer": answer.strip(), "citations": _citations(matches), "llm": True}
