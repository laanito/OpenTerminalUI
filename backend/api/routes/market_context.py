"""Evidence-first comparison of a symbol with other market proxies."""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import date, datetime, timezone
from typing import Any, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.api.deps import get_unified_fetcher
from backend.api.routes.news import _fetch_ticker_news
from backend.auth.deps import get_current_user
from backend.models import User
from backend.services.cross_market_context import FETCH_RANGES, _daily_closes, compare_closes

router = APIRouter(prefix="/api/market-context", tags=["market-context"])
_SYMBOL = re.compile(r"^[A-Z0-9^._=-]{1,40}$")
logger = logging.getLogger(__name__)
_NEWS_FETCH_LIMIT = 50
_NEWS_DISPLAY_LIMIT = 8


class MarketComparisonRequest(BaseModel):
    anchor: str = Field(min_length=1, max_length=40, examples=["AAPL"])
    comparisons: list[str] = Field(min_length=1, max_length=6, examples=[["SPY", "BTC-USD"]])
    period: Literal["1M", "3M", "6M"] = "1M"


class MarketComparisonRow(BaseModel):
    symbol: str
    status: Literal["available", "unavailable"]
    reason: Literal["missing_history", "insufficient_overlap", "provider_error"] | None = None
    start_date: date | None = None
    end_date: date | None = None
    anchor_latest_date: date | None = None
    comparison_latest_date: date | None = None
    anchor_history_source: str | None = None
    comparison_history_source: str | None = None
    observations: int | None = None
    freshness: Literal["current", "stale"] | None = None
    anchor_return_pct: float | None = None
    comparison_return_pct: float | None = None
    relative_return_pp: float | None = None


class MarketComparisonResponse(BaseModel):
    anchor: str
    period: Literal["1M", "3M", "6M"]
    retrieved_at: datetime
    data_source: Literal["unified_history"]
    return_basis: Literal["native_quote_currency_unadjusted"]
    method: Literal["same_utc_date_daily_closes"]
    comparisons: list[MarketComparisonRow]


class MarketHeadlinesRequest(BaseModel):
    anchor: str = Field(min_length=1, max_length=40)
    comparison: str = Field(min_length=1, max_length=40)
    start_date: date
    end_date: date


class MarketHeadline(BaseModel):
    title: str
    url: str
    source: str
    published_at: datetime


class MarketHeadlineGroup(BaseModel):
    symbol: str
    status: Literal["available", "feed_error"]
    examined_count: int
    matched_count: int
    headlines: list[MarketHeadline]


class MarketHeadlinesResponse(BaseModel):
    anchor: str
    comparison: str
    start_date: date
    end_date: date
    retrieved_at: datetime
    source: Literal["current_keyless_feeds"]
    fetch_limit_per_symbol: int
    display_limit_per_symbol: int
    groups: list[MarketHeadlineGroup]


def _symbol(raw: str) -> str:
    value = raw.strip().upper()
    if not _SYMBOL.fullmatch(value):
        raise HTTPException(status_code=422, detail=f"Invalid market symbol: {raw!r}")
    return value


