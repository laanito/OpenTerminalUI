"""Cash ledger for user portfolios — the single source of truth for cash.

The portfolio's transaction ledger (``PortfolioTransactionORM``) is authoritative:
cash is *derived* from ``starting_cash`` plus the signed impact of every recorded
transaction, never stored as a separate balance that could drift from the trades.
This is the v1.1 "portfolio becomes real" spine — a buy debits cash, a sell or
dividend credits it, and explicit deposits/withdrawals move cash in and out.

Amount conventions (matching the existing ``PortfolioTransactionORM`` fields):
- ``buy``/``sell``: notional is ``shares * price``; ``fees`` always cost you cash.
- ``dividend``/``deposit``/``withdrawal``: the total amount lives in ``price``
  (``shares`` is 0), consistent with how ``dividend_income_ytd`` already sums
  ``price`` for dividend rows.

Functions here are pure (they take plain values or any object exposing
``type``/``shares``/``price``/``fees``) so they are trivially unit-testable and
reusable across the list, detail, and analytics endpoints.
"""
from __future__ import annotations

from typing import Any, Iterable

# Transaction types recognised by the cash ledger.
TRADE_TYPES = frozenset({"buy", "sell"})
CASH_ONLY_TYPES = frozenset({"dividend", "deposit", "withdrawal"})
LEDGER_TYPES = TRADE_TYPES | CASH_ONLY_TYPES


def cash_delta(tx_type: str, shares: float = 0.0, price: float = 0.0, fees: float = 0.0) -> float:
    """Signed cash impact of a single transaction (positive = cash in).

    Unknown types contribute 0.0 so a stray row never silently invents cash.
    """
    t = (tx_type or "").strip().lower()
    shares = float(shares or 0.0)
    price = float(price or 0.0)
    fees = float(fees or 0.0)

    if t == "buy":
        return -(shares * price + fees)
    if t == "sell":
        return shares * price - fees
    if t == "dividend":
        return price - fees
    if t == "deposit":
        return price - fees
    if t == "withdrawal":
        return -(price + fees)
    return 0.0


def _tx_delta(tx: Any) -> float:
    return cash_delta(
        getattr(tx, "type", ""),
        getattr(tx, "shares", 0.0),
        getattr(tx, "price", 0.0),
        getattr(tx, "fees", 0.0),
    )


def cash_balance(starting_cash: float, transactions: Iterable[Any]) -> float:
    """Current cash = opening balance + net impact of every transaction."""
    balance = float(starting_cash or 0.0)
    for tx in transactions:
        balance += _tx_delta(tx)
    return balance
