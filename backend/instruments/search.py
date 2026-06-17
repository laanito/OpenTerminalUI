from typing import List
from sqlalchemy import or_
from sqlalchemy.orm import Session
from backend.instruments.models import InstrumentMaster
from backend.instruments.schemas import InstrumentSearchResult


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
        vendor_ids=r.vendor_mappings_json or {},
        tick_size=tick,
        lot_size=lot,
    )


def search_instruments(db: Session, query: str, limit: int = 20) -> List[InstrumentSearchResult]:
    query_upper = query.upper().strip()
    if not query_upper:
        return []

    like = f"%{query_upper}%"
    prefix_like = f"{query_upper}%"

    # 1. Exact ticker match
    exact = db.query(InstrumentMaster).filter(InstrumentMaster.display_symbol == query_upper).all()

    # 2. Prefix match on ticker (excludes the exact hit)
    prefix = (
        db.query(InstrumentMaster)
        .filter(
            InstrumentMaster.display_symbol.like(prefix_like),
            InstrumentMaster.display_symbol != query_upper,
        )
        .limit(limit)
        .all()
    )

    # 3. Fuzzy match on ticker OR name (so "apple" finds AAPL), excluding
    #    anything already covered by the ticker-prefix tier.
    fuzzy = (
        db.query(InstrumentMaster)
        .filter(
            or_(
                InstrumentMaster.display_symbol.like(like),
                InstrumentMaster.name.ilike(like),
            ),
            ~InstrumentMaster.display_symbol.like(prefix_like),
        )
        .limit(limit)
        .all()
    )

    seen = set()
    final: List[InstrumentSearchResult] = []
    for r in exact + prefix + fuzzy:
        if r.canonical_id in seen:
            continue
        seen.add(r.canonical_id)
        final.append(_to_result(r))
        if len(final) >= limit:
            break

    return final
