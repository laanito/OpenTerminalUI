from __future__ import annotations

import hashlib
import html
import json
import re
import asyncio
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree as ET
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query
from sqlalchemy import desc, or_
from sqlalchemy.exc import OperationalError
import httpx

from backend.api.deps import cache_instance, fetch_stock_snapshot_coalesced, get_unified_fetcher
from backend.core.ttl_policy import market_open_now, ttl_seconds
from backend.services.sentiment_engine import score_article_sentiment
from backend.shared.db import SessionLocal
from backend.db.models import NewsArticle
from backend.services.news_terms import (
    crypto_match_tokens as _crypto_match_tokens,
    crypto_news_terms as _crypto_news_terms,
    eu_exchange_suffix as _eu_exchange_suffix,
    eu_news_terms as _eu_news_terms,
    index_news_terms as _index_news_terms,
    is_crypto_symbol as _is_crypto_symbol,
    is_index_symbol as _is_index_symbol,
    ticker_fallback_terms as _ticker_fallback_terms,
)

router = APIRouter()

US_MARKETS = {"NYSE", "NASDAQ"}
IN_MARKETS = {"NSE", "BSE"}
SUPPORTED_MARKETS = US_MARKETS | IN_MARKETS

# Symbol classification, news search terms, and coin/index relevance matching now
# live in backend/services/news_terms.py so the background ingestor shares exactly
# the same logic — see the aliased imports above.

# Keyless crypto-native RSS feeds. The web-search fallbacks (Yahoo, Google News)
# under-cover crypto beyond the largest coins, so for crypto symbols we also pull
# these firehoses and filter them to the coin. No API keys, honoring the project's
# privacy-first, no-paid-feeds default.
_CRYPTO_RSS_FEEDS: list[tuple[str, str]] = [
    ("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/"),
    ("Cointelegraph", "https://cointelegraph.com/rss"),
    ("Decrypt", "https://decrypt.co/feed"),
]

_HTML_RE = re.compile(r"<[^>]+>")

# Publisher-authored summary extraction. The keyless Yahoo Finance search — our
# primary source for market/search/ticker news — returns headline-only rows with
# NO summary field, so those feeds render bare titles. Rather than have an LLM
# invent a summary from a headline we haven't read (fabrication, exactly what this
# terminal refuses to do), we lift the article's OWN one-to-two-line blurb from its
# Open Graph / meta description. Real publisher text, no keys, no invention.
_OG_DESC_RE = re.compile(
    r"<meta[^>]+property=[\"']og:description[\"'][^>]+content=[\"']([^\"']+)[\"']",
    re.IGNORECASE,
)
_META_DESC_RE = re.compile(
    r"<meta[^>]+name=[\"']description[\"'][^>]+content=[\"']([^\"']+)[\"']",
    re.IGNORECASE,
)
_SUMMARY_MAX_CHARS = 280
_SUMMARY_MAX_URLS = 24


def _to_iso_from_epoch(value: Any) -> str | None:
    try:
        epoch = int(value)
    except (TypeError, ValueError):
        return None
    if epoch <= 0:
        return None
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat()


def _stable_id(url: str, title: str, published_at: str) -> str:
    key = f"{url}|{title}|{published_at}".encode("utf-8")
    return hashlib.sha1(key).hexdigest()[:16]