@router.post("/compare", response_model=MarketComparisonResponse)
async def compare_market_context(
    payload: MarketComparisonRequest,
    _: User = Depends(get_current_user),
    fetcher: Any = Depends(get_unified_fetcher),
) -> dict[str, Any]:
    """Return observed, date-aligned native-quote returns; never a causal claim."""
    anchor = _symbol(payload.anchor)
    comparisons = list(dict.fromkeys(_symbol(raw) for raw in payload.comparisons))
    if anchor in comparisons:
        raise HTTPException(status_code=422, detail="Anchor cannot be a comparison symbol")
    if not comparisons:
        raise HTTPException(status_code=422, detail="At least one comparison symbol is required")

    histories: dict[str, dict[date, float]] = {}
    sources: dict[str, str | None] = {}
    errors: set[str] = set()
    semaphore = asyncio.Semaphore(3)

    async def load(symbol: str) -> None:
        async with semaphore:
            try:
                if hasattr(fetcher, "fetch_history_with_source"):
                    raw, source = await fetcher.fetch_history_with_source(
                        symbol, range_str=FETCH_RANGES[payload.period], interval="1d"
                    )
                else:
                    raw = await fetcher.fetch_history(symbol, range_str=FETCH_RANGES[payload.period], interval="1d")
                    source = None
                histories[symbol] = _daily_closes(raw)
                sources[symbol] = source if histories[symbol] else None
            except Exception as exc:
                # A provider failure must not turn a partial comparison into a 500.
                logger.warning("Market-context history failed for %s: %s", symbol, exc)
                errors.add(symbol)
                histories[symbol] = {}
                sources[symbol] = None

    await asyncio.gather(*(load(symbol) for symbol in [anchor, *comparisons]))

    rows = []
    for symbol in comparisons:
        result = compare_closes(histories[anchor], histories[symbol], period=payload.period)
        if result["status"] == "unavailable" and (anchor in errors or symbol in errors):
            result["reason"] = "provider_error"
        rows.append({
            "symbol": symbol,
            **result,
            "anchor_history_source": sources[anchor],
            "comparison_history_source": sources[symbol],
        })

    return {
        "anchor": anchor,
        "period": payload.period,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "data_source": "unified_history",
        "return_basis": "native_quote_currency_unadjusted",
        "method": "same_utc_date_daily_closes",
        "comparisons": rows,
    }


@router.post("/headlines", response_model=MarketHeadlinesResponse)
async def get_market_context_headlines(
    payload: MarketHeadlinesRequest,
    _: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Find source-dated candidate headlines in one observed comparison window."""
    anchor = _symbol(payload.anchor)
    comparison = _symbol(payload.comparison)
    if anchor == comparison:
        raise HTTPException(status_code=422, detail="Anchor cannot be a comparison symbol")
    if payload.end_date < payload.start_date or (payload.end_date - payload.start_date).days > 200:
        raise HTTPException(status_code=422, detail="Headline window must span 0–200 days")

    async def load(symbol: str) -> dict[str, Any]:
        try:
            candidates = await _fetch_ticker_news(symbol, market=None, limit=_NEWS_FETCH_LIMIT)
        except Exception as exc:
            logger.warning("Market-context headline fetch failed for %s: %s", symbol, exc)
            return {"symbol": symbol, "status": "feed_error", "examined_count": 0, "matched_count": 0, "headlines": []}

        matched = []
        for item in candidates:
            try:
                published = datetime.fromisoformat(str(item["published_at"]).replace("Z", "+00:00"))
                if published.tzinfo is None:
                    continue
                published_utc = published.astimezone(timezone.utc)
                if not payload.start_date <= published_utc.date() <= payload.end_date:
                    continue
                title = str(item["title"]).strip()
                url = str(item["url"]).strip()
                parsed_url = urlsplit(url)
                if not title or parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
                    continue
            except (KeyError, TypeError, ValueError):
                continue
            matched.append({
                "title": title,
                "url": url,
                "source": str(item.get("source") or "Unknown"),
                "published_at": published_utc,
            })
        matched.sort(key=lambda item: item["published_at"], reverse=True)
        return {
            "symbol": symbol,
            "status": "available",
            "examined_count": len(candidates),
            "matched_count": len(matched),
            "headlines": matched[:_NEWS_DISPLAY_LIMIT],
        }

    groups = await asyncio.gather(load(anchor), load(comparison))
    return {
        "anchor": anchor,
        "comparison": comparison,
        "start_date": payload.start_date,
        "end_date": payload.end_date,
        "retrieved_at": datetime.now(timezone.utc),
        "source": "current_keyless_feeds",
        "fetch_limit_per_symbol": _NEWS_FETCH_LIMIT,
        "display_limit_per_symbol": _NEWS_DISPLAY_LIMIT,
        "groups": groups,
    }
