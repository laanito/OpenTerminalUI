"""Read-only quote identity for legacy symbol-only watchlists; no provider calls."""
from collections import defaultdict
from typing import Iterable

from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.instruments.models import InstrumentMaster
from backend.shared.market_classifier import crypto_quote_currency, foreign_symbol_currency, is_crypto_symbol


def _route(symbol: str, market: str | None, quote_symbol: str, currency: str | None, status: str = "resolved") -> dict:
    return {"symbol": symbol, "market": market, "quote_symbol": quote_symbol, "currency": currency, "status": status}


def resolve_watchlist_quotes(db: Session, symbols: Iterable[str]) -> dict[str, dict]:
    names = list(dict.fromkeys(s.strip().upper() for s in symbols if s.strip()))
    if not names:
        return {}
    catalog = defaultdict(list)
    for row in db.query(InstrumentMaster).filter(func.upper(InstrumentMaster.display_symbol).in_(names)).all():
        catalog[row.display_symbol.upper()].append(row)
    result = {}
    for symbol in names:
        rows = catalog[symbol]
        currencies = {row.currency for row in rows if row.currency}
        currency = next(iter(currencies)) if len(currencies) == 1 else None
        prefix, raw = symbol.split(":", 1) if ":" in symbol else ("", symbol)
        foreign = foreign_symbol_currency(raw)
        if foreign:
            result[symbol] = _route(symbol, "EU", raw, currency if currencies else foreign)
            continue
        if raw.endswith((".NS", ".BO")):
            result[symbol] = _route(symbol, "NSE" if raw.endswith(".NS") else "BSE", raw[:-3], currency or "INR")
            continue
        if is_crypto_symbol(raw) or prefix == "CRYPTO":
            quote = raw if is_crypto_symbol(raw) else f"{raw}-USD"
            result[symbol] = _route(symbol, "CRYPTO", quote, currency or crypto_quote_currency(quote))
            continue
        if prefix:
            if prefix in {"NSE", "BSE", "NASDAQ", "NYSE"} and raw:
                result[symbol] = _route(symbol, prefix, raw, "INR" if prefix in {"NSE", "BSE"} else "USD")
            else:
                result[symbol] = _route(symbol, None, raw, None, "unsupported")
            continue
        candidates = set()
        for row in rows:
            exchange = (row.exchange or "").upper()
            quote = str((row.vendor_mappings_json or {}).get("yahoo") or symbol).upper()
            market = None
            if (row.type or "").lower() == "crypto":
                market = "CRYPTO"
            elif foreign_symbol_currency(quote):
                market = "EU"
            elif exchange in {"NSE", "BSE"}:
                market = exchange
                quote = quote.removesuffix(".NS").removesuffix(".BO")
            elif exchange.startswith("NASDAQ") or exchange in {"AMEX", "NYSE ARCA", "NYSE MKT", "CBOE BZX", "IEX", "US", "NMS", "NGM", "NCM", "NAS", "NYSEARCA", "ASE", "PCX"}:
                market = "NASDAQ"
            elif exchange in {"NYSE", "NYQ"}:
                market = "NYSE"
            if market:
                unit = row.currency or (crypto_quote_currency(quote) if market == "CRYPTO" else foreign_symbol_currency(quote) if market == "EU" else "INR" if market in {"NSE", "BSE"} else "USD")
                candidates.add((market, quote, unit))
        if len(candidates) == 1:
            market, quote, unit = next(iter(candidates))
            result[symbol] = _route(symbol, market, quote, unit)
        elif rows:
            result[symbol] = _route(symbol, None, symbol, None, "ambiguous" if len(candidates) > 1 else "unsupported")
        else:
            # Existing application convention for a bare, unqualified US ticker.
            result[symbol] = _route(symbol, "NASDAQ", symbol, "USD")
    return result