def _normalize_items(rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    dedup: dict[str, dict[str, str]] = {}
    for row in rows:
        url = str(row.get("url") or row.get("link") or "").strip()
        title = str(row.get("headline") or row.get("title") or "").strip()
        if not url or not title:
            continue
        source = str(row.get("source") or row.get("site") or "Unknown").strip() or "Unknown"
        summary = str(row.get("summary") or row.get("text") or "").strip()
        published_at = _to_iso_from_epoch(row.get("datetime")) or str(row.get("publishedAt") or "").strip()
        if not published_at:
            published_at = datetime.now(timezone.utc).isoformat()
        item = {
            "id": _stable_id(url, title, published_at),
            "title": title,
            "source": source,
            "publishedAt": published_at,
            "url": url,
            "summary": summary,
        }
        dedup[url] = item

    def _sort_key(item: dict[str, str]) -> float:
        try:
            return datetime.fromisoformat(item["publishedAt"].replace("Z", "+00:00")).timestamp()
        except Exception:
            return 0.0

    return sorted(dedup.values(), key=_sort_key, reverse=True)


def _row_to_item(row: NewsArticle) -> dict[str, Any]:
    tickers: list[str] = []
    try:
        parsed = json.loads(row.tickers or "[]")
        if isinstance(parsed, list):
            tickers = [str(v).upper() for v in parsed if str(v).strip()]
    except Exception:
        tickers = []
    sentiment = _row_sentiment(row)
    return {
        "id": row.id,
        "source": row.source,
        "title": row.title,
        "url": row.url,
        "summary": row.summary,
        "image_url": row.image_url,
        "published_at": row.published_at,
        "tickers": tickers,
        "sentiment": sentiment,
    }


def _compose_news_text(title: str, summary: str) -> str:
    return f"{title or ''}. {summary or ''}".strip()


def _row_sentiment(row: NewsArticle) -> dict[str, Any]:
    if row.sentiment_label and row.sentiment_score is not None and row.sentiment_confidence is not None:
        return {
            "score": float(row.sentiment_score),
            "label": str(row.sentiment_label),
            "confidence": float(row.sentiment_confidence),
        }
    return score_article_sentiment(_compose_news_text(row.title, row.summary))


def _label_from_score(score: float) -> str:
    if score > 0.1:
        return "Bullish"
    if score < -0.1:
        return "Bearish"
    return "Neutral"


def _to_day(value: str) -> str | None:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date().isoformat()
    except Exception:
        return None


def _ticker_aliases(symbol: str, market: str | None = None) -> list[str]:
    base = symbol.strip().upper()
    if not base:
        return []
    aliases = {base}
    mkt = (market or "").strip().upper()
    if mkt in {"NSE", "IN"}:
        aliases.add(f"{base}.NS")
    if mkt in {"BSE"}:
        aliases.add(f"{base}.BO")
    # With no market hint, we used to guess India (.NS/.BO) for EVERY symbol —
    # which India-biases the DB lookup for EU-suffixed tickers (JEIP.DE), crypto
    # (BTC-USD) and indices (^GSPC). Only guess India for a *bare* equity ticker
    # that carries no exchange suffix of its own.
    if not mkt and "." not in base and not _is_crypto_symbol(base) and not _is_index_symbol(base):
        aliases.update({f"{base}.NS", f"{base}.BO"})
    return sorted(aliases)


def _validate_market(market: str) -> str:
    market_code = market.strip().upper()
    if market_code not in SUPPORTED_MARKETS:
        raise HTTPException(status_code=400, detail=f"Unsupported market: {market_code}")
    return market_code


def _strip_html(text: str) -> str:
    clean = _HTML_RE.sub(" ", text or "")
    clean = html.unescape(clean)
    return " ".join(clean.split()).strip()


def _to_iso_from_rss_date(raw: str | None) -> str:
    if not raw:
        return datetime.now(timezone.utc).isoformat()
    try:
        dt = parsedate_to_datetime(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        return datetime.now(timezone.utc).isoformat()


def _sentiment_payload(title: str, summary: str) -> dict[str, Any]:
    return score_article_sentiment(_compose_news_text(title, summary))


def _rss_item_to_payload(item: ET.Element, default_source: str = "Google News") -> dict[str, Any] | None:
    title = (item.findtext("title") or "").strip()
    url = (item.findtext("link") or "").strip()
    summary = _strip_html((item.findtext("description") or "").strip())
    source = (item.findtext("source") or "").strip() or default_source
    published_at = _to_iso_from_rss_date(item.findtext("pubDate"))
    if not title or not url:
        return None
    sentiment = _sentiment_payload(title, summary)
    return {
        "id": _stable_id(url, title, published_at),
        "source": source,
        "title": title,
        "url": url,
        "summary": summary,
        "image_url": "",
        "published_at": published_at,
        "tickers": [],
        "sentiment": sentiment,
    }


async def _fetch_google_news_rss(query: str, limit: int = 50) -> list[dict[str, Any]]:
    q = (query or "").strip()
    if not q:
        return []
    url = "https://news.google.com/rss/search"
    params = {
        "q": q,
        "hl": "en-US",
        "gl": "US",
        "ceid": "US:en",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0, trust_env=False, follow_redirects=True) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            root = ET.fromstring(resp.text)
    except Exception:
        return []

    out: list[dict[str, Any]] = []
    for node in root.findall(".//item"):
        parsed = _rss_item_to_payload(node)
        if parsed:
            out.append(parsed)
        if len(out) >= limit:
            break
    return out


async def _fetch_rss_feed(url: str, default_source: str, limit: int = 50) -> list[dict[str, Any]]:
    """Fetch and parse a plain RSS 2.0 feed (no keys, no query params)."""
    try:
        async with httpx.AsyncClient(timeout=10.0, trust_env=False, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "OpenTerminalUI/1.0 (+news)"})
            resp.raise_for_status()
            root = ET.fromstring(resp.content)
    except Exception:
        return []

    out: list[dict[str, Any]] = []
    for node in root.findall(".//item"):
        parsed = _rss_item_to_payload(node, default_source=default_source)
        if parsed:
            out.append(parsed)
        if len(out) >= limit:
            break
    return out


async def _fetch_crypto_rss(limit: int = 80) -> list[dict[str, Any]]:
    """Merged, deduped firehose from keyless crypto-native RSS feeds.

    Symbol-independent, so it's cached once under a fixed key rather than fetched
    per coin — filtering to a specific coin happens downstream in memory."""
    cache_key = cache_instance.build_key("news_latest", "crypto_rss", {"limit": limit})
    cached = await cache_instance.get(cache_key)
    if cached is not None:
        return cached

    feeds = await asyncio.gather(
        *(_fetch_rss_feed(url, source, limit=limit) for source, url in _CRYPTO_RSS_FEEDS),
        return_exceptions=True,
    )
    rows: list[dict[str, Any]] = []
    for result in feeds:
        if isinstance(result, list):
            rows.extend(result)
    merged = _merge_news(rows, limit=limit)
    await cache_instance.set(cache_key, merged, ttl=ttl_seconds("news_latest", market_open_now()))
    return merged


def _yahoo_news_row_to_payload(row: dict[str, Any]) -> dict[str, Any] | None:
    title = str(row.get("title") or "").strip()
    url = str(row.get("link") or row.get("url") or "").strip()
    summary = _strip_html(str(row.get("summary") or row.get("description") or "").strip())
    source = str(row.get("publisher") or row.get("source") or "Yahoo Finance").strip() or "Yahoo Finance"
    published_at = _to_iso_from_epoch(row.get("providerPublishTime")) or _to_iso_from_rss_date(str(row.get("pubDate") or ""))
    if not title or not url:
        return None
    sentiment = _sentiment_payload(title, summary)
    return {
        "id": _stable_id(url, title, published_at),
        "source": source,
        "title": title,
        "url": url,
        "summary": summary,
        "image_url": "",
        "published_at": published_at,
        "tickers": [],
        "sentiment": sentiment,
    }


async def _fetch_yahoo_news(query: str, limit: int = 50) -> list[dict[str, Any]]:
    fetcher = await get_unified_fetcher()
    rows = await fetcher.search_news(query, limit=limit)
    out: list[dict[str, Any]] = []
    for row in rows:
        parsed = _yahoo_news_row_to_payload(row)
        if parsed:
            out.append(parsed)
        if len(out) >= limit:
            break
    return out


async def _fetch_news_fallback(query: str, limit: int = 50) -> list[dict[str, Any]]:
    # Priority: Yahoo search API (usually available without keys), then Google RSS.
    yahoo_rows = await _fetch_yahoo_news(query, limit=limit)
    if yahoo_rows:
        return yahoo_rows[:limit]
    return await _fetch_google_news_rss(query, limit=limit)


def _merge_news(*groups: list[dict[str, Any]], limit: int = 50) -> list[dict[str, Any]]:
    """Dedup by URL across groups and sort newest-first. Earlier groups win ties."""
    dedup: dict[str, dict[str, Any]] = {}
    for group in groups:
        for row in group:
            url = str(row.get("url") or "").strip()
            if url and url not in dedup:
                dedup[url] = row
    items = list(dedup.values())
    items.sort(key=lambda x: str(x.get("published_at") or ""), reverse=True)
    return items[:limit]


def _filter_crypto_rss(rows: list[dict[str, Any]], symbol: str) -> list[dict[str, Any]]:
    """Keep firehose items whose title/summary mention the coin (whole-word)."""
    tokens = _crypto_match_tokens(symbol)
    if not tokens:
        return []
    pattern = re.compile(r"\b(?:" + "|".join(re.escape(t) for t in tokens) + r")\b", re.IGNORECASE)
    out: list[dict[str, Any]] = []
    for row in rows:
        haystack = f"{row.get('title') or ''} {row.get('summary') or ''}"
        if pattern.search(haystack):
            out.append(row)
    return out


async def _fetch_ticker_news(symbol: str, market: str | None, limit: int = 50) -> list[dict[str, Any]]:
    """Live news for a symbol from keyless sources.

    Crypto symbols blend web search with the crypto-native RSS firehose (filtered
    to the coin); equities and indices take the first fallback term that yields."""
    base = symbol.strip().upper()
    terms = _ticker_fallback_terms(base, market)
    if _is_crypto_symbol(base):
        web: list[dict[str, Any]] = []
        for term in terms:
            web = await _fetch_news_fallback(term, limit=limit)
            if web:
                break
        firehose = _filter_crypto_rss(await _fetch_crypto_rss(limit=80), base)
        return _merge_news(web, firehose, limit=limit)
    for term in terms:
        items = await _fetch_news_fallback(term, limit=limit)
        if items:
            return items
    return []


async def _fallback_latest_news(limit: int = 50) -> list[dict[str, Any]]:
    queries = ["stock market", "business finance", "global markets"]
    rows: list[dict[str, Any]] = []
    for q in queries:
        rows.extend(await _fetch_news_fallback(q, limit=limit))
    dedup: dict[str, dict[str, Any]] = {}
    for row in rows:
        url = str(row.get("url") or "").strip()
        if url:
            dedup[url] = row
    items = list(dedup.values())
    items.sort(key=lambda x: str(x.get("published_at") or ""), reverse=True)
    return items[:limit]


async def _fetch_og_summary(url: str) -> str:
    """The article's own summary (Open Graph / meta description), keyless.

    Cached per-URL under a long TTL — a published article's blurb doesn't change,
    so once fetched it's effectively free and shared across users. Any failure
    (timeout, non-HTML, no tag) degrades to an empty string; the row then simply
    shows no summary rather than a fabricated one."""
    clean = (url or "").strip()
    if not clean.startswith(("http://", "https://")):
        return ""
    cache_key = cache_instance.build_key("news_summary", clean, {})
    cached = await cache_instance.get(cache_key)
    if cached is not None:
        return cached

    summary = ""
    try:
        async with httpx.AsyncClient(timeout=6.0, trust_env=False, follow_redirects=True) as client:
            resp = await client.get(
                clean,
                headers={"User-Agent": "Mozilla/5.0 (compatible; OpenTerminalUI/1.0; +news)"},
            )
            resp.raise_for_status()
            ctype = resp.headers.get("content-type", "")
            if "html" in ctype.lower() or not ctype:
                # Only the <head> carries the meta tags; cap the scanned text so a
                # huge page doesn't blow up the regex.
                head = resp.text[:120_000]
                match = _OG_DESC_RE.search(head) or _META_DESC_RE.search(head)
                if match:
                    text = _strip_html(html.unescape(match.group(1)))
                    if len(text) > _SUMMARY_MAX_CHARS:
                        text = text[:_SUMMARY_MAX_CHARS].rsplit(" ", 1)[0].rstrip() + "…"
                    summary = text
    except Exception:
        summary = ""

    # Cache even the empty result so a dead/summary-less URL isn't refetched every
    # render; TTL is a day (news_summary policy), well beyond a browsing session.
    await cache_instance.set(cache_key, summary, ttl=ttl_seconds("news_summary", market_open_now()))
    return summary


@router.post("/news/summaries")
async def get_news_summaries(
    urls: list[str] = Body(..., embed=True, description="Article URLs to summarise (max 24)"),
) -> dict[str, dict[str, str]]:
    """Batch: article URL -> publisher summary, for rows a feed left summary-less.

    The frontend calls this only for the handful of headlines currently on screen
    that arrived without a summary (the Yahoo-search path), so cost tracks what the
    user actually sees, and per-URL caching makes repeat views free."""
    seen: list[str] = []
    for raw in urls or []:
        clean = str(raw or "").strip()
        if clean and clean not in seen:
            seen.append(clean)
        if len(seen) >= _SUMMARY_MAX_URLS:
            break

    if not seen:
        return {"summaries": {}}

    sem = asyncio.Semaphore(6)

    async def _one(u: str) -> tuple[str, str]:
        async with sem:
            return u, await _fetch_og_summary(u)

    resolved = await asyncio.gather(*[_one(u) for u in seen])
    summaries = {u: text for u, text in resolved if text}
    return {"summaries": summaries}


@router.get("/news/symbol")
async def get_symbol_news(
    market: str = Query(..., description="NSE|BSE|NYSE|NASDAQ"),
    symbol: str = Query(..., min_length=1, max_length=24),
    limit: int = Query(default=30, ge=1, le=100),
) -> dict[str, list[dict[str, str]]]:
    market_code = _validate_market(market)
    ticker = symbol.strip().upper()

    if market_code in IN_MARKETS:
        # For Indian markets, use our news fallback mechanism (Yahoo search)
        items = await _fetch_news_fallback(f"{ticker} NSE", limit=limit)
        return {"items": items[:limit]}

    fetcher = await get_unified_fetcher()
    rows = await fetcher.get_company_news(ticker, limit=limit)
    items = _normalize_items(rows if isinstance(rows, list) else [])
    return {"items": items[:limit]}


@router.get("/news/market")
async def get_market_news(
    market: str = Query(..., description="NSE|BSE|NYSE|NASDAQ"),
    limit: int = Query(default=30, ge=1, le=100),
) -> dict[str, list[dict[str, str]]]:
    market_code = _validate_market(market)

    if market_code in IN_MARKETS:
        # Use fallback for Indian market news
        items = await _fetch_news_fallback("NSE Nifty Indian Stock Market", limit=limit)
        return {"items": items[:limit]}

    fetcher = await get_unified_fetcher()
    rows = await fetcher.get_market_news(category="general", limit=limit)
    items = _normalize_items(rows if isinstance(rows, list) else [])
    return {"items": items[:limit]}


@router.get("/news/latest")
async def get_latest_news(limit: int = Query(default=50, ge=1, le=200)) -> dict[str, Any]:
    cache_key = cache_instance.build_key("news_latest", "all", {"limit": limit})
    cached = await cache_instance.get(cache_key)
    if cached:
        return cached

    db = SessionLocal()
    try:
        rows = db.query(NewsArticle).order_by(desc(NewsArticle.published_at)).limit(limit).all()
        items = [_row_to_item(row) for row in rows]
        if not items:
            items = await _fallback_latest_news(limit=limit)
        payload = {"items": items}
    except OperationalError:
        payload = {"items": await _fallback_latest_news(limit=limit)}
    finally:
        db.close()

    await cache_instance.set(
        cache_key,
        payload,
        ttl=ttl_seconds("news_latest", market_open_now()),
    )
    return payload


@router.get("/news/search")
async def search_news(
    q: str = Query(..., min_length=1, max_length=100),
    limit: int = Query(default=50, ge=1, le=200),
) -> dict[str, Any]:
    term = q.strip()
    cache_key = cache_instance.build_key("news_latest", "search", {"q": term.lower(), "limit": limit})
    cached = await cache_instance.get(cache_key)
    if cached:
        return cached

    db = SessionLocal()
    try:
        like = f"%{term}%"
        rows = (
            db.query(NewsArticle)
            .filter(
                or_(
                    NewsArticle.title.ilike(like),
                    NewsArticle.summary.ilike(like),
                    NewsArticle.source.ilike(like),
                )
            )
            .order_by(desc(NewsArticle.published_at))
            .limit(limit)
            .all()
        )
        items = [_row_to_item(row) for row in rows]
        if not items:
            items = await _fetch_news_fallback(term, limit=limit)
        payload = {"items": items}
    except OperationalError:
        payload = {"items": await _fetch_news_fallback(term, limit=limit)}
    finally:
        db.close()

    await cache_instance.set(
        cache_key,
        payload,
        ttl=ttl_seconds("news_latest", market_open_now()),
    )
    return payload


@router.get("/news/by-ticker/{ticker}")
async def get_news_by_ticker(
    ticker: str,
    limit: int = Query(default=50, ge=1, le=200),
    market: str | None = Query(default=None, description="Optional market context e.g. NSE/BSE/NASDAQ"),
) -> dict[str, Any]:
    symbol = ticker.strip().upper()
    if not isinstance(market, str):
        market = None
    market_code = (market or "").strip().upper() or None
    cache_key = cache_instance.build_key("news_latest", f"ticker:{symbol}", {"limit": limit, "market": market_code or ""})
    cached = await cache_instance.get(cache_key)
    if cached:
        return cached

    # Crypto is special-cased: the ingestor's ticker tagging is unreliable for
    # coins (loose "-USD"/symbol matching mistags unrelated equities — a Ford
    # story ends up tagged "XRP-USD"), and the DB-first path below would then
    # return those junk rows and, because it found *something*, never fall
    # through to the keyless crypto firehose. So for a coin we skip the DB and
    # serve the live blended feed (web search + CoinDesk/Cointelegraph/Decrypt,
    # filtered to the coin) directly.
    if _is_crypto_symbol(symbol):
        payload = {"items": await _fetch_ticker_news(symbol, market_code, limit=limit)}
        await cache_instance.set(cache_key, payload, ttl=ttl_seconds("news_latest", market_open_now()))
        return payload

    db = SessionLocal()
    try:
        aliases = _ticker_aliases(symbol, market_code)
        ticker_filters = [NewsArticle.tickers.like(f'%"{alias}"%') for alias in aliases]
        rows = (
            db.query(NewsArticle)
            .filter(or_(*ticker_filters))
            .order_by(desc(NewsArticle.published_at))
            .limit(limit)
            .all()
        )
        items = [_row_to_item(row) for row in rows]
        if not items:
            items = await _fetch_ticker_news(symbol, market_code, limit=limit)
        payload = {"items": items}
    except OperationalError:
        payload = {"items": await _fetch_ticker_news(symbol, market_code, limit=limit)}
    finally:
        db.close()

    await cache_instance.set(
        cache_key,
        payload,
        ttl=ttl_seconds("news_latest", market_open_now()),
    )
    return payload


@router.get("/news/crypto")
async def get_crypto_news(
    limit: int = Query(default=50, ge=1, le=200),
    symbol: str | None = Query(default=None, description="Optional coin to filter to, e.g. BTC-USD"),
) -> dict[str, Any]:
    """Keyless crypto-native news firehose (CoinDesk/Cointelegraph/Decrypt).

    Unfiltered by default (browsable crypto news); pass a crypto symbol to narrow
    the firehose to a single coin."""
    firehose = await _fetch_crypto_rss(limit=max(limit, 80))
    sym = (symbol or "").strip().upper() or None
    if sym and _is_crypto_symbol(sym):
        firehose = _filter_crypto_rss(firehose, sym)
    return {"items": firehose[:limit]}


@router.get("/news/sentiment/market")
async def get_market_sentiment(
    days: int = Query(default=7, ge=1, le=30),
    market: str | None = Query(default=None, description="Optional market context e.g. NSE/BSE/NASDAQ"),
) -> dict[str, Any]:
    market_code = (market or "").strip().upper()
    cache_key = cache_instance.build_key("news_latest", "sentiment:market", {"days": days, "market": market_code})
    cached = await cache_instance.get(cache_key)
    if cached:
        return cached

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    cutoff_iso = cutoff.isoformat()

    db = SessionLocal()
    try:
        rows = (
            db.query(NewsArticle)
            .filter(NewsArticle.published_at >= cutoff_iso)
            .order_by(desc(NewsArticle.published_at))
            .limit(800)
            .all()
        )
    except OperationalError:
        rows = []
    finally:
        db.close()

    ticker_set: set[str] = set()
    row_tickers: list[list[str]] = []
    for row in rows:
        tickers: list[str] = []
        try:
            parsed = json.loads(row.tickers or "[]")
            if isinstance(parsed, list):
                tickers = [str(v).split(".")[0].strip().upper() for v in parsed if str(v).strip()]
        except Exception:
            tickers = []
        row_tickers.append(tickers)
        ticker_set.update(tickers[:4])

    ticker_to_sector: dict[str, str] = {}
    if ticker_set:
        sem = asyncio.Semaphore(12)

        async def _fetch_sector(sym: str) -> tuple[str, str]:
            async with sem:
                snap = await fetch_stock_snapshot_coalesced(sym)
                sector = str((snap or {}).get("sector") or "Unknown").strip() or "Unknown"
                return sym, sector

        resolved = await asyncio.gather(*[_fetch_sector(sym) for sym in list(ticker_set)[:200]])
        ticker_to_sector = {sym: sector for sym, sector in resolved}

    agg: dict[str, dict[str, Any]] = {}
    for idx, row in enumerate(rows):
        sentiment = _row_sentiment(row)
        score = float(sentiment.get("score", 0.0))
        label = str(sentiment.get("label") or _label_from_score(score))
        tickers = row_tickers[idx]
        sector = "Unknown"
        for t in tickers:
            s = ticker_to_sector.get(t)
            if s:
                sector = s
                break
        node = agg.setdefault(
            sector,
            {
                "sector": sector,
                "articles_count": 0,
                "avg_sentiment": 0.0,
                "bullish_count": 0,
                "bearish_count": 0,
                "neutral_count": 0,
                "sum_score": 0.0,
            },
        )
        node["articles_count"] += 1
        node["sum_score"] += score
        if label == "Bullish":
            node["bullish_count"] += 1
        elif label == "Bearish":
            node["bearish_count"] += 1
        else:
            node["neutral_count"] += 1

    sectors = []
    for row in agg.values():
        count = int(row["articles_count"]) or 1
        avg = float(row["sum_score"]) / count
        sectors.append(
            {
                "sector": row["sector"],
                "articles_count": int(row["articles_count"]),
                "avg_sentiment": round(avg, 4),
                "bullish_count": int(row["bullish_count"]),
                "bearish_count": int(row["bearish_count"]),
                "neutral_count": int(row["neutral_count"]),
            }
        )
    sectors.sort(key=lambda x: x["articles_count"], reverse=True)

    payload = {
        "period_days": days,
        "market": market_code or "ALL",
        "sectors": sectors,
    }
    await cache_instance.set(
        cache_key,
        payload,
        ttl=ttl_seconds("news_latest", market_open_now()),
    )
    return payload


@router.get("/news/sentiment/summary")
async def get_news_sentiment_summary(
    days: int = Query(default=7, ge=1, le=30),
    limit: int = Query(default=200, ge=20, le=1000),
) -> dict[str, Any]:
    cache_key = cache_instance.build_key("news_latest", "sentiment:summary", {"days": days, "limit": limit})
    cached = await cache_instance.get(cache_key)
    if cached:
        return cached

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    cutoff_iso = cutoff.isoformat()

    db = SessionLocal()
    try:
        rows = (
            db.query(NewsArticle)
            .filter(NewsArticle.published_at >= cutoff_iso)
            .order_by(desc(NewsArticle.published_at))
            .limit(limit)
            .all()
        )
    except OperationalError:
        rows = []
    finally:
        db.close()

    if not rows:
        fallback_items = await _fallback_latest_news(limit=min(200, limit))
        labels = {"Bullish": 0, "Bearish": 0, "Neutral": 0}
        scores: list[float] = []
        for item in fallback_items:
            sent = item.get("sentiment") if isinstance(item, dict) else {}
            score = float((sent or {}).get("score", 0.0))
            label = str((sent or {}).get("label") or _label_from_score(score))
            if label not in labels:
                label = _label_from_score(score)
            labels[label] += 1
            scores.append(score)
        total = len(scores)
        avg = (sum(scores) / total) if total else 0.0
        payload = {
            "period_days": days,
            "total_articles": total,
            "average_score": round(avg, 4),
            "overall_label": _label_from_score(avg),
            "distribution": {
                "bullish_pct": round((labels["Bullish"] * 100.0 / total), 1) if total else 0.0,
                "bearish_pct": round((labels["Bearish"] * 100.0 / total), 1) if total else 0.0,
                "neutral_pct": round((labels["Neutral"] * 100.0 / total), 1) if total else 0.0,
            },
            "top_sources": [],
        }
        await cache_instance.set(cache_key, payload, ttl=ttl_seconds("news_latest", market_open_now()))
        return payload

    source_counts: dict[str, int] = defaultdict(int)
    labels = {"Bullish": 0, "Bearish": 0, "Neutral": 0}
    scores: list[float] = []
    for row in rows:
        source_counts[str(row.source or "Unknown").strip() or "Unknown"] += 1
        sentiment = _row_sentiment(row)
        score = float(sentiment.get("score", 0.0))
        label = str(sentiment.get("label") or _label_from_score(score))
        if label not in labels:
            label = _label_from_score(score)
        labels[label] += 1
        scores.append(score)

    total = len(scores)
    avg = (sum(scores) / total) if total else 0.0
    top_sources = [{"source": src, "count": count} for src, count in sorted(source_counts.items(), key=lambda kv: kv[1], reverse=True)[:10]]
    payload = {
        "period_days": days,
        "total_articles": total,
        "average_score": round(avg, 4),
        "overall_label": _label_from_score(avg),
        "distribution": {
            "bullish_pct": round((labels["Bullish"] * 100.0 / total), 1) if total else 0.0,
            "bearish_pct": round((labels["Bearish"] * 100.0 / total), 1) if total else 0.0,
            "neutral_pct": round((labels["Neutral"] * 100.0 / total), 1) if total else 0.0,
        },
        "top_sources": top_sources,
    }
    await cache_instance.set(cache_key, payload, ttl=ttl_seconds("news_latest", market_open_now()))
    return payload


@router.get("/news/sentiment/{ticker}")
async def get_news_sentiment(
    ticker: str,
    days: int = Query(default=7, ge=1, le=30),
    market: str | None = Query(default=None, description="Optional market context e.g. NSE/BSE/NASDAQ"),
) -> dict[str, Any]:
    if not isinstance(market, str):
        market = None
    symbol = ticker.strip().upper()
    market_code = (market or "").strip().upper() or None
    cache_key = cache_instance.build_key("news_latest", f"sentiment:{symbol}", {"days": days, "market": market_code or ""})
    cached = await cache_instance.get(cache_key)
    if cached:
        return cached

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    cutoff_iso = cutoff.isoformat()

    # Crypto is special-cased: the ingestor's DB ticker tags for coins are
    # unreliable (loose name-proxy searches historically mis-tagged unrelated
    # equities as a coin — see /news/by-ticker), so a coin's sentiment must NOT be
    # read from DB rows. Skip straight to the live blended crypto feed below.
    # Equities/indices keep the DB-first path.
    rows: list[NewsArticle] = []
    if not _is_crypto_symbol(symbol):
        db = SessionLocal()
        try:
            aliases = _ticker_aliases(symbol, market_code)
            ticker_filters = [NewsArticle.tickers.like(f'%"{alias}"%') for alias in aliases]
            rows = (
                db.query(NewsArticle)
                .filter(or_(*ticker_filters), NewsArticle.published_at >= cutoff_iso)
                .order_by(desc(NewsArticle.published_at))
                .all()
            )
        except OperationalError:
            rows = []
        finally:
            db.close()

    bullish = 0
    bearish = 0
    neutral = 0
    sum_score = 0.0
    day_buckets: dict[str, list[float]] = defaultdict(list)

    if rows:
        total = len(rows)
        for row in rows:
            sentiment = _row_sentiment(row)
            score = float(sentiment.get("score", 0.0))
            label = str(sentiment.get("label") or _label_from_score(score))
            if label == "Bullish":
                bullish += 1
            elif label == "Bearish":
                bearish += 1
            else:
                neutral += 1
            sum_score += score

            day = _to_day(row.published_at)
            if day:
                day_buckets[day].append(score)
    else:
        # No usable DB rows → live feed. Crypto blends the keyless crypto-native
        # firehose (CoinDesk/Cointelegraph/Decrypt, filtered to the coin) so its
        # sentiment reflects real coin coverage rather than junk-tagged DB rows;
        # everything else takes the first web-search term that yields.
        news_limit = max(20, days * 8)
        fallback_items: list[dict[str, Any]] = []
        if _is_crypto_symbol(symbol):
            fallback_items = await _fetch_ticker_news(symbol, market_code, limit=news_limit)
        else:
            for term in _ticker_fallback_terms(symbol, market_code):
                fallback_items = await _fetch_news_fallback(term, limit=news_limit)
                if fallback_items:
                    break
        total = len(fallback_items)
        for item in fallback_items:
            sent = item.get("sentiment") if isinstance(item, dict) else {}
            score = float((sent or {}).get("score", 0.0))
            label = str((sent or {}).get("label") or _label_from_score(score))
            if label == "Bullish":
                bullish += 1
            elif label == "Bearish":
                bearish += 1
            else:
                neutral += 1
            sum_score += score
            day = _to_day(str(item.get("published_at") or ""))
            if day:
                day_buckets[day].append(score)

    avg_score = (sum_score / total) if total else 0.0
    daily_sentiment = [
        {
            "date": d,
            "avg_score": round(sum(vals) / len(vals), 4),
            "count": len(vals),
        }
        for d, vals in sorted(day_buckets.items())
    ]

    payload = {
        "ticker": symbol,
        "period_days": days,
        "total_articles": total,
        "average_score": round(avg_score, 4),
        "bullish_pct": round((bullish * 100.0 / total), 1) if total else 0.0,
        "bearish_pct": round((bearish * 100.0 / total), 1) if total else 0.0,
        "neutral_pct": round((neutral * 100.0 / total), 1) if total else 0.0,
        "overall_label": _label_from_score(avg_score),
        "daily_sentiment": daily_sentiment,
    }
    await cache_instance.set(
        cache_key,
        payload,
        ttl=ttl_seconds("news_latest", market_open_now()),
    )
    return payload
