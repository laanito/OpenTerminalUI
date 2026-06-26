from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable, Literal


HotlistType = Literal[
    "gainers",
    "losers",
    "most_active",
    "52w_high",
    "52w_low",
    "gap_up",
    "gap_down",
    "unusual_volume",
]
MarketType = Literal["IN", "US"]

VALID_LIST_TYPES: tuple[HotlistType, ...] = (
    "gainers",
    "losers",
    "most_active",
    "52w_high",
    "52w_low",
    "gap_up",
    "gap_down",
    "unusual_volume",
)

# Hotlists previously served a hardcoded universe with fabricated prices/volumes
# and seeded sparklines — fake "gainers/losers" presented as live market data
# (v1.0 silent-mock audit). Computing real hotlists needs a screener feed with
# volume, 52-week, and gap data, which `QuoteResponse` does not carry. Until that
# source is wired, every list returns empty and the route flags it degraded.


class HotlistService:
    def __init__(self, *, now_factory: Callable[[], datetime] | None = None) -> None:
        self._now_factory = now_factory or (lambda: datetime.now(timezone.utc))

    def _now(self) -> datetime:
        now = self._now_factory()
        if now.tzinfo is None:
            return now.replace(tzinfo=timezone.utc)
        return now.astimezone(timezone.utc)

    def _is_market_hours(self, market: MarketType) -> bool:
        now = self._now()
        if now.weekday() >= 5:
            return False
        # Approximation in UTC: IN ~03:45-10:15 UTC, US ~14:30-21:00 UTC.
        minutes = now.hour * 60 + now.minute
        if market == "IN":
            return 225 <= minutes <= 615
        return 870 <= minutes <= 1260

    def _ttl_seconds(self, market: MarketType) -> int:
        return 5 if self._is_market_hours(market) else 300

    def _validate(self, list_type: str, market: str, limit: int) -> tuple[HotlistType, MarketType, int]:
        normalized_type = str(list_type or "").strip().lower()
        if normalized_type not in VALID_LIST_TYPES:
            raise ValueError(f"unsupported list_type: {list_type}")
        normalized_market = str(market or "").strip().upper()
        if normalized_market not in {"IN", "US"}:
            raise ValueError(f"unsupported market: {market}")
        safe_limit = max(1, min(int(limit), 50))
        return normalized_type, normalized_market, safe_limit  # type: ignore[return-value]

    async def get_hotlist(self, list_type: str, market: str = "US", limit: int = 20) -> list[dict]:
        # Validate (raises ValueError -> 400 for bad inputs); no live source, so
        # return empty rather than fabricated movers.
        self._validate(list_type, market, limit)
        return []


_SERVICE = HotlistService()


def get_hotlist_service() -> HotlistService:
    return _SERVICE
