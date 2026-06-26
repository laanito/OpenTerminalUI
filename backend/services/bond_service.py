from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from backend.shared.degraded import (
    DEGRADED_KEY,
    REASON_NO_LIVE_SOURCE,
    degraded_marker,
)

logger = logging.getLogger(__name__)

# No live fixed-income data provider (RBI / FRED / paid feed) is wired yet.
# Rather than ship a hardcoded India-only bond universe that reads as live
# market data, every method returns an empty result flagged degraded. When a
# real source is added, populate these and drop the marker. See
# backend/shared/degraded.py and the v1.0 silent-mock audit.
_NO_SOURCE = lambda: degraded_marker(REASON_NO_LIVE_SOURCE)  # noqa: E731


class BondService:
    def __init__(self):
        pass

    async def get_bond_screener(
        self,
        maturity_min: Optional[float] = None,
        maturity_max: Optional[float] = None,
        rating: Optional[str] = None,
        issuer_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Filterable bond screener. No live source → empty + degraded."""
        return {"bonds": [], DEGRADED_KEY: _NO_SOURCE()}

    async def get_credit_spreads(self) -> Dict[str, Any]:
        """IG vs HY spread timeline. No live source → empty + degraded."""
        return {"history": [], DEGRADED_KEY: _NO_SOURCE()}

    async def get_ratings_migration(self) -> Dict[str, Any]:
        """Recent upgrades/downgrades. No live source → empty + degraded."""
        return {"migrations": [], DEGRADED_KEY: _NO_SOURCE()}


_bond_service: Optional[BondService] = None


def get_bond_service() -> BondService:
    global _bond_service
    if _bond_service is None:
        _bond_service = BondService()
    return _bond_service
