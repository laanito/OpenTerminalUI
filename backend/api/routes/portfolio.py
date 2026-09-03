"""Deprecated installation-wide watchlist-items compatibility endpoints.

The legacy global portfolio (a single, user-less `Holding` table) and its
analytics / tax-lot / attribution endpoints were removed in v1.1 (part C) — the
per-user Portfolio Manager (`/api/portfolios`) fully replaces them. This module
now serves only the old global feed used by background reports, prefetch,
dividends, and news ingestion. Supported frontend consumers use the owner-scoped
`/api/watchlists` contract. These routes remain temporarily for administrators
while the remaining background consumers are migrated.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.auth.deps import require_role
from backend.db.models import WatchlistItem
from backend.models import UserRole
from backend.shared.market_classifier import market_classifier

router = APIRouter(dependencies=[Depends(require_role(UserRole.ADMIN.value))])


class WatchlistCreate(BaseModel):
    watchlist_name: str
    ticker: str


# Enriched, flattened installation-wide items (per-symbol classification:
# country, flags, F&O availability). This legacy shape is distinct from the
# canonical multi-watchlist response and must not regain frontend consumers.
@router.get("/watchlists/items", deprecated=True)
async def get_watchlists(db: Session = Depends(get_db)) -> dict[str, list[dict[str, object]]]:
    items = db.query(WatchlistItem).all()
    sem = asyncio.Semaphore(16)

    async def _classify(ticker: str) -> dict[str, object]:
        async with sem:
            try:
                return (await market_classifier.classify(ticker)).model_dump()
            except Exception:
                return {}

    tasks = {x.id: asyncio.create_task(_classify(x.ticker)) for x in items}
    classifications = {item_id: await task for item_id, task in tasks.items()}
    return {
        "items": [
            {
                "id": x.id,
                "watchlist_name": x.watchlist_name,
                "ticker": x.ticker,
                "country_code": classifications.get(x.id, {}).get("country_code"),
                "flag_emoji": classifications.get(x.id, {}).get("flag_emoji"),
                "exchange": classifications.get(x.id, {}).get("exchange"),
                "has_futures": bool(classifications.get(x.id, {}).get("has_futures")),
                "has_options": bool(classifications.get(x.id, {}).get("has_options")),
            }
            for x in items
        ]
    }


@router.post("/watchlists/items", deprecated=True)
def add_watchlist_item(payload: WatchlistCreate, db: Session = Depends(get_db)) -> dict[str, object]:
    row = WatchlistItem(watchlist_name=payload.watchlist_name.strip(), ticker=payload.ticker.strip().upper())
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"status": "created", "item": {"id": row.id, "watchlist_name": row.watchlist_name, "ticker": row.ticker}}


@router.delete("/watchlists/items/{item_id}", deprecated=True)
def delete_watchlist_item(item_id: int, db: Session = Depends(get_db)) -> dict[str, object]:
    row = db.query(WatchlistItem).filter(WatchlistItem.id == item_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Watchlist item not found")
    db.delete(row)
    db.commit()
    return {"status": "deleted", "id": item_id}
