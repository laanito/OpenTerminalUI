"""Watchlist-items endpoints.

The legacy global portfolio (a single, user-less `Holding` table) and its
analytics / tax-lot / attribution endpoints were removed in v1.1 (part C) — the
per-user Portfolio Manager (`/api/portfolios`) fully replaces them. This module
now only serves the enriched watchlist-items feed, which was always global and
is intentionally kept.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.db.models import WatchlistItem
from backend.shared.market_classifier import market_classifier

router = APIRouter()


class WatchlistCreate(BaseModel):
    watchlist_name: str
    ticker: str


# Enriched, flattened watchlist items (per-symbol classification: country, flags,
# F&O availability). Served at /watchlists/items so it does NOT collide with the
# multi-watchlist router's GET /watchlists (which returns the lists themselves and
# was shadowing this handler, leaving the items feed unreachable).
@router.get("/watchlists/items")
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


@router.post("/watchlists/items")
def add_watchlist_item(payload: WatchlistCreate, db: Session = Depends(get_db)) -> dict[str, object]:
    row = WatchlistItem(watchlist_name=payload.watchlist_name.strip(), ticker=payload.ticker.strip().upper())
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"status": "created", "item": {"id": row.id, "watchlist_name": row.watchlist_name, "ticker": row.ticker}}


@router.delete("/watchlists/items/{item_id}")
def delete_watchlist_item(item_id: int, db: Session = Depends(get_db)) -> dict[str, object]:
    row = db.query(WatchlistItem).filter(WatchlistItem.id == item_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Watchlist item not found")
    db.delete(row)
    db.commit()
    return {"status": "deleted", "id": item_id}
