from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from typing import Any, Literal
from types import SimpleNamespace
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
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
from backend.services.legacy_holdings import (
    manager_holdings_as_legacy,
    primary_portfolio,
)
from backend.services.forex_service import service as forex_service
from backend.services.portfolio_accounting import calculate_portfolio_accounting
from backend.services.portfolio_analytics import portfolio_analytics_service
from backend.shared.market_classifier import is_crypto_symbol, market_classifier

router = APIRouter()


def _normalize_currency_code(value: str | None, *, default: str | None = None) -> str | None:
    normalized = str(value or "").strip().upper()
    if not normalized:
        return default
    if len(normalized) != 3 or not normalized.isascii() or not normalized.isalpha():
        raise ValueError("currency must be a 3-letter ISO-style code")
    return normalized


class PortfolioCreateRequest(BaseModel):
    name: str
    description: str = ""
    benchmark_symbol: str | None = None
    currency: str = "USD"
    starting_cash: float = Field(default=0.0, ge=0)

    @field_validator("currency", mode="before")
    @classmethod
    def normalize_currency(cls, value: str | None) -> str:
        return _normalize_currency_code(value, default="USD") or "USD"


class PortfolioUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    benchmark_symbol: str | None = None
    currency: str | None = None

    @field_validator("currency", mode="before")
    @classmethod
    def normalize_currency(cls, value: str | None) -> str | None:
        return _normalize_currency_code(value)


class PortfolioHoldingCreateRequest(BaseModel):
    symbol: str
    shares: float = Field(gt=0)
    cost_basis_per_share: float = Field(gt=0)
    currency: str | None = Field(
        default=None,
        description="Currency of the recorded cost basis; omission is preserved as unknown",
    )
    purchase_date: str = ""
    notes: str = ""
    lot_id: str = ""

    @field_validator("currency", mode="before")
    @classmethod
    def normalize_currency(cls, value: str | None) -> str | None:
        return _normalize_currency_code(value)


class PortfolioTransactionCreateRequest(BaseModel):
    # Trades (buy/sell) carry a symbol + shares; cash-only rows (dividend/deposit/
    # withdrawal) carry the amount in `price` with shares = 0. See portfolio_cash.
    symbol: str = ""
    type: str = Field(pattern="^(buy|sell|dividend|deposit|withdrawal)$")
    shares: float = Field(default=0.0, ge=0)
    price: float = Field(default=0.0, ge=0)
    currency: str | None = Field(
        default=None,
        description="Currency of price or cash amount; omission is preserved as unknown",
    )
    date: str
    fees: float = Field(default=0.0, ge=0)
    fees_currency: str | None = Field(
        default=None,
        description="Currency of fees; omission is preserved as unknown",
    )
    lot_id: str = ""
    notes: str = ""

    @field_validator("currency", "fees_currency", mode="before")
    @classmethod
    def normalize_currencies(cls, value: str | None) -> str | None:
        return _normalize_currency_code(value)


class PortfolioHoldingResponse(BaseModel):
    id: str
    symbol: str
    shares: float
    cost_basis_per_share: float
    cost_basis_currency: str | None = Field(
        description="Persisted currency of the recorded cost basis; null means legacy/unknown",
    )
    purchase_date: str
    notes: str
    lot_id: str
    current_price: float
    currency: str | None = Field(description="Live provider currency of current_price")


class PortfolioHoldingsResponse(BaseModel):
    items: list[PortfolioHoldingResponse]


class PortfolioTransactionResponse(BaseModel):
    id: str
    symbol: str
    type: str
    shares: float
    price: float
    currency: str | None = Field(description="Persisted price/amount currency; null means legacy/unknown")
    date: str
    fees: float
    fees_currency: str | None = Field(description="Persisted fee currency; null means legacy/unknown")
    lot_id: str
    notes: str


class PortfolioTransactionsResponse(BaseModel):
    items: list[PortfolioTransactionResponse]


class PortfolioAccountingIssue(BaseModel):
    code: str
    scope: str
    id: str
    source_currency: str | None
    target_currency: str
    requested_date: date | None
    message: str


class PortfolioFXRateEvidence(BaseModel):
    base_currency: str = Field(description="Currency of the native/source amount")
    quote_currency: str = Field(description="Portfolio accounting base currency")
    rate: float
    rate_at: datetime
    requested_date: date | None
    source: str
    source_symbol: str
    freshness: str
    cache_status: str
    degraded: bool
    degraded_reason: str | None


class PortfolioNativeAmount(BaseModel):
    amount: float | None
    currency: str | None


