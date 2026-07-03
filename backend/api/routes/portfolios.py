from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any
from types import SimpleNamespace
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.api.deps import fetch_stock_snapshot_coalesced, get_db
from backend.auth.deps import get_current_user
from backend.models import (
    PortfolioHoldingORM,
    PortfolioORM,
    PortfolioTransactionORM,
    User,
)
from backend.services.portfolio_analytics import portfolio_analytics_service
from backend.services.portfolio_cash import cash_balance
from backend.services.portfolio_pnl import realized_pnl
from backend.shared.market_classifier import is_crypto_symbol, market_classifier

router = APIRouter()


class PortfolioCreateRequest(BaseModel):
    name: str
    description: str = ""
    benchmark_symbol: str | None = None
    currency: str = "USD"
    starting_cash: float = Field(default=0.0, ge=0)


class PortfolioUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    benchmark_symbol: str | None = None
    currency: str | None = None


class PortfolioHoldingCreateRequest(BaseModel):
    symbol: str
    shares: float = Field(gt=0)
    cost_basis_per_share: float = Field(gt=0)
    purchase_date: str = ""
    notes: str = ""
    lot_id: str = ""


class PortfolioTransactionCreateRequest(BaseModel):
    # Trades (buy/sell) carry a symbol + shares; cash-only rows (dividend/deposit/
    # withdrawal) carry the amount in `price` with shares = 0. See portfolio_cash.
    symbol: str = ""
    type: str = Field(pattern="^(buy|sell|dividend|deposit|withdrawal)$")
    shares: float = Field(default=0.0, ge=0)
    price: float = Field(default=0.0, ge=0)
    date: str
    fees: float = Field(default=0.0, ge=0)
    lot_id: str = ""
    notes: str = ""


