from __future__ import annotations

import time
import asyncio
from typing import Any

from fastapi import APIRouter

from backend.api.deps import get_unified_fetcher
from backend.shared.nse_access import nse_public_enabled

router = APIRouter()

async def _probe(name: str, coro) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        # Await the coroutine provided
        await coro
        return {
            "name": name,
            "status": "ok",
            "latency_ms": round((time.perf_counter() - started) * 1000, 1)
        }
    except Exception as exc:
        return {
            "name": name,
            "status": "down",
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
            "error": str(exc),
        }

@router.get("/health/datasources")
async def datasource_health() -> dict[str, Any]:
    fetcher = await get_unified_fetcher()

    # Define checks using actual async methods from new clients
    checks_map = []

    # Direct NSE website access is an opt-in compatibility provider. Do not
    # probe (or degrade overall health) when the host intentionally disabled it.
    nse_disabled = not nse_public_enabled()
    if not nse_disabled:
        checks_map.append(_probe("nse-public", fetcher.nse.get_market_status()))

    # Yahoo: get_quotes (lightweight)
    checks_map.append(_probe("yahoo", fetcher.yahoo.get_quotes(["RELIANCE.NS"])))

    # FMP: if key exists
    if fetcher.fmp.api_key:
        checks_map.append(_probe("fmp", fetcher.fmp.get_quote("RELIANCE")))

    # Finnhub: if key exists
    if fetcher.finnhub.api_key:
        checks_map.append(_probe("finnhub", fetcher.finnhub.get_company_profile("RELIANCE")))

    # Kite Connect: configuration check (session-based API; auth token required for remote probes)
    if fetcher.kite.api_key:
        checks_map.append(
            _probe(
                "kite_config",
                asyncio.sleep(0, result={"configured": fetcher.kite.is_configured}),
            )
        )

    results = await asyncio.gather(*checks_map)
    if nse_disabled:
        results.append({"name": "nse-public", "status": "disabled", "latency_ms": 0.0})

    overall = "ok" if all(r["status"] in {"ok", "disabled"} for r in results) else "degraded"
    return {"status": overall, "sources": list(results)}
