from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, List, Dict, Optional

import httpx

logger = logging.getLogger(__name__)
_US_SYMBOLS_CACHE: set[str] | None = None


def _known_us_symbols() -> set[str]:
    global _US_SYMBOLS_CACHE
    if _US_SYMBOLS_CACHE is not None:
        return _US_SYMBOLS_CACHE
    data_dir = Path(__file__).resolve().parents[1] / "data"
    out: set[str] = set()
    for name in ("us_sp500_symbols.txt", "us_nasdaq100_symbols.txt", "us_all_symbols.txt"):
        path = data_dir / name
        if not path.exists():
            continue
        out.update(line.strip().upper() for line in path.read_text(encoding="utf-8").splitlines() if line.strip())
    _US_SYMBOLS_CACHE = out
    return out

class FMPClient:
    # FMP retired the legacy /api/v3 (and /api/v4) endpoints on 2025-08-31 for
    # accounts created after that date — they now return a "Legacy Endpoint"
    # error. The current API lives under /stable and takes the symbol as a
    # query parameter (?symbol=) rather than a path segment.
    BASE_URL = "https://financialmodelingprep.com/stable"

    def __init__(self, api_key: Optional[str] = None, timeout: float = 12.0):
        self.api_key = api_key or os.getenv("FMP_API_KEY", "")
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
        # Pass the symbol through as-is. Callers that want a specific exchange
        # must supply the suffix explicitly (e.g. RELIANCE.NS, SAP.DE). We no
        # longer force `.NS` on bare symbols — that mis-routed US/EU tickers to
        # the Indian exchange.
        return symbol.strip().upper()

    async def _get(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> Any:
        if self.disabled:
            return []
        if not self.api_key:
            return []

        if not self.client:
            await self.initialize()

        p = dict(params or {})
        p["apikey"] = self.api_key

        try:
            url = f"{self.BASE_URL}{endpoint}"
            response = await self.client.get(url, params=p)
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            sc = e.response.status_code
            if sc in (401, 403):
                # Bad/invalid key — disable for the rest of the session.
                logger.error("FMP API key invalid or unauthorized (HTTP %s); disabling FMP", sc)
                self.disabled = True
            elif sc == 402:
                # Endpoint/symbol not included in the current plan (e.g. free
                # tier). Expected — caller falls back to another provider.
                logger.debug("FMP endpoint requires a paid plan (HTTP 402): %s", endpoint)
            else:
                logger.warning("FMP request failed (HTTP %s): %s", sc, endpoint)
            return []
        except Exception as e:
            logger.warning("FMP request error for %s: %s", endpoint, e)
            return []

        # Plan-restricted responses sometimes arrive as HTTP 200 with a plain
        # (non-JSON) message like "Premium Query Parameter ..." or "Restricted
        # Endpoint ...". Treat any non-JSON / error payload as empty.
        try:
            data = response.json()
        except ValueError:
            logger.debug("FMP non-JSON response for %s (likely a plan restriction)", endpoint)
            return []
        if isinstance(data, dict) and ("Error Message" in data or "Error" in data):
            logger.debug("FMP error payload for %s: %s", endpoint, data.get("Error Message") or data.get("Error"))
            return []
        return data

    async def get_quote(self, symbol: str) -> Dict[str, Any]:
        data = await self._get("/quote", {"symbol": self._symbol(symbol)})
        return data[0] if data and isinstance(data, list) else {}

    async def get_historical_price_full(self, symbol: str) -> Dict[str, Any]:
        # Stable returns a flat array; wrap it in the legacy
        # {"symbol", "historical": [...]} shape that existing callers expect.
        sym = self._symbol(symbol)
        rows = await self._get("/historical-price-eod/full", {"symbol": sym})
        if isinstance(rows, dict):
            return rows  # already wrapped (defensive)
        return {"symbol": sym, "historical": rows if isinstance(rows, list) else []}

    async def get_income_statement(self, symbol: str, period: str = "annual", limit: int = 10) -> List[Dict[str, Any]]:
        return await self._get("/income-statement", {"symbol": self._symbol(symbol), "period": period, "limit": limit})

    async def get_balance_sheet(self, symbol: str, period: str = "annual", limit: int = 10) -> List[Dict[str, Any]]:
        return await self._get("/balance-sheet-statement", {"symbol": self._symbol(symbol), "period": period, "limit": limit})

    async def get_cash_flow(self, symbol: str, period: str = "annual", limit: int = 10) -> List[Dict[str, Any]]:
        return await self._get("/cash-flow-statement", {"symbol": self._symbol(symbol), "period": period, "limit": limit})

    async def get_key_metrics_ttm(self, symbol: str) -> List[Dict[str, Any]]:
        return await self._get("/key-metrics-ttm", {"symbol": self._symbol(symbol)})

    async def get_ratios_ttm(self, symbol: str) -> List[Dict[str, Any]]:
        return await self._get("/ratios-ttm", {"symbol": self._symbol(symbol)})

    async def get_financial_growth(self, symbol: str, limit: int = 10) -> List[Dict[str, Any]]:
        return await self._get("/financial-growth", {"symbol": self._symbol(symbol), "limit": limit})

    async def get_dcf(self, symbol: str) -> List[Dict[str, Any]]:
        return await self._get("/discounted-cash-flow", {"symbol": self._symbol(symbol)})

    async def get_profile(self, symbol: str) -> Dict[str, Any]:
        data = await self._get("/profile", {"symbol": self._symbol(symbol)})
        return data[0] if data and isinstance(data, list) else {}

    async def get_institutional_holders(self, symbol: str, limit: int = 50) -> List[Dict[str, Any]]:
        # Paid plans only on the stable API; returns [] gracefully on free tier.
        rows = await self._get("/institutional-ownership/extract", {"symbol": self._symbol(symbol)})
        return rows[:limit] if isinstance(rows, list) else []

    async def get_analyst_estimates(self, symbol: str, limit: int = 20) -> List[Dict[str, Any]]:
        rows = await self._get("/analyst-estimates", {"symbol": self._symbol(symbol), "limit": limit})
        return rows if isinstance(rows, list) else []

    async def get_esg_data(self, symbol: str, limit: int = 20) -> List[Dict[str, Any]]:
        # Paid plans only on the stable API; returns [] gracefully on free tier.
        rows = await self._get("/esg-disclosures", {"symbol": self._symbol(symbol), "limit": limit})
        return rows if isinstance(rows, list) else []