def _portfolio_for_user(db: Session, portfolio_id: str, user_id: str) -> PortfolioORM:
    row = db.query(PortfolioORM).filter(PortfolioORM.id == portfolio_id, PortfolioORM.user_id == user_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return row


async def _quote_map(symbols: list[str]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for sym in symbols:
        out[sym] = await fetch_stock_snapshot_coalesced(sym)
    return out


def _primary_portfolio(db: Session, user_id: str, *, create: bool = True) -> PortfolioORM | None:
    """The user's primary portfolio: their earliest-created one.

    A user always has exactly one primary; when they have none yet and
    ``create`` is set we materialise a default so dashboards (home, cockpit,
    HUD, ...) that formerly read the global legacy portfolio have a per-user
    portfolio to read instead. This is the replacement for the shared,
    user-less legacy ``Holding`` table.
    """
    row = (
        db.query(PortfolioORM)
        .filter(PortfolioORM.user_id == user_id)
        # id is a stable tiebreaker so "primary" stays fixed even if two
        # portfolios share a created_at timestamp.
        .order_by(PortfolioORM.created_at.asc(), PortfolioORM.id.asc())
        .first()
    )
    if row is not None or not create:
        return row
    row = PortfolioORM(
        user_id=user_id,
        name="My Portfolio",
        description="",
        benchmark_symbol=None,
        currency="USD",
        starting_cash=0.0,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _manager_holdings_as_legacy(holdings: list[PortfolioHoldingORM]) -> list[SimpleNamespace]:
    """Adapt Manager holdings to the ``Holding``-shaped objects the analytics
    service reads (``.ticker``/``.quantity``/``.avg_buy_price``/``.buy_date``).

    Aggregated per symbol on purpose: ``_portfolio_returns`` and
    ``benchmark_overlay`` key intermediate dicts by ticker, so passing raw
    per-lot rows would let a later lot silently overwrite an earlier lot's
    quantity. buy_date is the earliest lot's date (equity curve "since first
    bought").
    """
    agg: dict[str, dict[str, Any]] = {}
    for h in holdings:
        sym = (h.symbol or "").strip().upper()
        if not sym:
            continue
        b = agg.setdefault(sym, {"shares": 0.0, "cost": 0.0, "buy_date": ""})
        b["shares"] += float(h.shares)
        b["cost"] += float(h.shares) * float(h.cost_basis_per_share)
        pdate = (h.purchase_date or "").strip()
        if pdate and (not b["buy_date"] or pdate < b["buy_date"]):
            b["buy_date"] = pdate
    out: list[SimpleNamespace] = []
    for sym, b in agg.items():
        shares = b["shares"]
        out.append(
            SimpleNamespace(
                ticker=sym,
                quantity=shares,
                avg_buy_price=(b["cost"] / shares if shares else 0.0),
                buy_date=b["buy_date"],
            )
        )
    return out


async def _legacy_summary_for_holdings(holdings: list[PortfolioHoldingORM]) -> dict[str, Any]:
    """Render Manager holdings in the shape the legacy ``/portfolio`` returned.

    Positions are aggregated per symbol (weighted-average cost across lots) and
    enriched with a live quote + market classification, bounded so a single slow
    upstream can't stall the whole endpoint. Keeping the response shape stable
    lets the shared dashboards repoint to a per-user portfolio without a rewrite.
    """
    # Aggregate lots -> one position per symbol.
    agg: dict[str, dict[str, float]] = {}
    for h in holdings:
        sym = (h.symbol or "").strip().upper()
        if not sym:
            continue
        bucket = agg.setdefault(sym, {"shares": 0.0, "cost": 0.0})
        bucket["shares"] += float(h.shares)
        bucket["cost"] += float(h.shares) * float(h.cost_basis_per_share)

    symbols = sorted(agg.keys())
    sem = asyncio.Semaphore(32)
    snapshot_timeout_s = 8.0

    async def _snapshot_for(ticker: str) -> dict[str, Any]:
        async with sem:
            try:
                snap_task = asyncio.create_task(fetch_stock_snapshot_coalesced(ticker))
                class_task = asyncio.create_task(market_classifier.classify(ticker))
                snap, classification = await asyncio.wait_for(
                    asyncio.gather(snap_task, class_task, return_exceptions=True),
                    timeout=snapshot_timeout_s,
                )
                payload = snap if isinstance(snap, dict) else {}
                if not isinstance(classification, Exception):
                    payload["_classification"] = classification.model_dump()
                return payload
            except Exception:
                return {}

    snapshot_tasks = {sym: asyncio.create_task(_snapshot_for(sym)) for sym in symbols}
    rows: list[dict[str, Any]] = []
    total_cost = 0.0
    total_value = 0.0
    for sym in symbols:
        shares = agg[sym]["shares"]
        cost = agg[sym]["cost"]
        avg_buy_price = cost / shares if shares else 0.0
        total_cost += cost
        snapshot = await snapshot_tasks[sym]
        classification = snapshot.get("_classification") if isinstance(snapshot.get("_classification"), dict) else {}
        raw_price = snapshot.get("current_price")
        price = float(raw_price) if isinstance(raw_price, (int, float)) else None
        sector = str(snapshot.get("sector") or "").strip() or ("Crypto" if is_crypto_symbol(sym) else None)
        current_value = float(shares) * float(price) if isinstance(price, (int, float)) else None
        if current_value is not None:
            total_value += current_value
        rows.append(
            {
                "id": sym,
                "ticker": sym,
                "quantity": shares,
                "avg_buy_price": avg_buy_price,
                "buy_date": "",
                "sector": sector,
                "current_price": price,
                "current_value": current_value,
                "pnl": (current_value - cost) if current_value is not None else None,
                "exchange": classification.get("exchange") or snapshot.get("exchange"),
                "country_code": classification.get("country_code") or snapshot.get("country_code"),
                "flag_emoji": classification.get("flag_emoji") or snapshot.get("flag_emoji"),
                "has_futures": bool(classification.get("has_futures")),
                "has_options": bool(classification.get("has_options")),
            }
        )

    overall_pnl = total_value - total_cost if total_value > 0 else None
    return {
        "items": rows,
        "summary": {
            "total_cost": total_cost,
            "total_value": total_value if total_value > 0 else None,
            "overall_pnl": overall_pnl,
        },
    }


@router.post("/portfolios")
def create_portfolio(
    payload: PortfolioCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = PortfolioORM(
        user_id=current_user.id,
        name=payload.name.strip() or "Portfolio",
        description=payload.description.strip(),
        benchmark_symbol=(payload.benchmark_symbol or "").strip().upper() or None,
        currency=(payload.currency or "USD").strip().upper(),
        starting_cash=float(payload.starting_cash),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name}


@router.get("/portfolios")
async def list_portfolios(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    rows = (
        db.query(PortfolioORM)
        .filter(PortfolioORM.user_id == current_user.id)
        .order_by(PortfolioORM.created_at.desc())
        .all()
    )
    out = []
    for row in rows:
        holdings = db.query(PortfolioHoldingORM).filter(PortfolioHoldingORM.portfolio_id == row.id).all()
        symbols = sorted({h.symbol for h in holdings if h.symbol})
        quotes = await _quote_map(symbols) if symbols else {}
        total_value = 0.0
        for h in holdings:
            px = float((quotes.get(h.symbol, {}) or {}).get("current_price") or 0.0)
            total_value += float(h.shares) * px
        transactions = db.query(PortfolioTransactionORM).filter(PortfolioTransactionORM.portfolio_id == row.id).all()
        cash = cash_balance(row.starting_cash, transactions)
        out.append(
            {
                "id": row.id,
                "name": row.name,
                "description": row.description,
                "benchmark_symbol": row.benchmark_symbol,
                "currency": row.currency,
                "created_at": row.created_at.isoformat(),
                "total_value": total_value,
                "cash_balance": cash,
                "net_liquidation_value": total_value + cash,
            }
        )
    return {"items": out}


@router.get("/portfolios/primary")
async def get_primary_portfolio_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Legacy-compatible summary of the user's primary portfolio.

    Drop-in replacement for the retired global ``GET /api/portfolio``: same
    ``{items, summary}`` shape, but scoped to the authenticated user instead of
    a single table shared across everyone. Registered before the
    ``/portfolios/{portfolio_id}`` route so "primary" isn't captured as an id.
    """
    portfolio = _primary_portfolio(db, current_user.id)
    holdings = (
        db.query(PortfolioHoldingORM)
        .filter(PortfolioHoldingORM.portfolio_id == portfolio.id)
        .all()
    )
    summary = await _legacy_summary_for_holdings(holdings)
    summary["portfolio_id"] = portfolio.id
    summary["portfolio_name"] = portfolio.name
    return summary


@router.get("/portfolios/{portfolio_id}")
def get_portfolio(
    portfolio_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = _portfolio_for_user(db, portfolio_id, current_user.id)
    transactions = db.query(PortfolioTransactionORM).filter(PortfolioTransactionORM.portfolio_id == portfolio_id).all()
    return {
        "id": row.id,
        "name": row.name,
        "description": row.description,
        "benchmark_symbol": row.benchmark_symbol,
        "currency": row.currency,
        "starting_cash": row.starting_cash,
        "cash_balance": cash_balance(row.starting_cash, transactions),
        "created_at": row.created_at.isoformat(),
    }


@router.patch("/portfolios/{portfolio_id}")
def update_portfolio(
    portfolio_id: str,
    payload: PortfolioUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = _portfolio_for_user(db, portfolio_id, current_user.id)
    if payload.name is not None:
        row.name = payload.name.strip() or row.name
    if payload.description is not None:
        row.description = payload.description
    if payload.benchmark_symbol is not None:
        row.benchmark_symbol = payload.benchmark_symbol.strip().upper() or None
    if payload.currency is not None:
        row.currency = payload.currency.strip().upper() or row.currency
    db.commit()
    return {"status": "updated", "id": row.id}


@router.delete("/portfolios/{portfolio_id}")
def delete_portfolio(
    portfolio_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = _portfolio_for_user(db, portfolio_id, current_user.id)
    db.delete(row)
    db.commit()
    return {"status": "deleted", "id": portfolio_id}


@router.post("/portfolios/{portfolio_id}/holdings")
def add_portfolio_holding(
    portfolio_id: str,
    payload: PortfolioHoldingCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _portfolio_for_user(db, portfolio_id, current_user.id)
    symbol = payload.symbol.strip().upper()
    # Each holding is its own lot. The auto lot_id must be unique per row, or a
    # bulk add of the same symbol (e.g. Import from Legacy, or two lots bought the
    # same day) collides on the (portfolio_id, symbol, lot_id) constraint. A bare
    # second-resolution timestamp is not enough — add a random suffix.
    lot_id = payload.lot_id.strip() or f"{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid4().hex[:8]}"
    row = PortfolioHoldingORM(
        portfolio_id=portfolio_id,
        symbol=symbol,
        shares=float(payload.shares),
        cost_basis_per_share=float(payload.cost_basis_per_share),
        purchase_date=payload.purchase_date,
        notes=payload.notes,
        lot_id=lot_id,
    )
    db.add(row)
    db.add(
        PortfolioTransactionORM(
            portfolio_id=portfolio_id,
            symbol=symbol,
            type="buy",
            shares=float(payload.shares),
            price=float(payload.cost_basis_per_share),
            date=payload.purchase_date or datetime.now(timezone.utc).date().isoformat(),
            fees=0.0,
            lot_id=lot_id,
            notes=payload.notes,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        # A holding with this (symbol, lot_id) already exists in the portfolio —
        # return a clean conflict rather than a 500.
        db.rollback()
        raise HTTPException(status_code=409, detail=f"A lot for {symbol} with lot_id '{lot_id}' already exists")
    db.refresh(row)
    return {"id": row.id, "symbol": row.symbol}


@router.get("/portfolios/{portfolio_id}/holdings")
async def list_portfolio_holdings(
    portfolio_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _portfolio_for_user(db, portfolio_id, current_user.id)
    rows = (
        db.query(PortfolioHoldingORM)
        .filter(PortfolioHoldingORM.portfolio_id == portfolio_id)
        .order_by(PortfolioHoldingORM.created_at.desc())
        .all()
    )
    symbols = sorted({r.symbol for r in rows if r.symbol})
    quotes = await _quote_map(symbols) if symbols else {}
    return {
        "items": [
            {
                "id": r.id,
                "symbol": r.symbol,
                "shares": r.shares,
                "cost_basis_per_share": r.cost_basis_per_share,
                "purchase_date": r.purchase_date,
                "notes": r.notes,
                "lot_id": r.lot_id,
                "current_price": float((quotes.get(r.symbol, {}) or {}).get("current_price") or 0.0),
            }
            for r in rows
        ]
    }


@router.post("/portfolios/{portfolio_id}/transactions")
def add_portfolio_transaction(
    portfolio_id: str,
    payload: PortfolioTransactionCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _portfolio_for_user(db, portfolio_id, current_user.id)
    symbol = payload.symbol.strip().upper()
    if payload.type in {"deposit", "withdrawal"}:
        # Cash-only movement: no security, amount lives in `price`.
        symbol = symbol or "CASH"
        if payload.price <= 0:
            raise HTTPException(status_code=422, detail=f"{payload.type} requires a positive amount")
    elif not symbol:
        raise HTTPException(status_code=422, detail=f"{payload.type} requires a symbol")
    tx = PortfolioTransactionORM(
        portfolio_id=portfolio_id,
        symbol=symbol,
        type=payload.type,
        shares=float(payload.shares),
        price=float(payload.price),
        date=payload.date,
        fees=float(payload.fees),
        lot_id=payload.lot_id.strip(),
        notes=payload.notes,
    )
    db.add(tx)

    if payload.type in {"buy", "sell"} and payload.shares > 0:
        lot_id = payload.lot_id.strip() or ("manual" if payload.type == "sell" else datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"))
        row = (
            db.query(PortfolioHoldingORM)
            .filter(
                PortfolioHoldingORM.portfolio_id == portfolio_id,
                PortfolioHoldingORM.symbol == symbol,
                PortfolioHoldingORM.lot_id == lot_id,
            )
            .first()
        )
        if row is None and payload.type == "buy":
            row = PortfolioHoldingORM(
                portfolio_id=portfolio_id,
                symbol=symbol,
                shares=float(payload.shares),
                cost_basis_per_share=float(payload.price),
                purchase_date=payload.date,
                notes=payload.notes,
                lot_id=lot_id,
            )
            db.add(row)
        elif row is not None:
            if payload.type == "buy":
                old_shares = float(row.shares)
                add_shares = float(payload.shares)
                new_shares = old_shares + add_shares
                row.cost_basis_per_share = (
                    (old_shares * float(row.cost_basis_per_share) + add_shares * float(payload.price)) / max(new_shares, 1e-9)
                )
                row.shares = new_shares
            else:
                row.shares = max(0.0, float(row.shares) - float(payload.shares))
        if row is not None and row.shares <= 0:
            db.delete(row)

    db.commit()
    db.refresh(tx)
    return {"id": tx.id, "status": "created"}


@router.get("/portfolios/{portfolio_id}/transactions")
def list_portfolio_transactions(
    portfolio_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    _portfolio_for_user(db, portfolio_id, current_user.id)
    rows = (
        db.query(PortfolioTransactionORM)
        .filter(PortfolioTransactionORM.portfolio_id == portfolio_id)
        .order_by(PortfolioTransactionORM.created_at.desc())
        .all()
    )
    return {
        "items": [
            {
                "id": r.id,
                "symbol": r.symbol,
                "type": r.type,
                "shares": r.shares,
                "price": r.price,
                "date": r.date,
                "fees": r.fees,
                "lot_id": r.lot_id,
                "notes": r.notes,
            }
            for r in rows
        ]
    }


@router.get("/portfolios/{portfolio_id}/analytics")
async def get_portfolio_analytics(
    portfolio_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    portfolio = _portfolio_for_user(db, portfolio_id, current_user.id)
    holdings = db.query(PortfolioHoldingORM).filter(PortfolioHoldingORM.portfolio_id == portfolio_id).all()
    transactions = db.query(PortfolioTransactionORM).filter(PortfolioTransactionORM.portfolio_id == portfolio_id).all()

    symbols = sorted({h.symbol for h in holdings if h.symbol})
    quotes = await _quote_map(symbols) if symbols else {}

    total_cost = 0.0
    total_value = 0.0
    sectors: dict[str, float] = {}
    markets: dict[str, float] = {}
    top_rows: list[dict[str, Any]] = []
    holding_views: list[SimpleNamespace] = []
    for h in holdings:
        snap = quotes.get(h.symbol, {}) or {}
        px = float(snap.get("current_price") or 0.0)
        mv = float(h.shares) * px
        cost = float(h.shares) * float(h.cost_basis_per_share)
        pnl = mv - cost
        total_value += mv
        total_cost += cost
        sector = str(snap.get("sector") or "Unknown")
        sectors[sector] = sectors.get(sector, 0.0) + mv
        ex = str(snap.get("exchange") or "Unknown")
        mk = "NSE" if ex in {"NSE", "BSE"} else "US"
        markets[mk] = markets.get(mk, 0.0) + mv
        chg = float(snap.get("change_pct") or 0.0)
        top_rows.append({"symbol": h.symbol, "pnl_pct": (pnl / cost * 100.0) if cost > 0 else 0.0, "day_change_pct": chg})
        holding_views.append(
            SimpleNamespace(
                ticker=h.symbol,
                quantity=float(h.shares),
                avg_buy_price=float(h.cost_basis_per_share),
            )
        )

    unrealized = total_value - total_cost
    # Realized P&L = capital gains from sells (cost basis subtracted), NOT proceeds.
    # Dividend income is tracked separately in `dividend_income_ytd`.
    realized = realized_pnl(transactions)
    cash = cash_balance(portfolio.starting_cash, transactions)

    top_gainers = sorted(top_rows, key=lambda x: x["pnl_pct"], reverse=True)[:5]
    top_losers = sorted(top_rows, key=lambda x: x["pnl_pct"])[:5]
    day_change = 0.0
    for h in holdings:
        snap = quotes.get(h.symbol, {}) or {}
        px = float(snap.get("current_price") or 0.0)
        mv = float(h.shares) * px
        chg_pct = float(snap.get("change_pct") or 0.0)
        day_change += mv * (chg_pct / 100.0)
    day_change_pct = (day_change / total_value) * 100.0 if total_value > 0 else 0.0

    def _as_utc(dt: datetime) -> datetime:
        # Bare date strings parse to naive datetimes; treat them as UTC so they
        # compare/subtract cleanly against tz-aware timestamps.
        return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)

    now = datetime.now(timezone.utc)
    inception_candidates: list[datetime] = [_as_utc(portfolio.created_at)]
    for h in holdings:
        try:
            if h.purchase_date:
                inception_candidates.append(_as_utc(datetime.fromisoformat(str(h.purchase_date))))
        except Exception:
            pass
    for tx in transactions:
        try:
            inception_candidates.append(_as_utc(datetime.fromisoformat(str(tx.date))))
        except Exception:
            pass
    inception = min(inception_candidates) if inception_candidates else now
    years = max((now - inception).days / 365.25, 1 / 365.25)
    initial_capital = float(portfolio.starting_cash or 0.0)
    # Current equity = holdings marked to market + cash (which already reflects
    # proceeds, dividends, deposits and buys via the ledger).
    final_equity = float(total_value + cash)
    if initial_capital > 0 and final_equity > 0:
        annualized_return = ((final_equity / initial_capital) ** (1 / years) - 1.0) * 100.0
    else:
        annualized_return = 0.0

    sharpe_ratio = 0.0
    max_drawdown = 0.0
    if holding_views:
        try:
            risk = await portfolio_analytics_service.risk_metrics(holding_views, risk_free_rate=0.04, benchmark=portfolio.benchmark_symbol or "S&P500")
            sharpe_ratio = float(risk.get("sharpe_ratio") or 0.0)
            max_drawdown = float(risk.get("max_drawdown") or 0.0)
        except Exception:
            sharpe_ratio = 0.0
            max_drawdown = 0.0

    return {
        "portfolio_id": portfolio_id,
        "total_value": total_value,
        "total_cost": total_cost,
        "cash_balance": cash,
        "net_liquidation_value": total_value + cash,
        "unrealized_pnl": unrealized,
        "unrealized_pnl_pct": (unrealized / total_cost * 100.0) if total_cost > 0 else 0.0,
        "realized_pnl": realized,
        "day_change": day_change,
        "day_change_pct": day_change_pct,
        "allocation_by_sector": [{"name": k, "value": v} for k, v in sorted(sectors.items(), key=lambda x: x[1], reverse=True)],
        "allocation_by_market": [{"name": k, "value": v} for k, v in sorted(markets.items(), key=lambda x: x[1], reverse=True)],
        "top_gainers": top_gainers,
        "top_losers": top_losers,
        "dividend_income_ytd": sum(float(t.price) for t in transactions if t.type == "dividend"),
        "annualized_return": annualized_return,
        "sharpe_ratio": sharpe_ratio,
        "max_drawdown": max_drawdown,
    }


# --- Deep analytics ported from the retired global legacy portfolio -----------
# These mirror the old `/api/portfolio/analytics/*` endpoints but are scoped to a
# user's own Manager portfolio. Holdings are adapted + aggregated per symbol via
# `_manager_holdings_as_legacy` before feeding the shared analytics service.


def _resolve_portfolio(db: Session, portfolio_id: str, user_id: str) -> PortfolioORM:
    """Resolve a portfolio for analytics, honouring the ``primary`` sentinel.

    ``/portfolios/primary/analytics/*`` falls through to these routes with
    ``portfolio_id == "primary"`` (no separate route needed), letting dashboards
    read the user's primary portfolio's analytics without first resolving its id.
    """
    if portfolio_id == "primary":
        return _primary_portfolio(db, user_id)
    return _portfolio_for_user(db, portfolio_id, user_id)  # 404 if not the caller's


def _analytics_holdings(db: Session, portfolio_id: str, user_id: str) -> list[SimpleNamespace]:
    portfolio = _resolve_portfolio(db, portfolio_id, user_id)
    holdings = db.query(PortfolioHoldingORM).filter(PortfolioHoldingORM.portfolio_id == portfolio.id).all()
    return _manager_holdings_as_legacy(holdings)


def _default_benchmark(db: Session, portfolio_id: str, user_id: str) -> str:
    return _resolve_portfolio(db, portfolio_id, user_id).benchmark_symbol or "S&P500"


@router.get("/portfolios/{portfolio_id}/analytics/sector-allocation")
async def get_portfolio_sector_allocation(
    portfolio_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    holdings = _analytics_holdings(db, portfolio_id, current_user.id)
    return await portfolio_analytics_service.sector_allocation(holdings)


@router.get("/portfolios/{portfolio_id}/analytics/risk-metrics")
async def get_portfolio_risk_metrics(
    portfolio_id: str,
    risk_free_rate: float = Query(default=0.04, ge=0, le=0.25),
    benchmark: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    holdings = _analytics_holdings(db, portfolio_id, current_user.id)
    bench = benchmark or _default_benchmark(db, portfolio_id, current_user.id)
    return await portfolio_analytics_service.risk_metrics(holdings, risk_free_rate=risk_free_rate, benchmark=bench)


@router.get("/portfolios/{portfolio_id}/analytics/correlation")
async def get_portfolio_correlation(
    portfolio_id: str,
    window: int = Query(default=60, ge=10, le=252),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    holdings = _analytics_holdings(db, portfolio_id, current_user.id)
    return await portfolio_analytics_service.correlation_matrix(holdings, window=window)


@router.get("/portfolios/{portfolio_id}/analytics/dividends")
async def get_portfolio_dividends(
    portfolio_id: str,
    days: int = Query(default=180, ge=1, le=730),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    holdings = _analytics_holdings(db, portfolio_id, current_user.id)
    return await portfolio_analytics_service.dividend_tracker(holdings, days=days)


@router.get("/portfolios/{portfolio_id}/analytics/benchmark-overlay")
async def get_portfolio_benchmark_overlay(
    portfolio_id: str,
    benchmark: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    holdings = _analytics_holdings(db, portfolio_id, current_user.id)
    bench = benchmark or _default_benchmark(db, portfolio_id, current_user.id)
    return await portfolio_analytics_service.benchmark_overlay(holdings, benchmark=bench)
