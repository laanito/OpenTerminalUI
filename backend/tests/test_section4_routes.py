import asyncio

import pandas as pd

from backend.api.routes import screener


def test_multimarket_scan_filters_and_sorts(monkeypatch) -> None:
    async def _fake_hydrate(tickers, warnings, refresh_cap=30):
        df = pd.DataFrame(
            [
                {"ticker": "INFY", "market_cap": 1000, "pe": 20, "sector": "Technology"},
                {"ticker": "ITC", "market_cap": 500, "pe": 30, "sector": "Consumer"},
            ]
        )
        return df, 0

    async def _fake_snapshot(symbol: str):
        return {
            "ticker": symbol,
            "exchange": "NASDAQ",
            "market_cap": 2000 if symbol == "AAPL" else 1500,
            "pe": 18,
            "sector": "Technology",
        }

    monkeypatch.setattr(screener, "_hydrate_missing_screener_rows", _fake_hydrate)
    monkeypatch.setattr(screener, "fetch_stock_snapshot_coalesced", _fake_snapshot)

    req = screener.ScreenerScanRequest(
        markets=["NSE", "NASDAQ"],
        filters=[screener.ScreenerScanFilter(field="market_cap", op="gte", value=900)],
        sort=screener.ScreenerScanSort(field="market_cap", order="desc"),
        limit=5,
    )
    payload = asyncio.run(screener.run_multimarket_scan(req))
    assert payload["count"] >= 1
    assert payload["rows"][0]["market_cap"] >= payload["rows"][-1]["market_cap"]
