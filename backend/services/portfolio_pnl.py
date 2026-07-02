"""Realized P&L from the transaction ledger — capital gains, done correctly.

The old analytics summed sell *proceeds* (`shares * price - fees`) and called it
"realized P&L", which massively overstates it: selling $1,000 of stock bought for
$990 booked $1,000 of "gains", not $10. Realized P&L is a *gain*, so it must
subtract the cost basis of the shares sold.

We recompute it by replaying the ledger chronologically per symbol, carrying a
running average cost. On each sell, the realized gain is
``shares_sold * (sell_price - avg_cost) - fees``. This is capital gains only;
dividend *income* is tracked separately (``dividend_income_ytd``).

Cost-basis convention matches the stored holding basis and the unrealized calc:
average cost is **fee-exclusive** (buy fees only move cash, via the cash ledger),
so realized and unrealized use the same definition and stay comparable.

Pure and testable: takes any objects exposing
``type``/``symbol``/``shares``/``price``/``fees``/``date``/``created_at``.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable


def _sort_key(tx: Any) -> tuple[datetime, datetime]:
    """Chronological order: transaction date, then insertion time as tiebreak."""
    epoch = datetime.min
    try:
        d = datetime.fromisoformat(str(getattr(tx, "date", "") or ""))
    except Exception:
        d = epoch
    created = getattr(tx, "created_at", None)
    if not isinstance(created, datetime):
        created = epoch
    return (d, created)


def realized_pnl(transactions: Iterable[Any]) -> float:
    """Total realized capital gains across all sells (dividends excluded)."""
    # symbol -> [quantity, average_cost_per_share]
    positions: dict[str, list[float]] = {}
    realized = 0.0

    for tx in sorted(transactions, key=_sort_key):
        t = (getattr(tx, "type", "") or "").strip().lower()
        symbol = (getattr(tx, "symbol", "") or "").strip().upper()
        shares = float(getattr(tx, "shares", 0.0) or 0.0)
        price = float(getattr(tx, "price", 0.0) or 0.0)
        fees = float(getattr(tx, "fees", 0.0) or 0.0)

        if t == "buy" and shares > 0:
            qty, avg = positions.get(symbol, [0.0, 0.0])
            new_qty = qty + shares
            # Fee-exclusive running average, matching the stored holding basis.
            avg = (qty * avg + shares * price) / new_qty if new_qty > 0 else 0.0
            positions[symbol] = [new_qty, avg]
        elif t == "sell" and shares > 0:
            qty, avg = positions.get(symbol, [0.0, 0.0])
            realized += shares * (price - avg) - fees
            remaining = qty - shares
            # Average cost is unchanged by a sell; drop the lot once flat/short.
            positions[symbol] = [remaining, avg] if remaining > 1e-9 else [0.0, 0.0]

    return realized
