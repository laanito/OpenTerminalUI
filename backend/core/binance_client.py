from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)


class BinanceClient:
    """Thin async client for Binance's public (keyless) REST endpoints.

    Two hosts are used: the spot API (``api.binance.com``) for top-of-book
    quotes, and the USDⓈ-M futures API (``fapi.binance.com``) for funding rates
    and open interest. No API key is required for any endpoint used here.

    Every method degrades gracefully: network errors, rate limits (HTTP 429),
    geo-blocks (HTTP 451) and unexpected payloads return an empty result rather
    than raising, so callers can fall back to a ``degraded`` marker.
    """

    SPOT_URL = "https://api.binance.com"
    FUTURES_URL = "https://fapi.binance.com"

    def __init__(self, timeout: float = 10.0) -> None:
        self.timeout = timeout
        self.client: Optional[httpx.AsyncClient] = None

    async def initialize(self) -> None:
        if self.client:
            return
        self.client = httpx.AsyncClient(
            timeout=self.timeout,
            headers={"accept": "application/json"},
            trust_env=False,
            follow_redirects=True,
        )

    async def close(self) -> None:
        if self.client:
            await self.client.aclose()
            self.client = None

    async def _get(self, base: str, endpoint: str, params: Optional[Dict[str, Any]] = None) -> Any:
        if not self.client:
            await self.initialize()
        try:
            resp = await self.client.get(f"{base}{endpoint}", params=params or {})
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            sc = e.response.status_code
            if sc == 429:
                logger.warning("Binance rate limited (429) on %s", endpoint)
            elif sc == 451:
                logger.warning("Binance geo-restricted (451) on %s", endpoint)
            else:
                logger.warning("Binance request failed (HTTP %s): %s", sc, endpoint)
            return None
        except Exception as e:  # noqa: BLE001
            logger.warning("Binance request error for %s: %s", endpoint, e)
            return None
        try:
            return resp.json()
        except ValueError:
            logger.warning("Binance non-JSON response for %s", endpoint)
            return None

    async def get_book_tickers(self) -> List[Dict[str, Any]]:
        """Return real top-of-book quotes for every spot symbol in one call.

        Each row is ``{symbol, bidPrice, bidQty, askPrice, askQty}`` (strings).
        This is the real order book's best level — used to compute genuine
        bid/ask depth notional and imbalance for the heatmap.
        """
        data = await self._get(self.SPOT_URL, "/api/v3/ticker/bookTicker")
        return data if isinstance(data, list) else []

    async def get_premium_index(self) -> List[Dict[str, Any]]:
        """Return the funding/mark-price index for every USDⓈ-M perp in one call.

        Each row is ``{symbol, markPrice, lastFundingRate, nextFundingTime, ...}``
        (strings). ``lastFundingRate`` is the real most-recent 8h funding rate.
        """
        data = await self._get(self.FUTURES_URL, "/fapi/v1/premiumIndex")
        return data if isinstance(data, list) else []

    async def get_open_interest(self, symbol: str) -> Optional[float]:
        """Return the real open interest (in base-asset contracts) for one perp.

        Binance has no bulk open-interest endpoint, so this is one call per
        symbol. Multiply by the mark price to get a USD notional. Returns None
        when the symbol has no perp or the request fails.
        """
        sym = (symbol or "").strip().upper()
        if not sym:
            return None
        data = await self._get(self.FUTURES_URL, "/fapi/v1/openInterest", {"symbol": sym})
        if isinstance(data, dict) and data.get("openInterest") is not None:
            try:
                return float(data["openInterest"])
            except (TypeError, ValueError):
                return None
        return None
