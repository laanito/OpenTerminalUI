"""Per-article news sentiment via the local LLM (v1.2 "research interrogates").

The lexical/FinBERT engine (:mod:`backend.services.sentiment_engine`) is fast and
always available but keyword-shallow — it counts "beat"/"miss" and misses irony,
guidance-vs-results, or "beat but guided down". When a local LLM is configured it
can read a headline the way a trader does.

Design constraints that shape this module:

* **Batched, never per-article in a loop.** `score_article_sentiment` is called
  once per item while normalising a whole news list; an LLM call there would mean
  dozens of sequential round-trips per request. So this scores a *batch* in ONE
  structured call and is only ever invoked on demand (an explicit endpoint), not
  inside the news-list hot path.
* **Cached per article** by content hash, so the same headline isn't re-scored
  across lists/requests.
* **Honest degradation.** Every item is tagged with the engine that produced it
  (`llm` vs `lexical`); when the model is off/unreachable or skips an item, that
  item falls back to the lexical engine — never a fabricated LLM label.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from typing import Any

from backend.api.deps import cache_instance
from backend.config.settings import get_settings
from backend.core.ttl_policy import market_open_now, ttl_seconds
from backend.services.llm_client import LLMError, get_llm_client, parse_json_response
from backend.services.sentiment_engine import score_article_sentiment

logger = logging.getLogger(__name__)

_VALID_LABELS = {"bullish", "bearish", "neutral"}
_MAX_BATCH = 20

NEWS_SENTIMENT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "articles": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "label": {"type": "string", "enum": ["Bullish", "Bearish", "Neutral"]},
                    "score": {"type": "number"},
                    "rationale": {"type": "string", "maxLength": 160},
                },
                "required": ["index", "label", "score"],
            },
        },
    },
    "required": ["articles"],
}


def _compose(article: dict[str, Any]) -> str:
    title = str(article.get("title") or "").strip()
    summary = str(article.get("summary") or "").strip()
    return f"{title}. {summary}".strip()


def _content_hash(article: dict[str, Any]) -> str:
    return hashlib.sha1(_compose(article).encode("utf-8")).hexdigest()[:16]


def _normalize_articles(articles: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not isinstance(articles, list):
        return out
    for raw in articles:
        if not isinstance(raw, dict):
            continue
        title = str(raw.get("title") or "").strip()
        summary = str(raw.get("summary") or "").strip()
        if not title and not summary:
            continue
        art = {"title": title, "summary": summary}
        art["hash"] = _content_hash(art)
        art["id"] = str(raw.get("id") or "").strip() or art["hash"]
        out.append(art)
    return out


def _coerce_label(value: Any, score: float) -> str:
    label = str(value or "").strip().lower()
    if label in _VALID_LABELS:
        return label.capitalize()
    # Model gave an off-schema label — derive from the score rather than trust it.
    if score > 0.1:
        return "Bullish"
    if score < -0.1:
        return "Bearish"
    return "Neutral"


def _clamp_score(value: Any) -> float:
    try:
        return round(max(-1.0, min(1.0, float(value))), 4)
    except (TypeError, ValueError):
        return 0.0


def _sentiment_prompt(articles: list[dict[str, Any]]) -> tuple[str, str]:
    """Build the (system, user) prompt for batch article sentiment.

    Pure and testable. Each article is numbered; the model returns one verdict per
    index. Framing is a trader's market read (does this help or hurt the security's
    price), not generic tone — "beats but guides down" is bearish."""
    system = (
        "You are a financial news analyst. For each numbered article, judge the "
        "MARKET sentiment for the security it concerns, from a trader's point of "
        "view: does this news help or hurt the price? Read like a professional — "
        "an earnings beat with weak guidance is Bearish; a resolved overhang is "
        "Bullish; routine coverage is Neutral. For each, return the article index, "
        "a label (Bullish, Bearish, or Neutral), a score in [-1, 1] (negative = "
        "bearish, positive = bullish, magnitude = strength), and a one-line "
        "rationale. Judge only from the text given; do not invent facts."
    )
    lines = [f"[{i}] {_compose(a)}" for i, a in enumerate(articles)]
    user = "Articles:\n" + "\n".join(lines)
    return system, user


async def _score_batch_llm(articles: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """One structured LLM call for a batch. Returns {article_id: verdict}; empty
    dict if the model is unreachable or the response can't be parsed."""
    settings = get_settings()
    client = get_llm_client()
    if not settings.llm_enabled or not await client.health():
        return {}

    system, user = _sentiment_prompt(articles)
    try:
        content = await client.chat(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.1,
            max_tokens=min(2000, 90 * len(articles) + 200),
            json_schema=NEWS_SENTIMENT_SCHEMA,
        )
        parsed = parse_json_response(content)
    except (LLMError, asyncio.TimeoutError) as exc:
        logger.info("LLM article sentiment unavailable: %s", exc)
        return {}

    out: dict[str, dict[str, Any]] = {}
    for node in parsed.get("articles") or []:
        if not isinstance(node, dict):
            continue
        idx = node.get("index")
        if not isinstance(idx, int) or idx < 0 or idx >= len(articles):
            continue
        score = _clamp_score(node.get("score"))
        label = _coerce_label(node.get("label"), score)
        rationale = str(node.get("rationale") or "").strip()[:160]
        out[articles[idx]["id"]] = {
            "label": label,
            "score": score,
            "confidence": round(min(1.0, abs(score) + 0.3), 4),
            "rationale": rationale,
            "engine": "llm",
        }
    return out


def _lexical_item(article: dict[str, Any]) -> dict[str, Any]:
    lex = score_article_sentiment(_compose(article))
    return {
        "label": str(lex.get("label") or "Neutral"),
        "score": float(lex.get("score") or 0.0),
        "confidence": float(lex.get("confidence") or 0.0),
        "rationale": "",
        "engine": "lexical",
    }


async def score_articles(articles: Any, *, max_items: int = _MAX_BATCH) -> dict[str, Any]:
    """Score a batch of articles, preferring the LLM and caching per article.

    Returns ``{engine, model, items:[{id,label,score,confidence,rationale,engine}]}``
    where the top-level ``engine`` is ``llm`` (all via LLM), ``lexical`` (none), or
    ``mixed``. Items keep the exact order of the input.
    """
    normalized = _normalize_articles(articles)[:max_items]
    settings = get_settings()
    if not normalized:
        return {"engine": "unavailable", "model": settings.llm_model, "items": []}

    verdicts: dict[str, dict[str, Any]] = {}
    to_score: list[dict[str, Any]] = []
    for art in normalized:
        cached = await cache_instance.get(cache_instance.build_key("ai_sentiment", art["hash"]))
        if cached:
            verdicts[art["id"]] = cached
        else:
            to_score.append(art)

    if to_score:
        llm_scored = await _score_batch_llm(to_score)
        ttl = ttl_seconds("news_latest", market_open_now())
        for art in to_score:
            item = llm_scored.get(art["id"])
            if item is not None:
                await cache_instance.set(cache_instance.build_key("ai_sentiment", art["hash"]), item, ttl=ttl)
            else:
                item = _lexical_item(art)  # LLM off/unreachable/skipped this one
            verdicts[art["id"]] = item

    items = [{"id": art["id"], **verdicts[art["id"]]} for art in normalized]
    engines = {it.get("engine", "lexical") for it in items}
    engine = "llm" if engines == {"llm"} else ("lexical" if "llm" not in engines else "mixed")
    return {"engine": engine, "model": settings.llm_model, "items": items}
