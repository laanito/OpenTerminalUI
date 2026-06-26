from __future__ import annotations

import inspect
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel

from backend.adapters.registry import get_adapter_registry
from backend.shared.degraded import (
    DEGRADED_KEY,
    REASON_NO_PROVIDER_DATA,
    degraded_marker,
)

router = APIRouter(tags=["tape"])

DEFAULT_LIMIT = 500
MAX_LIMIT = 2_000


class TradeRecord(BaseModel):
    timestamp: str
    price: float
    quantity: int
    value: float
    side: str


def _utc_iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat()


def _guess_exchange(symbol: str) -> str:
    normalized = symbol.strip().upper()
    if ":" in normalized:
        return normalized.split(":", 1)[0]
    if normalized.endswith(".NS"):
        return "NSE"
    if normalized.endswith(".BO"):
        return "BSE"
    return "NSE"


def _normalized_symbol(symbol: str) -> str:
    raw = symbol.strip().upper()
    if ":" in raw:
        return raw
    exchange = _guess_exchange(raw)
    if exchange in {"NSE", "BSE"}:
        return f"{exchange}:{raw.removesuffix('.NS').removesuffix('.BO')}"
    return raw


async def _maybe_call_recent_trades(adapter: Any, symbol: str, limit: int) -> list[dict[str, Any]]:
    method = getattr(adapter, "get_recent_trades", None)
    if method is None:
        return []
    try:
        result = method(symbol, limit=limit)
        if inspect.isawaitable(result):
            result = await result
    except Exception:
        return []
    if not isinstance(result, list):
        return []
    return [row for row in result if isinstance(row, dict)]


def _coerce_trade_rows(rows: list[dict[str, Any]], limit: int) -> list[TradeRecord]:
    parsed: list[TradeRecord] = []
    previous_price: float | None = None
    for row in rows:
        raw_price = row.get("price") or row.get("last_price") or row.get("ltp")
        raw_qty = row.get("quantity") or row.get("size") or row.get("volume")
        if raw_price is None or raw_qty is None:
            continue
        try:
            price = round(float(raw_price), 2)
            quantity = max(1, int(float(raw_qty)))
        except (TypeError, ValueError):
            continue
        raw_ts = row.get("timestamp") or row.get("ts") or row.get("time")
        if isinstance(raw_ts, (int, float)):
            ts = datetime.fromtimestamp(float(raw_ts), tz=timezone.utc)
        elif isinstance(raw_ts, str):
            try:
                ts = datetime.fromisoformat(raw_ts.replace("Z", "+00:00"))
            except ValueError:
                ts = datetime.now(timezone.utc)
        else:
            ts = datetime.now(timezone.utc)
        raw_side = str(row.get("side") or "").lower()
        if raw_side in {"buy", "sell", "neutral"}:
            side = raw_side
        elif previous_price is None:
            side = "neutral"
        elif price > previous_price:
            side = "buy"
        elif price < previous_price:
            side = "sell"
        else:
            side = "neutral"
        previous_price = price
        parsed.append(
            TradeRecord(
                timestamp=_utc_iso(ts),
                price=price,
                quantity=quantity,
                value=round(price * quantity, 2),
                side=side,
            )
        )
    parsed.sort(key=lambda trade: trade.timestamp, reverse=True)
    return parsed[:limit]


async def _fetch_live_trades(symbol: str, limit: int) -> list[TradeRecord]:
    registry = get_adapter_registry()
    exchange = _guess_exchange(symbol)
    normalized_symbol = _normalized_symbol(symbol)
    raw_rows: list[dict[str, Any]] = []
    for adapter in registry.get_chain(exchange):
        rows = await _maybe_call_recent_trades(adapter, normalized_symbol, limit)
        if rows:
            raw_rows = rows
            break
    return _coerce_trade_rows(raw_rows, limit)


async def _load_recent_trades(symbol: str, limit: int) -> list[TradeRecord]:
    """Return real recent trades only.

    Integrity: a tape's live source is a tick/trade feed. When no adapter
    exposes one we return no trades rather than fabricating a tape from a
    seeded random walk (the old behaviour) or inventing buy/sell sides from
    OHLCV bars — both of which presented invented order flow as real.
    """
    live_trades = await _fetch_live_trades(symbol, limit)
    return live_trades[:limit]


@router.get("/{symbol}/recent")
async def get_recent_tape(
    symbol: str,
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
) -> dict[str, Any]:
    trades = await _load_recent_trades(symbol, limit)
    payload: dict[str, Any] = {"trades": [trade.model_dump() for trade in trades]}
    if not trades:
        payload[DEGRADED_KEY] = degraded_marker(
            REASON_NO_PROVIDER_DATA,
            detail="no live trade feed for this symbol",
        )
    return payload


@router.get("/{symbol}/summary")
async def get_tape_summary(
    symbol: str,
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
) -> dict[str, Any]:
    trades = await _load_recent_trades(symbol, limit)
    if not trades:
        # No live tape — return zeroed metrics flagged degraded rather than
        # fabricated order-flow stats. The UI shows a banner + empty state.
        return {
            "total_volume": 0,
            "buy_volume": 0,
            "sell_volume": 0,
            "buy_pct": 0.0,
            "large_trade_count": 0,
            "avg_trade_size": 0.0,
            "trades_per_min": 0.0,
            DEGRADED_KEY: degraded_marker(
                REASON_NO_PROVIDER_DATA,
                detail="no live trade feed for this symbol",
            ),
        }

    total_volume = sum(trade.quantity for trade in trades)
    buy_volume = sum(trade.quantity for trade in trades if trade.side == "buy")
    sell_volume = sum(trade.quantity for trade in trades if trade.side == "sell")
    avg_trade_size = total_volume / max(1, len(trades))
    large_trade_count = sum(1 for trade in trades if trade.quantity > (avg_trade_size * 2))

    timestamps = [
        datetime.fromisoformat(trade.timestamp.replace("Z", "+00:00")).astimezone(timezone.utc)
        for trade in trades
    ]
    newest = max(timestamps)
    oldest = min(timestamps)
    duration_minutes = max((newest - oldest).total_seconds() / 60.0, 1.0)
    trades_per_min = len(trades) / duration_minutes

    return {
        "total_volume": total_volume,
        "buy_volume": buy_volume,
        "sell_volume": sell_volume,
        "buy_pct": round((buy_volume / total_volume) * 100.0, 2) if total_volume else 0.0,
        "large_trade_count": large_trade_count,
        "avg_trade_size": round(avg_trade_size, 2),
        "trades_per_min": round(trades_per_min, 2),
    }
