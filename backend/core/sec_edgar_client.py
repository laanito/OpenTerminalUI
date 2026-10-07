"""Opt-in, politely paced SEC EDGAR Company Facts reader."""

from __future__ import annotations

import asyncio
import os
import time
from typing import Any

import httpx


class SecEdgarClient:
    def __init__(self, user_agent: str | None = None, transport: httpx.AsyncBaseTransport | None = None,
                 pace_seconds: float = 0.5) -> None:
        self.user_agent = (user_agent if user_agent is not None else os.getenv("SEC_USER_AGENT", "")).strip()
        self.transport = transport
        self.pace_seconds = pace_seconds
        self._lock = asyncio.Lock()
        self._last_request = 0.0
        self._ticker_cache: tuple[float, Any] | None = None
        self._facts_cache: dict[int, tuple[float, Any]] = {}

    @property
    def configured(self) -> bool:
        return bool(self.user_agent)

    async def _get(self, url: str) -> dict[str, Any]:
        if not self.configured:
            raise RuntimeError("SEC user agent is not configured")
        async with self._lock:
            remaining = self.pace_seconds - (time.monotonic() - self._last_request)
            if remaining > 0:
                await asyncio.sleep(remaining)
            # Process-local pacing is not a shared-IP rate limiter across workers.
            self._last_request = time.monotonic()
            async with httpx.AsyncClient(timeout=15, transport=self.transport, trust_env=False,
                                         headers={"User-Agent": self.user_agent, "Accept": "application/json"}) as client:
                response = await client.get(url)
                response.raise_for_status()
                payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("Unexpected SEC response")
        return payload

    async def ticker_ciks(self, symbol: str) -> list[int]:
        now = time.monotonic()
        if self._ticker_cache is None or now - self._ticker_cache[0] > 86400:
            self._ticker_cache = (now, await self._get("https://www.sec.gov/files/company_tickers.json"))
        values = self._ticker_cache[1].values()
        return sorted({row["cik_str"] for row in values if isinstance(row, dict)
                       and isinstance(row.get("ticker"), str) and row["ticker"].upper() == symbol
                       and type(row.get("cik_str")) is int and row["cik_str"] > 0})

    async def company_facts(self, cik: int) -> dict[str, Any]:
        now = time.monotonic()
        cached = self._facts_cache.get(cik)
        if cached is not None and now - cached[0] <= 1800:
            return cached[1]
        payload = await self._get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json")
        if len(self._facts_cache) >= 4:
            self._facts_cache.pop(next(iter(self._facts_cache)))
        self._facts_cache[cik] = (now, payload)
        return payload


_client = SecEdgarClient()


def get_sec_edgar_client() -> SecEdgarClient:
    return _client
