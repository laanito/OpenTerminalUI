from __future__ import annotations

from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query
from backend.api.deps import get_unified_fetcher
from backend.core.models import (
    ETFScreenerResponse,
    ETFHoldingsResponse,
    ETFHolding,
    ETFOverlapResponse,
    ETFFlowResponse,
)
from backend.shared.degraded import (
    REASON_NO_LIVE_SOURCE,
    REASON_PROVIDER_ERROR,
    degraded_marker,
)

router = APIRouter(prefix="/etf", tags=["etf"])

@router.get("/screener", response_model=List[ETFScreenerResponse])
async def etf_screener(category: Optional[str] = None):
    # No live ETF screener provider is wired. Return empty rather than the old
    # hardcoded US+India ETF list presented as live (v1.0 silent-mock audit).
    return []

@router.get("/holdings", response_model=ETFHoldingsResponse)
async def etf_holdings(ticker: str):
    fetcher = await get_unified_fetcher()
    # Yahoo modules for ETF: topHoldings
    try:
        summary = await fetcher.yahoo.get_quote_summary(ticker, modules=["topHoldings"])
        holdings_data = summary.get("topHoldings", {})
        holdings_list = holdings_data.get("holdings", [])

        result_holdings = []
        for h in holdings_list:
            result_holdings.append(ETFHolding(
                symbol=h.get("symbol", ""),
                name=h.get("holdingName", ""),
                weight=h.get("holdingPercent", {}).get("raw", 0.0) * 100 if isinstance(h.get("holdingPercent"), dict) else (h.get("holdingPercent", 0.0) * 100)
            ))

        # Integrity: no hardcoded AAPL/MSFT placeholder when Yahoo returns
        # nothing — return empty + degraded so the UI shows "no holdings".
        degraded = None if result_holdings else degraded_marker(REASON_NO_LIVE_SOURCE)
        return ETFHoldingsResponse(ticker=ticker.upper(), holdings=result_holdings, degraded=degraded)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch holdings: {str(e)}")

@router.get("/overlap", response_model=ETFOverlapResponse)
async def etf_overlap(tickers: str = Query(...)):
    ticker_list = [t.strip().upper() for t in tickers.split(",")]
    if len(ticker_list) < 2:
        raise HTTPException(status_code=400, detail="Provide at least two tickers for overlap analysis")

    fetcher = await get_unified_fetcher()

    all_holdings = {}
    for ticker in ticker_list:
        try:
            summary = await fetcher.yahoo.get_quote_summary(ticker, modules=["topHoldings"])
            holdings_data = summary.get("topHoldings", {})
            holdings_list = holdings_data.get("holdings", [])

            ticker_holdings = {}
            for h in holdings_list:
                symbol = h.get("symbol", "")
                if symbol:
                    ticker_holdings[symbol] = {
                        "name": h.get("holdingName", ""),
                        "weight": h.get("holdingPercent", {}).get("raw", 0.0) * 100 if isinstance(h.get("holdingPercent"), dict) else (h.get("holdingPercent", 0.0) * 100)
                    }
            all_holdings[ticker] = ticker_holdings
        except Exception:
            all_holdings[ticker] = {}

    # Calculate overlap between the first two for now
    t1, t2 = ticker_list[0], ticker_list[1]
    h1, h2 = all_holdings.get(t1, {}), all_holdings.get(t2, {})

    common_symbols = set(h1.keys()) & set(h2.keys())
    common_holdings = []
    total_overlap = 0.0

    for symbol in common_symbols:
        w1 = h1[symbol]["weight"]
        w2 = h2[symbol]["weight"]
        # Overlap weight is the minimum of the two weights
        overlap_w = min(w1, w2)
        total_overlap += overlap_w
        common_holdings.append(ETFHolding(
            symbol=symbol,
            name=h1[symbol]["name"],
            weight=overlap_w
        ))

    # Sort by overlap weight
    common_holdings.sort(key=lambda x: x.weight, reverse=True)

    # If neither ticker returned holdings, the overlap is meaningless rather than
    # genuinely zero — flag it degraded.
    no_holdings = not h1 and not h2
    return ETFOverlapResponse(
        tickers=ticker_list,
        overlap_pct=total_overlap,
        common_holdings=common_holdings,
        degraded=degraded_marker(REASON_PROVIDER_ERROR) if no_holdings else None,
    )

@router.get("/flows", response_model=ETFFlowResponse)
async def etf_flows(ticker: str):
    # No live fund-flows source is wired. Return empty + degraded rather than the
    # old random.uniform() series presented as real flows (v1.0 silent-mock audit).
    return ETFFlowResponse(
        ticker=ticker.upper(),
        flows=[],
        degraded=degraded_marker(REASON_NO_LIVE_SOURCE),
    )
