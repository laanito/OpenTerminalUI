from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from backend.api.deps import get_unified_fetcher
from backend.services.depth_view import market_depth_to_wire

router = APIRouter(prefix="/depth", tags=["depth"])


class DepthLevelResponse(BaseModel):
    price: float
    quantity: float
    size: float
    orders: int
    cumulative_qty: float


class DepthSnapshotResponse(BaseModel):
    symbol: str
    market: str
    provider_key: str
    as_of: datetime
    mid_price: float
    spread: float
    spread_pct: float
    tick_size: float
    levels: int
    total_bid_quantity: float
    total_ask_quantity: float
    total_bid_qty: float
    total_ask_qty: float
    last_price: float
    last_qty: float
    imbalance: float
    bids: list[DepthLevelResponse] = Field(default_factory=list)
    asks: list[DepthLevelResponse] = Field(default_factory=list)
    degraded: dict | None = None


@router.get("/{symbol}", response_model=DepthSnapshotResponse)
async def get_depth_snapshot(
    symbol: str,
    market: str = Query(default="US"),
    levels: int = Query(default=20, ge=1, le=40),
) -> Any:
    # Real depth via the unified fetcher (Binance for crypto, Kite/NSE for India);
    # US/EU equity has no live L2 source yet → empty + degraded (no fabrication).
    fetcher = await get_unified_fetcher()
    depth = await fetcher.fetch_depth(symbol.strip().upper(), levels=levels, market_hint=market)
    return market_depth_to_wire(depth, levels)
