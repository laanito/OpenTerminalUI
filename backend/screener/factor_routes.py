from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.core.factor_analysis import factor_breakdown, top_factor_ideas
from backend.shared.market_defaults import DEFAULT_EQUITY_REGION

router = APIRouter(prefix="/stock-picking", tags=["stock-picking"])


class FactorWeights(BaseModel):
    value: float = Field(default=0.30, ge=0.0)
    momentum: float = Field(default=0.30, ge=0.0)
    quality: float = Field(default=0.25, ge=0.0)
    low_volatility: float = Field(default=0.15, ge=0.0)

    def as_dict(self) -> dict[str, float]:
        return {
            "value": self.value,
            "momentum": self.momentum,
            "quality": self.quality,
            "low_volatility": self.low_volatility,
        }


class IdeaListRequest(BaseModel):
    market: str = DEFAULT_EQUITY_REGION
    universe: str | None = None
    sector: str | None = None
    as_of: str | None = None
    limit: int = Field(default=100, ge=1, le=500)
    weights: FactorWeights = Field(default_factory=FactorWeights)
    data_version_id: str | None = None


@router.post("/ideas")
def post_factor_ideas(payload: IdeaListRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    items = top_factor_ideas(
        db,
        market=payload.market,
        universe=payload.universe,
        sector=payload.sector,
        as_of=payload.as_of,
        weights=payload.weights.as_dict(),
        limit=payload.limit,
        data_version_id=payload.data_version_id,
    )
    return {"items": items, "count": len(items)}


@router.get("/ideas")
def get_factor_ideas(
    market: str = Query(default=DEFAULT_EQUITY_REGION),
    universe: str | None = Query(default=None),
    sector: str | None = Query(default=None),
    as_of: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    items = top_factor_ideas(
        db,
        market=market,
        universe=universe,
        sector=sector,
        as_of=as_of,
        limit=limit,
    )
    return {"items": items, "count": len(items)}


@router.get("/factors/{symbol}")
def get_factor_breakdown(
    symbol: str,
    market: str = Query(default=DEFAULT_EQUITY_REGION),
    universe: str | None = Query(default=None),
    as_of: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    row = factor_breakdown(db, symbol=symbol, market=market, universe=universe, as_of=as_of)
    if row is None:
        raise HTTPException(status_code=404, detail="No factor data available for symbol")
    return row
