"""Per-user replacement for the global, user-less legacy ``Holding`` table.

The legacy portfolio was a single flat table shared across every user of an
instance — a privacy leak. This module is the single source that every former
``db.query(Holding).all()`` consumer now reads from, scoped to one user's
*primary* portfolio (their earliest-created Manager portfolio).

`resolve_user_holdings` returns transient ``Holding`` instances (built, not
persisted) so downstream code that type-hints ``list[Holding]`` or does
``isinstance(x, Holding)`` keeps working unchanged while the class still exists;
when the class is deleted these become plain value objects.
"""
from __future__ import annotations

from dataclasses import dataclass

from backend.models import PortfolioHoldingORM, PortfolioORM
from sqlalchemy.orm import Session


@dataclass
class LegacyHolding:
    """A position in the shape the old global ``Holding`` row exposed.

    The global ``Holding`` ORM class was deleted; consumers that read
    ``.ticker``/``.quantity``/``.avg_buy_price``/``.buy_date`` now get one of
    these plain value objects (built per-user from the primary portfolio),
    keeping their math unchanged.
    """

    ticker: str
    quantity: float
    avg_buy_price: float
    buy_date: str = ""


def primary_portfolio(db: Session, user_id: str, *, create: bool = True) -> PortfolioORM | None:
    """A user's primary portfolio: their earliest-created one (stable id
    tiebreaker so it never flips). Optionally materialises a default when the
    user has none — used by read paths that want a guaranteed portfolio."""
    row = (
        db.query(PortfolioORM)
        .filter(PortfolioORM.user_id == user_id)
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


def manager_holdings_as_legacy(holdings: list[PortfolioHoldingORM]) -> list[LegacyHolding]:
    """Adapt Manager holdings to legacy ``Holding`` shape, aggregated per symbol.

    Aggregation is deliberate: several downstream consumers key by ticker, so raw
    per-lot rows would let a later lot overwrite an earlier lot's quantity.
    buy_date is the earliest lot's (equity curve "since first bought")."""
    agg: dict[str, dict[str, object]] = {}
    for h in holdings:
        sym = (h.symbol or "").strip().upper()
        if not sym:
            continue
        b = agg.setdefault(sym, {"shares": 0.0, "cost": 0.0, "buy_date": ""})
        b["shares"] = float(b["shares"]) + float(h.shares)
        b["cost"] = float(b["cost"]) + float(h.shares) * float(h.cost_basis_per_share)
        pdate = (h.purchase_date or "").strip()
        if pdate and (not b["buy_date"] or pdate < str(b["buy_date"])):
            b["buy_date"] = pdate
    out: list[LegacyHolding] = []
    for sym, b in agg.items():
        shares = float(b["shares"])
        out.append(
            LegacyHolding(
                ticker=sym,
                quantity=shares,
                avg_buy_price=(float(b["cost"]) / shares if shares else 0.0),
                buy_date=str(b["buy_date"]),
            )
        )
    return out


def resolve_user_holdings(db: Session, user_id: str) -> list[LegacyHolding]:
    """The user's primary-portfolio holdings in legacy ``Holding`` shape.

    Drop-in for the old global ``db.query(Holding).all()``. Returns [] when the
    user has no portfolio yet (no side-effecting auto-create on read paths)."""
    portfolio = primary_portfolio(db, user_id, create=False)
    if portfolio is None:
        return []
    holdings = (
        db.query(PortfolioHoldingORM)
        .filter(PortfolioHoldingORM.portfolio_id == portfolio.id)
        .all()
    )
    return manager_holdings_as_legacy(holdings)


def all_held_symbols(db: Session, limit: int | None = None) -> list[str]:
    """Union of symbols held across *all* users' portfolios.

    For background workers (news ingest, cache prefetch) that warm data for held
    tickers. Symbol-level only — no per-user data leaves this, so the union is
    fine and there's no display leak."""
    rows = db.query(PortfolioHoldingORM.symbol).all()
    symbols = sorted({str(r[0]).strip().upper() for r in rows if r and r[0]})
    return symbols[:limit] if limit else symbols