class PortfolioAccountingHolding(BaseModel):
    id: str
    symbol: str
    cost_basis_native: PortfolioNativeAmount
    cost_basis_base: float | None
    cost_basis_fx: PortfolioFXRateEvidence | None
    cost_basis_method: Literal["ledger_replay", "holding_record"]
    market_value_native: PortfolioNativeAmount
    market_value_base: float | None
    market_value_fx: PortfolioFXRateEvidence | None
    unrealized_pnl_base: float | None


class PortfolioAccountingTransaction(BaseModel):
    id: str
    type: str
    symbol: str
    amount_native: PortfolioNativeAmount
    amount_base: float | None
    amount_fx: PortfolioFXRateEvidence | None
    fees_native: PortfolioNativeAmount
    fees_base: float | None
    fees_fx: PortfolioFXRateEvidence | None
    cash_delta_base: float | None


class PortfolioKnownTotals(BaseModel):
    cost_basis: float
    market_value: float
    cash_balance: float
    fees: float
    dividend_income: float


class PortfolioAllocationItem(BaseModel):
    name: str
    value: float


class PortfolioAccountingSummary(BaseModel):
    base_currency: str
    status: Literal["complete", "degraded", "partial"]
    as_of: datetime
    issues: list[PortfolioAccountingIssue]
    degraded_reasons: list[str]
    fx_rates: list[PortfolioFXRateEvidence] = Field(description="Deduplicated traceable provider FX-rate evidence used by this valuation")
    known_totals: PortfolioKnownTotals = Field(description="Sum of successfully converted components, never a complete total when status is partial")


class PortfolioAccountingTotals(BaseModel):
    total_cost: float | None
    total_value: float | None
    cash_balance: float | None
    net_liquidation_value: float | None
    unrealized_pnl: float | None
    unrealized_pnl_pct: float | None
    realized_pnl: float | None
    day_change: float | None
    day_change_pct: float | None
    dividend_income_ytd: float | None
    fees: float | None


class PortfolioAccountingResponse(PortfolioAccountingSummary):
    totals: PortfolioAccountingTotals
    allocation_by_sector: list[PortfolioAllocationItem]
    allocation_by_market: list[PortfolioAllocationItem]
    top_gainers: list[dict[str, Any]]
    top_losers: list[dict[str, Any]]
    holdings: list[PortfolioAccountingHolding] = Field(description="Native and base-currency valuation evidence per holding")
    transactions: list[PortfolioAccountingTransaction] = Field(description="Native and base-currency valuation evidence per ledger row")


class PortfolioListItemResponse(BaseModel):
    id: str
    name: str
    description: str
    benchmark_symbol: str | None
    currency: str
    created_at: str
    total_value: float | None
    cash_balance: float | None
    net_liquidation_value: float | None
    accounting: PortfolioAccountingSummary


class PortfolioListResponse(BaseModel):
    items: list[PortfolioListItemResponse]


class PortfolioDetailResponse(BaseModel):
    id: str
    name: str
    description: str
    benchmark_symbol: str | None
    currency: str
    starting_cash: float
    created_at: str
    total_cost: float | None
    total_value: float | None
    cash_balance: float | None
    net_liquidation_value: float | None
    unrealized_pnl: float | None
    unrealized_pnl_pct: float | None
    realized_pnl: float | None
    day_change: float | None
    day_change_pct: float | None
    dividend_income_ytd: float | None
    fees: float | None
    accounting: PortfolioAccountingResponse


class PortfolioAnalyticsResponse(BaseModel):
    portfolio_id: str
    total_cost: float | None
    total_value: float | None
    cash_balance: float | None
    net_liquidation_value: float | None
    unrealized_pnl: float | None
    unrealized_pnl_pct: float | None
    realized_pnl: float | None
    day_change: float | None
    day_change_pct: float | None
    dividend_income_ytd: float | None
    fees: float | None
    allocation_by_sector: list[PortfolioAllocationItem]
    allocation_by_market: list[PortfolioAllocationItem]
    top_gainers: list[dict[str, Any]]
    top_losers: list[dict[str, Any]]
    annualized_return: float | None
    sharpe_ratio: float
    max_drawdown: float
    accounting: PortfolioAccountingResponse


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


