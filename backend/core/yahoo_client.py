from __future__ import annotations

import asyncio
import logging
from typing import Any, List, Dict, Optional

import httpx

from backend.shared.cache import cache
from backend.shared.http_resilience import CircuitBreaker, CircuitOpenError, retry_request

logger = logging.getLogger(__name__)

# Persistent response-cache TTLs (seconds), mirroring the FMP/Finnhub clients.
# Yahoo's public endpoints rate-limit (HTTP 429) under bursts, so successful
# responses are cached in the shared multi-tier cache to avoid re-fetching the
# same data. Quotes stay short; fundamentals/profile are slow-moving.
_YAHOO_TTL_QUOTE = 30           # batch quotes — live-ish
_YAHOO_TTL_SUMMARY = 21600      # quoteSummary modules (financials/profile) — 6h
_YAHOO_TTL_TIMESERIES = 86400   # historical fundamentals — daily
_YAHOO_TTL_SEARCH = 300         # news / symbol search — 5m
_YAHOO_TTL_CHART_INTRADAY = 300     # intraday bars update fast — 5m
_YAHOO_TTL_CHART_DAILY = 3600       # daily+ history is slow-moving — 1h

# One breaker shared across all Yahoo requests (see fmp_client for rationale).
_YAHOO_BREAKER = CircuitBreaker(name="yahoo")

# Yahoo's v8 chart API limits how much history it serves per request based on the
# bar granularity. Requesting, e.g., 1-minute bars over a 1-month range returns
# HTTP 422 ("Only 8 days worth of 1m granularity data are allowed to be fetched
# per request"). We clamp the requested range down to what the interval permits.
#
# Max days of history per request, by interval. Intervals not listed (1d and
# coarser) have no practical limit.
_INTERVAL_MAX_DAYS: Dict[str, int] = {
    "1m": 7,
    "2m": 60,
    "5m": 60,
    "15m": 60,
    "30m": 60,
    "60m": 730,
    "90m": 60,
    "1h": 730,
}

# Approximate span, in days, of each Yahoo `range` token.
_RANGE_DAYS: Dict[str, int] = {
    "1d": 1,
    "5d": 5,
    "1mo": 30,
    "3mo": 91,
    "6mo": 182,
    "1y": 365,
    "2y": 730,
    "5y": 1825,
    "10y": 3650,
    "ytd": 366,
    "max": 100000,
}
# Range tokens ordered by ascending span, for picking the largest one that fits.
_RANGE_TOKENS_BY_SPAN = sorted(_RANGE_DAYS.items(), key=lambda kv: kv[1])


def _clamp_range_for_interval(range_str: str, interval: str) -> str:
    """Return a `range` token compatible with `interval` for Yahoo's chart API.

    If the requested range exceeds what the interval allows, return the largest
    valid range token that fits; otherwise return the request unchanged.
    """
    max_days = _INTERVAL_MAX_DAYS.get(interval)
    if max_days is None:
        return range_str  # daily or coarser: no per-request limit
    requested_days = _RANGE_DAYS.get(range_str, 10**9)
    if requested_days <= max_days:
        return range_str
    clamped = range_str
    for token, span in _RANGE_TOKENS_BY_SPAN:
        if span <= max_days:
            clamped = token
    if clamped != range_str:
        logger.info(
            "Yahoo chart: clamped range %s -> %s for interval %s (max %d days)",
            range_str, clamped, interval, max_days,
        )
    return clamped


# Constants for Fundamental Timeseries modules
ANNUAL_MODULES = [
    "annualTotalRevenue",
    "annualNetIncome",
    "annualEbitda",
    "annualOperatingIncome",
    "annualDilutedEPS",
    "annualBasicEPS",
    "annualTotalExpenses",
    "annualGrossProfit",
    "annualCostOfRevenue",
    "annualPretaxIncome",
    "annualTaxProvision",
    "annualNetIncomeCommonStockholders",
    "annualDilutedAverageShares",
    "annualBasicAverageShares",
    "annualOperatingExpense",
    "annualTotalAssets",
    "annualTotalLiabilitiesNetMinorityInterest",
    "annualTotalEquityGrossMinorityInterest",
    "annualTotalCapitalization",
    "annualStockholdersEquity",
    "annualWorkingCapital",
    "annualInvestedCapital",
    "annualTangibleBookValue",
    "annualTotalDebt",
    "annualNetDebt",
    "annualShareIssued",
    "annualFreeCashFlow",
    "annualOperatingCashFlow",
    "annualInvestingCashFlow",
    "annualFinancingCashFlow",
    "annualCapitalExpenditure",
]

