from __future__ import annotations

from fastapi import APIRouter

from backend.shared.degraded import REASON_NO_LIVE_SOURCE, degraded_marker

router = APIRouter()

# NOTE: The Relative Strength engine is not yet wired to a live source. The
# previous implementation returned hardcoded Indian data (RELIANCE/TCS/INFY,
# NIFTY50) dressed up as live, which violates the fork's "never pass fabricated
# data off as live" rule and was India-centric to boot.
#
# Until the real RS engine lands (US-universe perf-percentile rankings via
# fetch_history, sector RS reusing sector_rotation, RS line = price / benchmark,
# 52w-high scan — tracked as a future roadmap item), every endpoint returns an
# empty payload plus the standard `degraded` marker so the UI flags it clearly
# instead of showing a convincing fake. Defaults are de-India'd (S&P 500 / SPY).


@router.get("/rs/rankings")
async def get_rs_rankings(universe: str = "S&P 500"):
    """RS rankings for a universe (no live engine yet → empty + degraded)."""
    return {
        "universe": universe,
        "items": [],
        "degraded": degraded_marker(REASON_NO_LIVE_SOURCE),
    }


@router.get("/rs/sector-rs")
async def get_sector_rs():
    """RS scores by sector (no live engine yet → empty + degraded)."""
    return {
        "sectors": [],
        "degraded": degraded_marker(REASON_NO_LIVE_SOURCE),
    }


@router.get("/rs/chart/{symbol}")
async def get_rs_chart_data(symbol: str, benchmark: str = "SPY"):
    """RS line vs price (no live engine yet → empty + degraded)."""
    return {
        "symbol": symbol.upper(),
        "benchmark": benchmark.upper(),
        "series": [],
        "degraded": degraded_marker(REASON_NO_LIVE_SOURCE),
    }


@router.get("/rs/new-highs")
async def get_rs_new_highs():
    """Stocks at new 52w highs with high RS (no live engine yet → empty + degraded)."""
    return {
        "items": [],
        "degraded": degraded_marker(REASON_NO_LIVE_SOURCE),
    }
