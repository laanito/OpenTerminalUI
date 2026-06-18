from typing import List
from sqlalchemy import or_
from sqlalchemy.orm import Session
from backend.instruments.models import InstrumentMaster
from backend.instruments.schemas import InstrumentSearchResult
from backend.instruments.text import fold_text

# Cap on rows pulled from the DB before scoring (bounds work for broad substrings).
_CANDIDATE_CAP = 200

# Exchange -> ISO-3166-1 alpha-2, so the FE can render a flag. Crypto and
# unknown (e.g. some Yahoo-fallback) exchanges map to None (no flag shown).
_EXCHANGE_COUNTRY = {
    "NASDAQ": "US", "NYSE": "US", "NYSE ARCA": "US", "AMEX": "US",
    "CBOE BZX": "US", "IEX": "US", "US": "US",
    "XETRA": "DE", "FRANKFURT": "DE",
    "EURONEXT PARIS": "FR",
    "EURONEXT AMSTERDAM": "NL",
    "EURONEXT BRUSSELS": "BE",
    "EURONEXT LISBON": "PT",
    "EURONEXT DUBLIN": "IE",
    "BORSA ITALIANA": "IT",
    "BME MADRID": "ES",
    "LSE": "GB",
    "SIX SWISS": "CH",
    "NASDAQ STOCKHOLM": "SE",
    "NASDAQ HELSINKI": "FI",
    "NASDAQ COPENHAGEN": "DK",
    "OSLO BORS": "NO",
    "WIENER BORSE": "AT",
    "NSE": "IN", "BSE": "IN",
}


def country_for_exchange(exchange: str | None) -> str | None:
    return _EXCHANGE_COUNTRY.get((exchange or "").strip().upper())


def _to_result(r: InstrumentMaster) -> InstrumentSearchResult:
    # tick_size / lot_size are stored as strings; expose floats when parseable.
    tick = None
    if r.tick_size:
        try:
            tick = float(r.tick_size)
        except ValueError:
            pass
    lot = None
    if r.lot_size:
        try:
            lot = float(r.lot_size)
        except ValueError:
            pass
    return InstrumentSearchResult(
        canonical_id=r.canonical_id,
        display_symbol=r.display_symbol,
        name=r.name,
        type=r.type,
        exchange=r.exchange,
        currency=r.currency,
        country_code=country_for_exchange(r.exchange),
        vendor_ids=r.vendor_mappings_json or {},
        tick_size=tick,
        lot_size=lot,
    )


def _score(symbol_upper: str, name_folded: str, q_upper: str, q_folded: str) -> int:
    """Relevance bands: exact ticker > ticker-prefix > name-prefix > name-word-
    prefix > ticker-substring > name-substring. Name is scored separately from
    the ticker (so "apple" -> AAPL via the name, not MLP via "Pine*apple*").
    Shorter matches rank higher within a band; ties fall back to length/alpha."""
    if symbol_upper == q_upper:
        return 1000
    if symbol_upper.startswith(q_upper):
        return 700 - min(len(symbol_upper), 99)
    if name_folded.startswith(q_folded):
        return 600 - min(len(name_folded), 99)
    if any(word.startswith(q_folded) for word in name_folded.split()):
        return 500 - min(len(name_folded), 99)
    if q_upper in symbol_upper:
        return 400 - min(len(symbol_upper), 99)
    if q_folded in name_folded:
        return 150
    return 0


def search_instruments(db: Session, query: str, limit: int = 20) -> List[InstrumentSearchResult]:
    q_upper = query.upper().strip()
    if not q_upper:
        return []
    q_folded = fold_text(query)

    like_sym = f"%{q_upper}%"
    like_blob = f"%{q_folded}%"
    candidates = (
        db.query(InstrumentMaster)
        .filter(
            or_(
                InstrumentMaster.display_symbol.like(like_sym),
                InstrumentMaster.search_blob.like(like_blob),
                InstrumentMaster.name.ilike(like_sym),
            )
        )
        .limit(_CANDIDATE_CAP)
        .all()
    )

    scored = []
    for r in candidates:
        symbol_upper = (r.display_symbol or "").upper()
        name_folded = fold_text(r.name)
        s = _score(symbol_upper, name_folded, q_upper, q_folded)
        if s <= 0:
            continue
        scored.append((-s, len(symbol_upper), symbol_upper, r))

    scored.sort(key=lambda t: (t[0], t[1], t[2]))

    seen = set()
    final: List[InstrumentSearchResult] = []
    for _, _, _, r in scored:
        if r.canonical_id in seen:
            continue
        seen.add(r.canonical_id)
        final.append(_to_result(r))
        if len(final) >= limit:
            break
    return final
