from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)


class CoinGeckoClient:
    """Thin async client for the CoinGecko REST API.

    Works against the keyless public API by default. If a demo API key is
    configured (``COINGECKO_API_KEY`` / settings), it is sent as the
    ``x-cg-demo-api-key`` header, which raises the free rate limits.

    All methods degrade gracefully: network errors, rate limits (HTTP 429),
    and unexpected payloads return an empty result rather than raising.
    """

    BASE_URL = "https://api.coingecko.com/api/v3"

    def __init__(self, api_key: Optional[str] = None, timeout: float = 10.0) -> None:
        self.api_key = (api_key if api_key is not None else os.getenv("COINGECKO_API_KEY", "")) or ""
        self.timeout = timeout
        self.client: Optional[httpx.AsyncClient] = None

    async def initialize(self) -> None:
        if self.client:
            return
        headers = {"accept": "application/json"}
        if self.api_key:
            headers["x-cg-demo-api-key"] = self.api_key
        self.client = httpx.AsyncClient(
            timeout=self.timeout,
            headers=headers,
            trust_env=False,
            follow_redirects=True,
        )

    async def close(self) -> None:
        if self.client:
            await self.client.aclose()
            self.client = None

    async def _get(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> Any:
        if not self.client:
            await self.initialize()
        try:
            resp = await self.client.get(f"{self.BASE_URL}{endpoint}", params=params or {})
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            sc = e.response.status_code
            if sc == 429:
                logger.warning("CoinGecko rate limited (429) on %s", endpoint)
            else:
                logger.warning("CoinGecko request failed (HTTP %s): %s", sc, endpoint)
            return None
        except Exception as e:  # noqa: BLE001
            logger.warning("CoinGecko request error for %s: %s", endpoint, e)
            return None
        try:
            return resp.json()
        except ValueError:
            logger.warning("CoinGecko non-JSON response for %s", endpoint)
            return None

    async def get_markets(
        self,
        *,
        vs_currency: str = "usd",
        per_page: int = 250,
        page: int = 1,
        order: str = "market_cap_desc",
        sparkline: bool = False,
    ) -> List[Dict[str, Any]]:
        """Return a page of /coins/markets rows ordered by market cap (desc)."""
        data = await self._get(
            "/coins/markets",
            {
                "vs_currency": vs_currency,
                "order": order,
                "per_page": max(1, min(250, per_page)),
                "page": max(1, page),
                "price_change_percentage": "24h",
                "sparkline": "true" if sparkline else "false",
            },
        )
        return data if isinstance(data, list) else []

    async def get_market_by_id(self, coin_id: str, *, vs_currency: str = "usd") -> Optional[Dict[str, Any]]:
        """Return the ``/coins/markets`` row for a single coin id (supply, FDV, ATH...), or None."""
        cid = (coin_id or "").strip().lower()
        if not cid:
            return None
        data = await self._get(
            "/coins/markets",
            {
                "vs_currency": vs_currency,
                "ids": cid,
                "per_page": 1,
                "page": 1,
                "price_change_percentage": "24h",
                "sparkline": "false",
            },
        )
        if isinstance(data, list) and data and isinstance(data[0], dict):
            return data[0]
        return None

    async def get_ohlc(
        self,
        coin_id: str,
        *,
        days: Any = 365,
        vs_currency: str = "usd",
    ) -> List[List[float]]:
        """Return OHLC candles for a coin: ``[[ts_ms, open, high, low, close], ...]``.

        CoinGecko's public ``/coins/{id}/ohlc`` accepts a fixed set of ``days``
        values and picks the candle granularity automatically (no volume). Used
        as the chart source for coins Yahoo doesn't cover.
        """
        cid = (coin_id or "").strip().lower()
        if not cid:
            return []
        data = await self._get(
            f"/coins/{cid}/ohlc",
            {"vs_currency": vs_currency, "days": str(days)},
        )
        return data if isinstance(data, list) else []

    async def get_global(self) -> Dict[str, Any]:
        """Return the /global ``data`` object (market cap %, totals)."""
        data = await self._get("/global")
        if isinstance(data, dict) and isinstance(data.get("data"), dict):
            return data["data"]
        return {}
