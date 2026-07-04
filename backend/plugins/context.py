from __future__ import annotations

from typing import Any

from backend.api.deps import fetch_stock_snapshot_coalesced, get_unified_fetcher


class PluginContextImpl:
    def __init__(self, db_factory, permissions: set[str]) -> None:
        self.permissions = permissions
        self._db_factory = db_factory

    def _check(self, perm: str) -> None:
        if perm not in self.permissions:
            raise PermissionError(f"Plugin permission denied: {perm}")

    async def get_quote(self, symbol: str) -> dict[str, Any]:
        self._check("read_quotes")
        return await fetch_stock_snapshot_coalesced(symbol)

    async def get_history(self, symbol: str, range_str: str = "6mo", interval: str = "1d") -> dict[str, Any]:
        self._check("read_quotes")
        fetcher = await get_unified_fetcher()
        return await fetcher.fetch_history(symbol, range_str=range_str, interval=interval)

    async def create_alert(self, symbol: str, condition: str, value: float) -> dict[str, Any]:
        self._check("create_alerts")
        return {"symbol": symbol, "condition": condition, "threshold": value, "status": "created"}

    async def read_portfolio(self) -> dict[str, Any]:
        self._check("read_portfolio")
        # The global, shared-across-users portfolio was retired in v1.1. Plugins
        # are enabled process-wide with no per-user context, so there is no
        # portfolio to scope to here — returning empty rather than leaking every
        # user's holdings. (Re-wire once plugins carry a user identity.)
        return {"items": []}

    def log(self, message: str) -> None:
        print(f"[plugin] {message}")
