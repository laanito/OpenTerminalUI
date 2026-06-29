from __future__ import annotations

import logging
import os
from datetime import date, timedelta
from typing import Any, Dict, List, Optional

import httpx

from backend.shared.cache import cache
from backend.shared.http_resilience import CircuitBreaker, CircuitOpenError, retry_request

logger = logging.getLogger(__name__)

# Persistent response-cache TTLs (seconds) by endpoint prefix, mirroring the FMP
# client: Finnhub's free tier is rate-limited, so successful responses are cached
# in the shared multi-tier cache (incl. SQLite L3) to avoid re-spending quota on
# identical requests. Errors are never cached. Slow-moving data gets long TTLs.
_FINNHUB_TTL_RULES: tuple[tuple[str, int], ...] = (
    ("/quote", 60),                       # live-ish price
    ("/stock/profile2", 86400),           # company profile — daily
    ("/stock/metric", 86400),             # basic financials
    ("/stock/recommendation", 86400),
    ("/stock/price-target", 43200),
    ("/stock/insider-transactions", 21600),  # 6h
    ("/company-news", 1800),              # 30m
    ("/news", 900),                       # 15m
)
_FINNHUB_TTL_DEFAULT = 3600  # 1h


def _finnhub_ttl_for(endpoint: str) -> int:
    for prefix, ttl in _FINNHUB_TTL_RULES:
        if endpoint.startswith(prefix):
            return ttl
    return _FINNHUB_TTL_DEFAULT


# One breaker shared across all Finnhub requests (see fmp_client for rationale).
_FINNHUB_BREAKER = CircuitBreaker(name="finnhub")


class FinnhubClient:
    BASE_URL = "https://finnhub.io/api/v1"

    def __init__(self, api_key: Optional[str] = None, timeout: float = 12.0):
        self.api_key = api_key or os.getenv("FINNHUB_API_KEY", "")
        self.timeout = timeout
        self.client: Optional[httpx.AsyncClient] = None
        self.disabled = False

    async def initialize(self):
        if self.client:
            return

        self.client = httpx.AsyncClient(
            timeout=self.timeout,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
            trust_env=False,
            follow_redirects=True,
        )

    async def close(self):
        if self.client:
            await self.client.aclose()
            self.client = None

    def _symbol(self, symbol: str) -> str:
        # Pass the symbol through as-is (matching FMPClient). We no longer force
        # `.NS` on bare symbols — that mis-routed US/EU tickers to the Indian
        # exchange, so profile/financials/recommendations came back empty for
        # e.g. AAPL (queried as AAPL.NS). Callers wanting a specific exchange
        # must supply the suffix explicitly.
        return symbol.strip().upper()

    async def _get(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> Any:
        if self.disabled:
            return {}
        if not self.api_key:
            return {}

        if not self.client:
            await self.initialize()

        p = dict(params or {})
        # Cache key excludes the token, so the same logical request maps to one
        # cache entry regardless of key.
        cache_key = cache.build_key("finnhub", endpoint, p)
        cached = await cache.get(cache_key)
        if cached is not None:
            return cached

        p["token"] = self.api_key

        try:
            url = f"{self.BASE_URL}{endpoint}"
            response = await retry_request(
                lambda: self.client.get(url, params=p), breaker=_FINNHUB_BREAKER
            )
            response.raise_for_status()
            data = response.json()
        except CircuitOpenError:
            logger.warning("Finnhub circuit open; skipping request: %s", endpoint)
            return {}
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 403 or e.response.status_code == 429:
                logger.warning(f"Finnhub Limit/Error: {e}")
                if e.response.status_code == 403:
                    self.disabled = True
            return {}
        except Exception as e:
            logger.error(f"Finnhub Request Error: {e}")
            return {}

        # Successful response (incl. a genuine empty result) — persist it.
        await cache.set(cache_key, data, ttl=_finnhub_ttl_for(endpoint))
        return data

    async def get_company_profile(self, symbol: str) -> Dict[str, Any]:
        return await self._get("/stock/profile2", {"symbol": self._symbol(symbol)})

    async def get_basic_financials(self, symbol: str) -> Dict[str, Any]:
        return await self._get("/stock/metric", {"symbol": self._symbol(symbol), "metric": "all"})

    async def get_recommendation_trends(self, symbol: str) -> List[Dict[str, Any]]:
        # Returns list of recommendation objects
        data = await self._get("/stock/recommendation", {"symbol": self._symbol(symbol)})
        return data if isinstance(data, list) else []

    async def get_price_target(self, symbol: str) -> Dict[str, Any]:
        return await self._get("/stock/price-target", {"symbol": self._symbol(symbol)})

    async def get_insider_transactions(self, symbol: str, limit: int = 10) -> Dict[str, Any]:
        return await self._get("/stock/insider-transactions", {"symbol": self._symbol(symbol), "limit": limit})

    async def get_quote(self, symbol: str) -> Dict[str, Any]:
        return await self._get("/quote", {"symbol": symbol.strip().upper()})

    async def get_company_news(self, symbol: str, limit: int = 30) -> List[Dict[str, Any]]:
        today = date.today()
        frm = (today - timedelta(days=14)).isoformat()
        to = today.isoformat()
        data = await self._get(
            "/company-news",
            {
                "symbol": symbol.strip().upper(),
                "from": frm,
                "to": to,
            },
        )
        if not isinstance(data, list):
            return []
        return data[:limit]

    async def get_market_news(self, category: str = "general", limit: int = 30) -> List[Dict[str, Any]]:
        data = await self._get("/news", {"category": category})
        if not isinstance(data, list):
            return []
        return data[:limit]
