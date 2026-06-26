from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import pandas as pd
import requests
import yfinance as yf
from backend.shared.cache import cache
from backend.shared.degraded import (
    DEGRADED_KEY,
    REASON_NO_PROVIDER_DATA,
    REASON_PROVIDER_ERROR,
    degraded_marker,
)

logger = logging.getLogger(__name__)

if os.getenv("LTS_DISABLE_PROXY", "1") == "1":
    for proxy_key in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]:
        os.environ.pop(proxy_key, None)
    os.environ["NO_PROXY"] = "*"
    os.environ["no_proxy"] = "*"

def _calculate_rrg_metrics(prices: pd.DataFrame, benchmark_sym: str, window: int = 14) -> Dict[str, Any]:
    # prices: DataFrame with Date index, columns are tickers.
    # Assumes weekly data to be standard RRG.

    if benchmark_sym not in prices.columns:
        raise ValueError(f"Benchmark {benchmark_sym} not found in prices")

    bench_price = prices[benchmark_sym]
    results = {}

    # Fill NA and resample to weekly if not already (assume weekly passed in)

    for col in prices.columns:
        if col == benchmark_sym:
            continue

        sector_price = prices[col]

        # Relative Strength
        rs = sector_price / bench_price

        # RS-Ratio: Normalized RS
        rs_mean = rs.rolling(window=window).mean()
        rs_std = rs.rolling(window=window).std()
        # Scale by 5 to spread out around 100
        rs_ratio = 100 + ((rs - rs_mean) / rs_std.replace(0, 1e-9)) * 5

        # RS-Momentum: Normalized ROC of RS-Ratio
        rs_ratio_mean = rs_ratio.rolling(window=window).mean()
        rs_ratio_std = rs_ratio.rolling(window=window).std()
        rs_momentum = 100 + ((rs_ratio - rs_ratio_mean) / rs_ratio_std.replace(0, 1e-9)) * 5

        # Combine
        df = pd.DataFrame({
            "rs_ratio": rs_ratio,
            "rs_momentum": rs_momentum
        }).dropna()

        if df.empty:
            continue

        # Get last 12 weeks of data for the tail
        tail_df = df.tail(12)

        trail = []
        for idx, row in tail_df.iterrows():
            trail.append({
                "date": idx.strftime("%Y-%m-%d"),
                "x": float(row["rs_ratio"]),
                "y": float(row["rs_momentum"])
            })

        if trail:
            results[col] = {
                "symbol": col,
                "current": trail[-1],
                "trail": trail
            }

    return results

async def fetch_sector_rotation(benchmark: str) -> Dict[str, Any]:
    cache_key = cache.build_key("analytics", "sector_rotation", {"benchmark": benchmark})
    cached = await cache.get(cache_key)
    if cached:
        return cached

    # Common US Sector ETFs + India equivalents if requested
    sectors = []
    if benchmark.upper() in ["SPY", "QQQ"]:
        sectors = ["XLK", "XLF", "XLV", "XLE", "XLI", "XLP", "XLY", "XLU", "XLB", "XLRE", "XLC"]
    elif benchmark.upper() in ["^NSEI", "NIFTY"]:
        # Indian sectors
        sectors = ["BANKNIFTY.NS", "NIFTYIT.NS", "NIFTYAUTO.NS", "NIFTYPHARMA.NS", "NIFTYFMCG.NS", "NIFTYMETAL.NS", "NIFTYENERGY.NS", "NIFTYINFRA.NS", "NIFTYREALTY.NS", "NIFTYMEDIA.NS"]
        benchmark = "^NSEI"
    else:
        # Default to SPY
        sectors = ["XLK", "XLF", "XLV", "XLE", "XLI", "XLP", "XLY", "XLU", "XLB", "XLRE", "XLC"]
        benchmark = "SPY"

    tickers = [benchmark] + sectors

    # We need 14 weeks for RS-Ratio, 14 weeks for RS-Momentum = ~28 weeks + 12 weeks for trail = ~40 weeks.
    # Let's fetch 2 years of weekly data to be safe.
    start_date = (datetime.now() - timedelta(days=730)).strftime("%Y-%m-%d")

    try:
        try:
            data = await asyncio.to_thread(
                yf.download,
                tickers,
                start=start_date,
                interval="1wk",
                auto_adjust=True,
                progress=False
            )
            if data.empty:
                raise ValueError("yfinance returned empty dataframe")
            close_data = data["Close"] if isinstance(data.columns, pd.MultiIndex) else data
            if isinstance(close_data, pd.Series):
                raise ValueError("Insufficient ticker data")
        except Exception as e:
            # Integrity: never synthesize a sine-wave RRG from hashed seeds. When
            # the price source is unavailable, return no sectors + degraded so
            # the UI shows "data unavailable" rather than a fabricated rotation.
            logger.warning("sector rotation download failed: %s", e)
            return {
                "benchmark": benchmark,
                "sectors": [],
                "timestamp": datetime.now(timezone.utc).isoformat(),
                DEGRADED_KEY: degraded_marker(REASON_PROVIDER_ERROR),
            }

        # Drop naive timezone if present
        if close_data.index.tz is not None:
             close_data.index = close_data.index.tz_localize(None)

        results = _calculate_rrg_metrics(close_data, benchmark)

        response = {
            "benchmark": benchmark,
            "sectors": list(results.values()),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        if not results:
            response[DEGRADED_KEY] = degraded_marker(REASON_NO_PROVIDER_DATA)

        await cache.set(cache_key, response, ttl=14400) # 4 hours cache
        return response

    except Exception as e:
        import traceback
        return {"error": str(e), "trace": traceback.format_exc(), DEGRADED_KEY: degraded_marker(REASON_PROVIDER_ERROR)}