QUARTERLY_MODULES = [
    "quarterlyTotalRevenue",
    "quarterlyNetIncome",
    "quarterlyEbitda",
    "quarterlyOperatingIncome",
    "quarterlyDilutedEPS",
    "quarterlyBasicEPS",
    "quarterlyTotalExpenses",
    "quarterlyGrossProfit",
    "quarterlyCostOfRevenue",
    "quarterlyPretaxIncome",
    "quarterlyTaxProvision",
    "quarterlyNetIncomeCommonStockholders",
    "quarterlyDilutedAverageShares",
    "quarterlyBasicAverageShares",
    "quarterlyOperatingExpense",
    "quarterlyTotalAssets",
    "quarterlyTotalLiabilitiesNetMinorityInterest",
    "quarterlyTotalEquityGrossMinorityInterest",
    "quarterlyTotalCapitalization",
    "quarterlyStockholdersEquity",
    "quarterlyWorkingCapital",
    "quarterlyInvestedCapital",
    "quarterlyTangibleBookValue",
    "quarterlyTotalDebt",
    "quarterlyNetDebt",
    "quarterlyShareIssued",
    "quarterlyFreeCashFlow",
    "quarterlyOperatingCashFlow",
    "quarterlyInvestingCashFlow",
    "quarterlyFinancingCashFlow",
    "quarterlyCapitalExpenditure",
]

