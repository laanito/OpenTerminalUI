from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from datetime import datetime, timezone
from datetime import timedelta
import os
from pathlib import Path
from typing import Protocol

import pandas as pd
import requests
import yfinance as yf

from backend.core.symbols import Symbol, normalize_symbol

_YF_CACHE_DIR = Path(__file__).resolve().parents[2] / ".yf_cache"
_YF_CACHE_DIR.mkdir(parents=True, exist_ok=True)
_HTTP = requests.Session()
_HTTP.trust_env = False
if os.getenv("LTS_DISABLE_PROXY", "1") == "1":
    for proxy_key in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]:
        os.environ.pop(proxy_key, None)
    os.environ["NO_PROXY"] = "*"
    os.environ["no_proxy"] = "*"
try:
    yf.set_tz_cache_location(str(_YF_CACHE_DIR))
except Exception:
    pass


@dataclass(frozen=True)
class OhlcvBar:
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: int


class HistoricalDataProvider(Protocol):
    def get_daily_ohlcv(self, symbol: Symbol, start: str, end: str) -> list[OhlcvBar]:
        ...

    def get_intraday_ohlcv(self, symbol: Symbol, start: str, end: str, interval: str) -> list[OhlcvBar]:
        ...


class YahooHistoricalDataProvider:
    def get_daily_ohlcv(self, symbol: Symbol, start: str, end: str) -> list[OhlcvBar]:
        frame = pd.DataFrame()
        # Prefer direct chart endpoint first; this avoids yfinance parser/cache edge cases.
        try:
            frame = self._fetch_history_chart_api(symbol.provider_symbol, start, end, "1d")
        except Exception:
            frame = pd.DataFrame()

        if frame.empty:
            frame = yf.download(
                symbol.provider_symbol,
                start=start,
                end=end,
                auto_adjust=False,
                progress=False,
            )
        if frame.empty:
            return []
        if isinstance(frame.columns, pd.MultiIndex):
            # yf can return a single-symbol multi-index frame in some versions
            frame.columns = frame.columns.get_level_values(0)
        rows: list[OhlcvBar] = []
        for idx, row in frame.iterrows():
            rows.append(
                OhlcvBar(
                    date=idx.strftime("%Y-%m-%d %H:%M:%S"),
                    open=float(row.get("Open", 0.0)),
                    high=float(row.get("High", 0.0)),
                    low=float(row.get("Low", 0.0)),
                    close=float(row.get("Close", 0.0)),
                    volume=int(row.get("Volume", 0) or 0),
                )
            )
        return rows

    def get_intraday_ohlcv(self, symbol: Symbol, start: str, end: str, interval: str) -> list[OhlcvBar]:
        frame = pd.DataFrame()
        try:
            frame = self._fetch_history_chart_api(symbol.provider_symbol, start, end, interval)
        except Exception:
            pass
        if frame.empty:
            # Fallback to yf download
            try:
                frame = yf.download(
                    symbol.provider_symbol,
                    start=start,
                    end=end,
                    interval=interval,
                    auto_adjust=False,
                    progress=False,
                )
            except Exception:
                pass

        if frame.empty:
            return []
        if isinstance(frame.columns, pd.MultiIndex):
            frame.columns = frame.columns.get_level_values(0)

        rows: list[OhlcvBar] = []
        for idx, row in frame.iterrows():
            rows.append(
                OhlcvBar(
                    date=idx.strftime("%Y-%m-%d %H:%M:%S"),
                    open=float(row.get("Open", 0.0)),
                    high=float(row.get("High", 0.0)),
                    low=float(row.get("Low", 0.0)),
                    close=float(row.get("Close", 0.0)),
                    volume=int(row.get("Volume", 0) or 0),
                )
            )
        return rows

    def _fetch_history_chart_api(self, provider_symbol: str, start: str, end: str, interval: str = "1d") -> pd.DataFrame:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{provider_symbol}"
        start_ts = int(datetime.fromisoformat(start).replace(tzinfo=timezone.utc).timestamp())
        end_ts = int(datetime.fromisoformat(end).replace(tzinfo=timezone.utc).timestamp()) + 86399
        params = {"period1": start_ts, "period2": end_ts, "interval": interval, "events": "div,splits"}
        headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json,text/plain,*/*"}
        response = _HTTP.get(url, params=params, headers=headers, timeout=8)
        response.raise_for_status()
        payload = response.json()
        chart = (payload.get("chart") or {}).get("result") or []
        if not chart:
            return pd.DataFrame()
        node = chart[0]
        ts = node.get("timestamp") or []
        quote = (((node.get("indicators") or {}).get("quote") or [{}])[0]) or {}
        if not ts:
            return pd.DataFrame()
        df = pd.DataFrame(
            {
                "Open": quote.get("open") or [],
                "High": quote.get("high") or [],
                "Low": quote.get("low") or [],
                "Close": quote.get("close") or [],
                "Volume": quote.get("volume") or [],
            }
        )
        if df.empty:
            return pd.DataFrame()
        dt_index = [datetime.fromtimestamp(int(x), tz=timezone.utc) for x in ts[: len(df)]]
        df = df.iloc[: len(dt_index)].copy()
        df.index = pd.DatetimeIndex(dt_index)
        return df.dropna(how="all")


class HistoricalDataService:
    def __init__(self, provider: HistoricalDataProvider | None = None) -> None:
        self._provider = provider or YahooHistoricalDataProvider()

    def fetch_daily_ohlcv(
        self,
        raw_symbol: str,
        market: str = "NSE",
        start: str | None = None,
        end: str | None = None,
        limit: int = 500,
    ) -> tuple[Symbol, list[OhlcvBar]]:
        symbol = normalize_symbol(raw_symbol, market)
        end_val = end or date.today().isoformat()
        start_val = start or "2000-01-01"
        bars = self._provider.get_daily_ohlcv(symbol, start=start_val, end=end_val)
        # Integrity: never substitute a synthetic random-walk series when the
        # provider has no data. Backtests / tearsheets / charts must run on real
        # history or none at all — callers handle the empty case.
        if limit > 0:
            bars = bars[-limit:]
        return symbol, bars

    def fetch_intraday_ohlcv(
        self,
        raw_symbol: str,
        timeframe: str,
        market: str = "NSE",
        start: str | None = None,
        end: str | None = None,
        limit: int = 0,
    ) -> tuple[Symbol, list[OhlcvBar]]:
        symbol = normalize_symbol(raw_symbol, market)
        end_val = end or date.today().isoformat()
        start_val = start or (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")

        try:
            bars = self._provider.get_intraday_ohlcv(symbol, start=start_val, end=end_val, interval=timeframe)
        except Exception:
            bars = []

        # Integrity: no synthetic-intraday substitution. Empty means "no data".
        if limit > 0:
            bars = bars[-limit:]
        return symbol, bars


_historical_data_service = HistoricalDataService()


def get_historical_data_service() -> HistoricalDataService:
    return _historical_data_service