async def _portfolio_accounting(
    portfolio: PortfolioORM,
    holdings: list[PortfolioHoldingORM],
    transactions: list[PortfolioTransactionORM],
    quotes: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    return await calculate_portfolio_accounting(
        base_currency=portfolio.currency,
        starting_cash=portfolio.starting_cash,
        holdings=holdings,
        transactions=transactions,
        quotes=quotes,
        resolve_rate=forex_service.get_valuation_rate,
    )


def _accounting_summary(accounting: dict[str, Any]) -> dict[str, Any]:
    """Keep collection responses useful without duplicating row-level evidence."""
    return {
        key: accounting[key]
        for key in ("base_currency", "status", "as_of", "issues", "degraded_reasons", "fx_rates", "known_totals")
    }


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
                "currency": classification.get("currency") or snapshot.get("currency"),
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


@router.get("/portfolios", response_model=PortfolioListResponse)
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
        transactions = db.query(PortfolioTransactionORM).filter(PortfolioTransactionORM.portfolio_id == row.id).all()
        accounting = await _portfolio_accounting(row, holdings, transactions, quotes)
        totals = accounting["totals"]
        out.append(
            {
                "id": row.id,
                "name": row.name,
                "description": row.description,
                "benchmark_symbol": row.benchmark_symbol,
                "currency": row.currency,
                "created_at": row.created_at.isoformat(),
                "total_value": totals["total_value"],
                "cash_balance": totals["cash_balance"],
                "net_liquidation_value": totals["net_liquidation_value"],
                "accounting": _accounting_summary(accounting),
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
    portfolio = primary_portfolio(db, current_user.id)
    holdings = (
        db.query(PortfolioHoldingORM)
        .filter(PortfolioHoldingORM.portfolio_id == portfolio.id)
        .all()
    )
    summary = await _legacy_summary_for_holdings(holdings)
    summary["portfolio_id"] = portfolio.id
    summary["portfolio_name"] = portfolio.name
    return summary


@router.get("/portfolios/{portfolio_id}", response_model=PortfolioDetailResponse)
async def get_portfolio(
    portfolio_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    row = _portfolio_for_user(db, portfolio_id, current_user.id)
    holdings = db.query(PortfolioHoldingORM).filter(PortfolioHoldingORM.portfolio_id == portfolio_id).all()
    transactions = db.query(PortfolioTransactionORM).filter(PortfolioTransactionORM.portfolio_id == portfolio_id).all()
    symbols = sorted({holding.symbol for holding in holdings if holding.symbol})
    quotes = await _quote_map(symbols) if symbols else {}
    accounting = await _portfolio_accounting(row, holdings, transactions, quotes)
    return {
        "id": row.id,
        "name": row.name,
        "description": row.description,
        "benchmark_symbol": row.benchmark_symbol,
        "currency": row.currency,
        "starting_cash": row.starting_cash,
        **accounting["totals"],
        "accounting": accounting,
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
        cost_basis_currency=payload.currency,
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
            currency=payload.currency,
            date=payload.purchase_date or datetime.now(timezone.utc).date().isoformat(),
            fees=0.0,
            fees_currency=None,
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


@router.get("/portfolios/{portfolio_id}/holdings", response_model=PortfolioHoldingsResponse)
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
                "cost_basis_currency": r.cost_basis_currency,
                "purchase_date": r.purchase_date,
                "notes": r.notes,
                "lot_id": r.lot_id,
                "current_price": float((quotes.get(r.symbol, {}) or {}).get("current_price") or 0.0),
                "currency": (quotes.get(r.symbol, {}) or {}).get("currency"),
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
        currency=payload.currency,
        date=payload.date,
        fees=float(payload.fees),
        fees_currency=payload.fees_currency,
        lot_id=payload.lot_id.strip(),
        notes=payload.notes,
    )
    db.add(tx)

    if payload.type == "buy" and payload.shares > 0:
        # A buy either opens a new lot or adds to an existing one (weighted-avg cost).
        lot_id = payload.lot_id.strip() or datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        row = (
            db.query(PortfolioHoldingORM)
            .filter(
                PortfolioHoldingORM.portfolio_id == portfolio_id,
                PortfolioHoldingORM.symbol == symbol,
                PortfolioHoldingORM.lot_id == lot_id,
            )
            .first()
        )
        if row is None:
            db.add(
                PortfolioHoldingORM(
                    portfolio_id=portfolio_id,
                    symbol=symbol,
                    shares=float(payload.shares),
                    cost_basis_per_share=float(payload.price),
                    cost_basis_currency=payload.currency,
                    purchase_date=payload.date,
                    notes=payload.notes,
                    lot_id=lot_id,
                )
            )
        else:
            if row.cost_basis_currency != payload.currency:
                raise HTTPException(
                    status_code=409,
                    detail="Cannot combine buys with different or unknown currencies in one lot; use a new lot_id",
                )
            old_shares = float(row.shares)
            add_shares = float(payload.shares)
            new_shares = old_shares + add_shares
            row.cost_basis_per_share = (
                (old_shares * float(row.cost_basis_per_share) + add_shares * float(payload.price)) / max(new_shares, 1e-9)
            )
            row.shares = new_shares

    elif payload.type == "sell" and payload.shares > 0:
        # A sell reduces the position for this symbol. If an explicit lot_id is
        # given it targets that lot; otherwise it consumes the symbol's lots
        # oldest-first (FIFO) — the common case, since the "Sell" button and the
        # plain sell form don't carry a lot_id. Matching on a synthetic "manual"
        # lot_id (the old behaviour) never matched a real holding, so the sale was
        # recorded (cash moved via the ledger) but the shares were never removed.
        lot_filter = [
            PortfolioHoldingORM.portfolio_id == portfolio_id,
            PortfolioHoldingORM.symbol == symbol,
        ]
        explicit_lot = payload.lot_id.strip()
        if explicit_lot:
            lot_filter.append(PortfolioHoldingORM.lot_id == explicit_lot)
        lots = (
            db.query(PortfolioHoldingORM)
            .filter(*lot_filter)
            .order_by(PortfolioHoldingORM.created_at.asc())
            .all()
        )
        remaining = float(payload.shares)
        for lot in lots:
            if remaining <= 1e-9:
                break
            take = min(float(lot.shares), remaining)
            lot.shares = float(lot.shares) - take
            remaining -= take
            if lot.shares <= 1e-9:
                db.delete(lot)

    db.commit()
    db.refresh(tx)
    return {"id": tx.id, "status": "created"}


@router.get("/portfolios/{portfolio_id}/transactions", response_model=PortfolioTransactionsResponse)
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
                "currency": r.currency,
                "date": r.date,
                "fees": r.fees,
                "fees_currency": r.fees_currency,
                "lot_id": r.lot_id,
                "notes": r.notes,
            }
            for r in rows
        ]
    }


@router.get("/portfolios/{portfolio_id}/analytics", response_model=PortfolioAnalyticsResponse)
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

    holding_views: list[SimpleNamespace] = []
    for h in holdings:
        holding_views.append(
            SimpleNamespace(
                ticker=h.symbol,
                quantity=float(h.shares),
                avg_buy_price=float(h.cost_basis_per_share),
            )
        )

    accounting = await _portfolio_accounting(portfolio, holdings, transactions, quotes)
    totals = accounting["totals"]

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
    # Current equity is available only when every required ledger and mark
    # conversion succeeded; a partial result must not become a return figure.
    final_equity = totals["net_liquidation_value"]
    if initial_capital > 0 and final_equity is not None and final_equity > 0:
        annualized_return = ((final_equity / initial_capital) ** (1 / years) - 1.0) * 100.0
    else:
        annualized_return = None

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
        **totals,
        "allocation_by_sector": accounting["allocation_by_sector"],
        "allocation_by_market": accounting["allocation_by_market"],
        "top_gainers": accounting["top_gainers"],
        "top_losers": accounting["top_losers"],
        "annualized_return": annualized_return,
        "sharpe_ratio": sharpe_ratio,
        "max_drawdown": max_drawdown,
        "accounting": accounting,
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
        return primary_portfolio(db, user_id)
    return _portfolio_for_user(db, portfolio_id, user_id)  # 404 if not the caller's


def _analytics_holdings(db: Session, portfolio_id: str, user_id: str) -> list[SimpleNamespace]:
    portfolio = _resolve_portfolio(db, portfolio_id, user_id)
    holdings = db.query(PortfolioHoldingORM).filter(PortfolioHoldingORM.portfolio_id == portfolio.id).all()
    return manager_holdings_as_legacy(holdings)


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


@router.get("/portfolios/{portfolio_id}/attribution")
async def get_portfolio_attribution(
    portfolio_id: str,
    period: str = Query(default="1M"),
    benchmark: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    # Brinson + factor attribution for the user's own portfolio. Resolves the
    # portfolio (ownership-checked, honours "primary") then feeds its real id to
    # the per-portfolio attribution path (no global-holdings involvement).
    portfolio = _resolve_portfolio(db, portfolio_id, current_user.id)
    bench = benchmark or portfolio.benchmark_symbol or "S&P500"
    try:
        return await portfolio_analytics_service.portfolio_attribution(
            db=db, portfolio_id=portfolio.id, period=period, benchmark=bench
        )
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(status_code=404, detail=message)
        raise HTTPException(status_code=400, detail=message)