class YahooClient:
    def __init__(self, timeout_seconds: float = 10.0):
        self.timeout = timeout_seconds
        self.client: Optional[httpx.AsyncClient] = None
        self._crumb: Optional[str] = None

    async def initialize(self):
        if self.client:
            return

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "*/*",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
        }

        self.client = httpx.AsyncClient(
            http2=True,
            timeout=self.timeout,
            headers=headers,
            follow_redirects=True,
            trust_env=False,
            limits=httpx.Limits(max_connections=50, max_keepalive_connections=20)
        )

    async def close(self):
        if self.client:
            await self.client.aclose()
            self.client = None
        self._crumb = None

    async def _ensure_client(self):
        if not self.client:
            await self.initialize()

    async def _send(self, url: str, params: Optional[Dict[str, Any]] = None) -> httpx.Response:
        """GET with shared retry-on-429/5xx backoff + circuit breaker.

        401 is intentionally NOT retried here — callers handle it by refreshing
        the Yahoo crumb and re-issuing the request (also through this helper).
        """
        return await retry_request(
            lambda: self.client.get(url, params=params or {}),
            breaker=_YAHOO_BREAKER,
        )

    async def _ensure_crumb(self):
        """Fetch Yahoo cookie + crumb for authenticated API requests."""
        if self._crumb:
            return
        await self._ensure_client()
        try:
            # Visit fc.yahoo.com to obtain consent cookies (stored in httpx client jar)
            await self.client.get("https://fc.yahoo.com")
            # Use cookies to obtain a crumb token
            resp = await self.client.get("https://query2.finance.yahoo.com/v1/test/getcrumb")
            if resp.status_code == 200:
                self._crumb = resp.text.strip()
        except Exception as e:
            logger.warning(f"Failed to get Yahoo crumb: {e}")

    async def get_quotes(self, symbols: List[str]) -> List[Dict[str, Any]]:
        """
        Get real-time quotes for multiple symbols (automatically batched).
        """
        await self._ensure_client()

        # Deduplicate
        symbols = list(set(symbols))
        results = []

        # Chunk into batches of 20
        chunk_size = 20
        url = "https://query1.finance.yahoo.com/v7/finance/quote"
        for i in range(0, len(symbols), chunk_size):
            batch = symbols[i : i + chunk_size]
            # Cache per-batch (short TTL): a repeated watchlist refresh hits the
            # same batch and is served without re-querying Yahoo.
            cache_key = cache.build_key("yahoo:quote", ",".join(sorted(batch)), {})
            cached = await cache.get(cache_key)
            if cached is not None:
                results.extend(cached)
                continue
            try:
                params: Dict[str, str] = {"symbols": ",".join(batch)}
                response = await self._send(url, params)
                if response.status_code == 401:
                    self._crumb = None
                    await self._ensure_crumb()
                    if self._crumb:
                        params["crumb"] = self._crumb
                        response = await self._send(url, params)
                response.raise_for_status()
                data = response.json()
                quotes = (data.get("quoteResponse") or {}).get("result") or []
                await cache.set(cache_key, quotes, ttl=_YAHOO_TTL_QUOTE)
                results.extend(quotes)

            except CircuitOpenError:
                logger.warning("Yahoo circuit open; skipping quotes batch %s", batch)
            except Exception as e:
                logger.error(f"Failed to fetch Yahoo quotes for batch {batch}: {e}")

        return results

    async def get_quote_summary(self, symbol: str, modules: Optional[List[str]] = None) -> Dict[str, Any]:
        """Get comprehensive data from Yahoo quoteSummary v10 API."""
        await self._ensure_client()
        if modules is None:
            modules = ["financialData", "summaryDetail", "defaultKeyStatistics", "assetProfile"]
        cache_key = cache.build_key("yahoo:summary", symbol, {"modules": sorted(modules)})
        cached = await cache.get(cache_key)
        if cached is not None:
            return cached
        url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{symbol}"
        try:
            params: Dict[str, str] = {"modules": ",".join(modules)}
            response = await self._send(url, params)
            if response.status_code == 401:
                self._crumb = None
                await self._ensure_crumb()
                if self._crumb:
                    params["crumb"] = self._crumb
                    response = await self._send(url, params)
            response.raise_for_status()
            data = response.json()
            results = (data.get("quoteSummary") or {}).get("result") or [{}]
            out = results[0] if results else {}
            await cache.set(cache_key, out, ttl=_YAHOO_TTL_SUMMARY)
            return out
        except CircuitOpenError:
            logger.warning("Yahoo circuit open; skipping quoteSummary for %s", symbol)
            return {}
        except Exception as e:
            logger.warning(f"Yahoo quoteSummary failed for {symbol}: {e}")
            return {}

    async def get_chart(self, symbol: str, range_str: str = "1y", interval: str = "1d") -> Dict[str, Any]:
        """
        Get chart data (OHLCV) with dividends and splits.
        """
        await self._ensure_client()

        interval = (interval or "1d").strip()
        range_str = _clamp_range_for_interval((range_str or "1y").strip(), interval)

        cache_key = cache.build_key("yahoo:chart", symbol, {"range": range_str, "interval": interval})
        cached = await cache.get(cache_key)
        if cached is not None:
            return cached
        # Intraday bars move fast; daily+ history is slow-moving.
        ttl = _YAHOO_TTL_CHART_INTRADAY if interval in _INTERVAL_MAX_DAYS else _YAHOO_TTL_CHART_DAILY

        try:
            # v8/finance/chart
            response = await self._send(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}",
                {
                    "range": range_str,
                    "interval": interval,
                    "events": "div,splits",
                    "includePrePost": "false",
                },
            )
            response.raise_for_status()
            data = response.json()
            await cache.set(cache_key, data, ttl=ttl)
            return data
        except Exception as e:
            logger.error(f"Failed to fetch Yahoo chart for {symbol}: {e}")
            raise

    async def get_fundamentals_timeseries(self, symbol: str, period1: int = 946684800, period2: int = 1999999999) -> Dict[str, Any]:
        """
        Get historical fundamentals (revenue, eps, etc.).
        Combined wrapper for fetching both ANNUAL and QUARTERLY modules.
        """
        await self._ensure_client()

        cache_key = cache.build_key(
            "yahoo:timeseries", symbol, {"p1": period1, "p2": period2}
        )
        cached = await cache.get(cache_key)
        if cached is not None:
            return cached

        await self._ensure_crumb()

        all_modules = ANNUAL_MODULES + QUARTERLY_MODULES
        chunk_size = 5
        result_data = {}

        async def fetch_chunk(modules_chunk):
            try:
                params: Dict[str, Any] = {
                    "symbol": symbol,
                    "type": ",".join(modules_chunk),
                    "period1": period1,
                    "period2": period2,
                }
                if self._crumb:
                    params["crumb"] = self._crumb
                response = await self._send(
                    f"https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/{symbol}",
                    params,
                )
                if response.status_code == 200:
                    data = response.json()
                    ts_result = (data.get("timeseries") or {}).get("result") or []
                    return ts_result
            except Exception as e:
                logger.warning(f"Yahoo fundamental chunk failed: {e}")
            return []

        tasks = []
        for i in range(0, len(all_modules), chunk_size):
            chunk = all_modules[i : i + chunk_size]
            tasks.append(fetch_chunk(chunk))

        results_lists = await asyncio.gather(*tasks)

        # Merge results
        for lst in results_lists:
            for item in lst:
                meta = item.get("meta", {})
                start = item.get("timestamp", [])
                vals = []
                # Timeseries values are inside a dynamic key usually matching the type?
                # Actually usage is usually: item[type] (list of dicts)
                # But here the structure is:
                # { "meta": { "type": ["annualTotalRevenue"] }, "timestamp": [...], "annualTotalRevenue": [...] }
                t = meta.get("type", [])
                if t and len(t) > 0:
                    type_key = t[0]
                    if type_key in item:
                        result_data[type_key] = {
                            "timestamp": start,
                            "value": item[type_key]
                        }

        # Only cache a genuine (non-empty) result, so a transient all-chunks
        # failure isn't frozen in for a day.
        if result_data:
            await cache.set(cache_key, result_data, ttl=_YAHOO_TTL_TIMESERIES)
        return result_data

    async def get_asset_profile(self, symbol: str) -> Dict[str, Any]:
        """Get asset profile (sector, industry, description)."""
        summary = await self.get_quote_summary(symbol, ["assetProfile"])
        return summary.get("assetProfile", {})

    async def search_news(self, query: str, limit: int = 30) -> List[Dict[str, Any]]:
        """
        Query Yahoo Finance search endpoint and return raw news rows.
        This endpoint does not require API keys and works for broad queries.
        """
        await self._ensure_client()
        q = (query or "").strip()
        if not q:
            return []
        cache_key = cache.build_key("yahoo:news", q, {"limit": limit})
        cached = await cache.get(cache_key)
        if cached is not None:
            return cached
        url = "https://query1.finance.yahoo.com/v1/finance/search"
        params = {
            "q": q,
            "newsCount": max(1, min(limit, 100)),
            "quotesCount": 0,
            "listsCount": 0,
        }
        try:
            response = await self._send(url, params)
            if response.status_code == 401:
                self._crumb = None
                await self._ensure_crumb()
                if self._crumb:
                    params["crumb"] = self._crumb
                response = await self._send(url, params)
            response.raise_for_status()
            payload = response.json()
            rows = payload.get("news") if isinstance(payload, dict) else []
            if not isinstance(rows, list):
                return []
            out = [x for x in rows if isinstance(x, dict)][:limit]
            await cache.set(cache_key, out, ttl=_YAHOO_TTL_SEARCH)
            return out
        except CircuitOpenError:
            logger.warning("Yahoo circuit open; skipping news search for %s", q)
            return []
        except Exception as e:
            logger.warning(f"Yahoo news search failed for {q}: {e}")
            return []

    async def search_symbols(self, query: str, limit: int = 15) -> List[Dict[str, Any]]:
        """
        Query Yahoo Finance search endpoint and return ticker quotes.
        """
        await self._ensure_client()
        q = (query or "").strip()
        if not q or len(q) < 2:
            return []
        cache_key = cache.build_key("yahoo:symsearch", q, {"limit": limit})
        cached = await cache.get(cache_key)
        if cached is not None:
            return cached
        try:
            response = await self._send(
                "https://query2.finance.yahoo.com/v1/finance/search",
                {
                    "q": q,
                    "quotesCount": max(1, min(limit, 20)),
                    "newsCount": 0,
                    "listsCount": 0,
                },
            )
            response.raise_for_status()
            payload = response.json()
            quotes = payload.get("quotes") if isinstance(payload, dict) else []
            if not isinstance(quotes, list):
                return []
            out = [x for x in quotes if isinstance(x, dict)][:limit]
            await cache.set(cache_key, out, ttl=_YAHOO_TTL_SEARCH)
            return out
        except CircuitOpenError:
            logger.warning("Yahoo circuit open; skipping symbol search for %s", q)
            return []
        except Exception as e:
            logger.warning(f"Yahoo symbol search failed for {q}: {e}")
            return []
