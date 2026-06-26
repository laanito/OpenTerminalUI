"""Presentation helper: render a :class:`MarketDepth` (from the unified fetcher's
real depth providers) into the rich order-book wire shape the depth REST route
and the ``/ws/depth`` stream emit.

Derived fields (mid price, spread, imbalance, cumulative quantity) are computed
from the real bids/asks rather than fabricated. When the book is empty the
derived fields are 0 and the original ``degraded`` marker is passed through, so
the UI shows "no live depth" instead of a fake ladder.
"""

from __future__ import annotations

from typing import Any

from backend.api.schemas.market_data import DepthLevel, MarketDepth


def _levels_wire(side: list[DepthLevel]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    running = 0.0
    for level in side:
        running += level.size
        out.append(
            {
                "price": level.price,
                "quantity": level.size,
                "size": level.size,
                "orders": int(level.orders or 0),
                "cumulative_qty": running,
            }
        )
    return out


def market_depth_to_wire(md: MarketDepth, levels: int) -> dict[str, Any]:
    bids = list(md.bids[:levels])
    asks = list(md.asks[:levels])

    best_bid = bids[0].price if bids else 0.0
    best_ask = asks[0].price if asks else 0.0
    if bids and asks:
        mid_price = (best_bid + best_ask) / 2.0
        spread = best_ask - best_bid
    else:
        mid_price = best_bid or best_ask or 0.0
        spread = 0.0
    spread_pct = (spread / mid_price * 100.0) if mid_price > 0 else 0.0

    total_bid = sum(b.size for b in bids)
    total_ask = sum(a.size for a in asks)
    total = total_bid + total_ask
    imbalance = ((total_bid - total_ask) / total) if total > 0 else 0.0

    provider_key = md.source or ("none" if md.degraded else "unknown")

    return {
        "symbol": md.symbol,
        "market": md.market,
        "provider_key": provider_key,
        "as_of": md.as_of.isoformat(),
        "mid_price": mid_price,
        "spread": spread,
        "spread_pct": spread_pct,
        "tick_size": 0.0,
        "levels": levels,
        "total_bid_quantity": total_bid,
        "total_ask_quantity": total_ask,
        "total_bid_qty": total_bid,
        "total_ask_qty": total_ask,
        "last_price": mid_price,
        "last_qty": 0.0,
        "imbalance": imbalance,
        "bids": _levels_wire(bids),
        "asks": _levels_wire(asks),
        "degraded": md.degraded,
    }
