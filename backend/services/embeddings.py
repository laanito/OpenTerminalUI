"""Embedding service for the private "second brain" RAG.

Mirrors the graceful-degradation philosophy of the sentiment engine
(:mod:`backend.services.sentiment_engine`): a provider-agnostic primary with a
local fallback.

Tier 1 — **OpenAI-compatible ``/embeddings``** via :class:`LLMClient`. This is the
default and works with the same endpoint that already serves chat: Ollama
(``nomic-embed-text``), OpenAI (``text-embedding-3-*``), vLLM, LM Studio, etc.
Keeps everything local/private when pointed at Ollama.

Tier 2 — **local ``sentence-transformers``** (optional, ``requirements-ml.txt``).
Used only when the configured endpoint has no embeddings route (or embeddings are
otherwise unreachable) and ``brain_embed_fallback`` is on. Fully offline, no
external service required, at the cost of a torch dependency.

The service is the source of truth for the active vector dimension — the vector
store sizes its column from whatever the live embedder actually produces, so
swapping models (768-dim nomic vs 384-dim MiniLM) just works after a reindex.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from backend.config.settings import get_settings
from backend.services.llm_client import LLMError, get_llm_client

logger = logging.getLogger(__name__)

# Local fallback model — small, fast, CPU-friendly (384-dim).
_FALLBACK_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"


class EmbeddingError(RuntimeError):
    """Raised when no embedding backend could produce vectors."""


class EmbeddingService:
    """Embed text via an OpenAI-compatible endpoint, falling back to a local model."""

    def __init__(self) -> None:
        self._settings = get_settings()
        self._dim: int | None = None
        self._st_model: Any | None = None  # lazily loaded sentence-transformers model
        self._endpoint_ok: bool | None = None  # None = untried, True/False = last result

    @property
    def dim(self) -> int:
        """Active vector dimension (configured default until the first embed call)."""
        return self._dim or int(self._settings.brain_embed_dim)

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of texts, in order. Empty input → empty output."""
        cleaned = [t if isinstance(t, str) else str(t or "") for t in texts]
        if not cleaned:
            return []

        # Tier 1: OpenAI-compatible endpoint (unless we already know it lacks /embeddings).
        if self._endpoint_ok is not False:
            try:
                client = get_llm_client()
                vectors = await client.embed(cleaned)
                self._endpoint_ok = True
                self._remember_dim(vectors)
                return vectors
            except LLMError as exc:
                # First failure: decide whether to fall back for the rest of the process.
                if self._endpoint_ok is None:
                    logger.warning("Embeddings endpoint unavailable (%s).", exc)
                self._endpoint_ok = False if self._settings.brain_embed_fallback else self._endpoint_ok
                if not self._settings.brain_embed_fallback:
                    raise EmbeddingError(f"Embeddings endpoint failed: {exc}") from exc

        # Tier 2: local sentence-transformers.
        vectors = await self._embed_local(cleaned)
        self._remember_dim(vectors)
        return vectors

    async def embed_query(self, text: str) -> list[float]:
        """Embed a single query string."""
        vectors = await self.embed_texts([text])
        if not vectors:
            raise EmbeddingError("Query produced no embedding")
        return vectors[0]

    def _remember_dim(self, vectors: list[list[float]]) -> None:
        if vectors and vectors[0]:
            self._dim = len(vectors[0])

    async def _embed_local(self, texts: list[str]) -> list[list[float]]:
        model = self._load_local_model()
        if model is None:
            raise EmbeddingError(
                "No embeddings backend available: the LLM endpoint has no /embeddings "
                "route and sentence-transformers is not installed "
                "(pip install -r backend/requirements-ml.txt)."
            )
        # sentence-transformers is synchronous; keep the event loop free.
        return await asyncio.to_thread(self._encode_local, model, texts)

    @staticmethod
    def _encode_local(model: Any, texts: list[str]) -> list[list[float]]:
        arr = model.encode(texts, normalize_embeddings=False, convert_to_numpy=True)
        return [[float(x) for x in row] for row in arr]

    def _load_local_model(self) -> Any | None:
        if self._st_model is not None:
            return self._st_model
        try:
            from sentence_transformers import SentenceTransformer  # type: ignore
        except ImportError:
            return None
        logger.info("Loading local embedding fallback model %s", _FALLBACK_MODEL_NAME)
        self._st_model = SentenceTransformer(_FALLBACK_MODEL_NAME)
        return self._st_model


_service: EmbeddingService | None = None


def get_embedding_service() -> EmbeddingService:
    global _service
    if _service is None:
        _service = EmbeddingService()
    return _service
