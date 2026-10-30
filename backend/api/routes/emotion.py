"""Per-stock news emotion endpoint.

Surfaces a fear<->greed style emotion indicator for a specific ticker, derived
from recent news analyzed by a local LLM (Ollama by default).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from backend.api.model_lifecycle import model_operation_response
from backend.config.settings import get_settings
from backend.services.llm_profiles import ResolvedLLMProfile, resolve_llm_profile
from sqlalchemy import desc, or_
from sqlalchemy.exc import OperationalError

from backend.api.deps import cache_instance
from backend.api.routes.news import (
    _fetch_news_fallback,
    _ticker_aliases,
    _ticker_fallback_terms,
)
from backend.core.ttl_policy import market_open_now, ttl_seconds
from backend.db.models import NewsArticle
from backend.services.stock_emotion import analyze_stock_emotion
from backend.shared.db import SessionLocal

router = APIRouter()


def _load_db_articles(symbol: str, market_code: str | None, days: int) -> list[dict[str, Any]]:
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    db = SessionLocal()
    try:
        aliases = _ticker_aliases(symbol, market_code)
        ticker_filters = [NewsArticle.tickers.like(f'%"{alias}"%') for alias in aliases]
        rows = (
            db.query(NewsArticle)
            .filter(or_(*ticker_filters), NewsArticle.published_at >= cutoff_iso)
            .order_by(desc(NewsArticle.published_at))
            .limit(60)
            .all()
        )
    except OperationalError:
        return []
    finally:
        db.close()
    return [
        {
            "title": row.title or "",
            "summary": row.summary or "",
            "source": row.source or "Unknown",
            "url": row.url or "",
            "published_at": row.published_at or "",
        }
        for row in rows
    ]


@router.get("/sentiment/emotion/{ticker}")
async def get_stock_emotion(
    ticker: str,
    days: int = Query(default=7, ge=1, le=30),
    market: str | None = Query(default=None, description="Optional market context e.g. NSE/BSE/NASDAQ"),
    limit: int = Query(default=6, ge=3, le=30),
) -> dict[str, Any]:
    """Return an aggregated emotion profile for a ticker's recent news."""
    profile = resolve_llm_profile(get_settings(), "stock_emotion")
    return await _stock_emotion(ticker, days, market, limit, profile)


async def _stock_emotion(
    ticker: str, days: int, market: str | None, limit: int, profile: ResolvedLLMProfile,
) -> dict[str, Any]:
    if not isinstance(market, str):
        market = None
    symbol = ticker.strip().upper()
    market_code = (market or "").strip().upper() or None

    cache_key = cache_instance.build_key(
        "news_latest",
        f"emotion:{symbol}",
        {"days": days, "market": market_code or "", "limit": limit, "profile": profile.cache_fingerprint()},
    )
    cached = await cache_instance.get(cache_key)
    if cached:
        return cached

    articles = _load_db_articles(symbol, market_code, days)
    if not articles:
        for term in _ticker_fallback_terms(symbol, market_code):
            articles = await _fetch_news_fallback(term, limit=max(limit, days * 6))
            if articles:
                break

    payload = await analyze_stock_emotion(symbol, articles, period_days=days, limit=limit, profile=profile)
    if payload.get("engine") == "llm" or not profile.enabled:
        await cache_instance.set(cache_key, payload, ttl=ttl_seconds("news_latest", market_open_now()))
    return payload


class EmotionRequest(BaseModel):
    ticker: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9^._=-]+$")
    days: int = Field(default=7, ge=1, le=30)
    market: str | None = Field(default=None, max_length=40)
    limit: int = Field(default=6, ge=3, le=30)


@router.post("/sentiment/emotion/stream")
async def stream_stock_emotion(payload: EmotionRequest):
    """Fast emotion classification with a single announced operation budget."""
    profile = resolve_llm_profile(get_settings(), "stock_emotion")
    return model_operation_response(lambda: _stock_emotion(payload.ticker, payload.days, payload.market, payload.limit, profile), profile)
