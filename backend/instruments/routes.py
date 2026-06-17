import os

from fastapi import APIRouter, BackgroundTasks, Query, Depends
from sqlalchemy.orm import Session
from backend.api.deps import get_db
from backend.instruments.live_search import yahoo_search
from backend.instruments.populate import persist_discovered
from backend.instruments.schemas import InstrumentSearchResponse, InstrumentSearchResult
from backend.instruments.search import search_instruments as _search_instruments

router = APIRouter(prefix="/instruments", tags=["instruments"])

# When the seeded DB returns fewer than this, consult the live Yahoo fallback.
_LIVE_FALLBACK_THRESHOLD = 3


def _live_search_enabled() -> bool:
    # On by default; conftest forces off so tests stay offline.
    return os.getenv("OPENTERMINALUI_INSTRUMENT_LIVE_SEARCH", "1") == "1"


def _row_to_result(row: dict) -> InstrumentSearchResult:
    return InstrumentSearchResult(
        canonical_id=row["canonical_id"],
        display_symbol=row["display_symbol"],
        name=row.get("name"),
        type=row["type"],
        exchange=row["exchange"],
        currency=row.get("currency"),
        vendor_ids=row.get("vendor_mappings_json") or {},
    )


@router.get("/search", response_model=InstrumentSearchResponse)
async def search_instruments(
    q: str = Query(..., min_length=1, description="Search query"),
    db: Session = Depends(get_db),
    background_tasks: BackgroundTasks = None,
):
    results = _search_instruments(db, q)

    # Long-tail fallback: if the seeded universe barely matches, resolve via
    # Yahoo and lazily persist the hits (source='yahoo') for next time.
    if len(results) < _LIVE_FALLBACK_THRESHOLD and _live_search_enabled():
        rows = await yahoo_search(q, limit=20)
        if rows:
            seen = {r.display_symbol for r in results}
            for row in rows:
                if row["display_symbol"] in seen:
                    continue
                results.append(_row_to_result(row))
                seen.add(row["display_symbol"])
                if len(results) >= 20:
                    break
            if background_tasks is not None:
                background_tasks.add_task(persist_discovered, rows)

    return InstrumentSearchResponse(results=results)
