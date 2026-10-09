"""Pure arithmetic for a price return translated through an FX rate."""

from __future__ import annotations


def decompose_base_currency_return(
    start_price: float,
    end_price: float,
    start_fx: float,
    end_fx: float,
) -> dict[str, float]:
    """Exactly separate a converted return into price, FX and interaction."""
    if start_price <= 0 or start_fx <= 0:
        raise ValueError("start price and FX rate must be positive")
    security = (end_price / start_price) - 1.0
    currency = (end_fx / start_fx) - 1.0
    interaction = security * currency
    total = ((end_price * end_fx) / (start_price * start_fx)) - 1.0
    return {
        "security": security,
        "currency": currency,
        "interaction": interaction,
        "total": total,
    }
