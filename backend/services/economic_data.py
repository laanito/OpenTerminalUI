from __future__ import annotations

import asyncio
import logging
import math
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx
from backend.config.settings import get_settings
from backend.shared.cache import cache
from backend.shared.degraded import (
    DEGRADED_KEY,
    REASON_MISSING_API_KEY,
    REASON_PROVIDER_ERROR,
    SOURCE_FALLBACK,
    degraded_marker,
)

logger = logging.getLogger(__name__)

# Macro Indicator Series IDs (mostly FRED)
# US: GDP (GDPC1), CPI (CPIAUCSL), Unemployment (UNRATE), Fed Funds (FEDFUNDS), PMI (MANPMI), Consumer Confidence (UMCSENT)
# EU: GDP (CLVMEURSCAB1GQEA19), CPI (CP0000EZ19M086NEST), ECB Rate (ECBDFR), Unemployment (LRHUTTTTEZM156S)
# China: GDP (CHNGDPNQDSMEI), CPI (CHNCPIALLMINMEI), Rate (CHNPRIME)

MACRO_CONFIG = {
    "us": {
        "gdp": "GDPC1",
        "cpi": "CPIAUCSL",
        "unemployment": "UNRATE",
        "rate": "FEDFUNDS",
        "pmi": "MANPMI",
        "confidence": "UMCSENT"
    },
    "eu": {
        "gdp": "CLVMEURSCAB1GQEA19",
        "cpi": "CP0000EZ19M086NEST",
        "rate": "ECBDFR",
        "unemployment": "LRHUTTTTEZM156S"
    },
    "china": {
        "gdp": "CHNGDPNQDSMEI",
        "cpi": "CHNCPIALLMINMEI",
        "rate": "CHNPRIME"
    }
}

# Map a frontend country/region code to a MACRO_CONFIG region key.
_COUNTRY_TO_REGION = {
    "US": "us", "USA": "us",
    "EU": "eu", "EZ": "eu", "DE": "eu", "FR": "eu", "ES": "eu", "IT": "eu",
    "CN": "china", "CHINA": "china",
}

# A deliberately small US-only candidate set. These are reference-period
# observations, not dated releases or evidence available to traders then.
MARKET_CONTEXT_FRED_SERIES = {
    "CPIAUCSL": "Consumer prices",
    "UNRATE": "Unemployment rate",
    "FEDFUNDS": "Effective federal funds rate",
}

class EconomicDataService:
    def __init__(self):
        self.settings = get_settings()
        self.fred_key = self.settings.fred_api_key
        self.finnhub_key = self.settings.finnhub_api_key
        self.fmp_key = self.settings.fmp_api_key
        self.base_fred = "https://api.stlouisfed.org/fred"
        self.base_finnhub = "https://finnhub.io/api/v1"
        self.base_fmp = "https://financialmodelingprep.com/stable"

    async def get_market_context_macro_observations(self, start: date, end: date) -> Dict[str, Any]:
        """Get current FRED-vintage observations for bounded reference periods.

        Never use the legacy macro dashboard's sample fallback here. The
        observation date is a period label, not a publication timestamp.
        """
        retrieved_at = datetime.now(timezone.utc)
        realtime_date = retrieved_at.date().isoformat()
        if not self.fred_key:
            return {
                "retrieved_at": retrieved_at, "realtime_date": realtime_date,
                "status": "unavailable", "reason": "missing_api_key", "series": [],
            }

        async with httpx.AsyncClient(timeout=10.0) as client:
            results = await asyncio.gather(*(
                self._fetch_market_context_fred_series(client, series_id, label, start, end, realtime_date)
                for series_id, label in MARKET_CONTEXT_FRED_SERIES.items()
            ), return_exceptions=True)

        groups = []
        for (series_id, label), result in zip(MARKET_CONTEXT_FRED_SERIES.items(), results):
            if isinstance(result, BaseException):
                if not isinstance(result, Exception):
                    raise result
                # HTTP exceptions may contain a URL with the API key.
                logger.warning("FRED macro context failed for %s (%s)", series_id, type(result).__name__)
                groups.append({
                    "series_id": series_id, "label": label, "status": "feed_error",
                    "title": None, "units": None, "frequency": None,
                    "observations": [], "matched_count": 0, "withheld_conflict_count": 0,
                })
            else:
                groups.append(result)
        return {
            "retrieved_at": retrieved_at, "realtime_date": realtime_date,
            "status": "available" if any(group["status"] != "feed_error" for group in groups) else "unavailable",
            "reason": None if any(group["status"] != "feed_error" for group in groups) else "provider_error",
            "series": groups,
        }

    async def _fetch_market_context_fred_series(
        self, client: httpx.AsyncClient, series_id: str, label: str,
        start: date, end: date, realtime_date: str,
    ) -> Dict[str, Any]:
        common = {"series_id": series_id, "api_key": self.fred_key, "file_type": "json",
                  "realtime_start": realtime_date, "realtime_end": realtime_date}
        metadata_response, observations_response = await asyncio.gather(
            client.get(f"{self.base_fred}/series", params=common),
            client.get(f"{self.base_fred}/series/observations", params={
                **common, "observation_start": start.isoformat(),
                "observation_end": end.isoformat(), "sort_order": "asc", "limit": 100,
            }),
        )
        metadata_response.raise_for_status()
        observations_response.raise_for_status()
        metadata = metadata_response.json().get("seriess")
        raw_observations = observations_response.json().get("observations")
        if not isinstance(metadata, list) or len(metadata) != 1 or not isinstance(raw_observations, list):
            raise ValueError("Unexpected FRED macro response")
        info = metadata[0]
        if not isinstance(info, dict) or info.get("id") != series_id:
            raise ValueError("Unexpected FRED series identity")
        title, units, frequency = (info.get(field) for field in ("title", "units", "frequency"))
        if not all(isinstance(value, str) and value.strip() for value in (title, units, frequency)):
            raise ValueError("Incomplete FRED series metadata")

        values: dict[date, float] = {}
        conflicts: set[date] = set()
        for item in raw_observations:
            if not isinstance(item, dict):
                continue
            try:
                observed_on = date.fromisoformat(str(item["date"]))
                value = float(item["value"])
            except (KeyError, TypeError, ValueError, OverflowError):
                continue
            if not start <= observed_on <= end or not math.isfinite(value):
                continue
            if observed_on in values and values[observed_on] != value:
                conflicts.add(observed_on)
            else:
                values[observed_on] = value
        for observed_on in conflicts:
            values.pop(observed_on, None)
        observations = [{"reference_date": day, "value": value} for day, value in sorted(values.items())]
        return {
            "series_id": series_id, "label": label,
            "status": "available" if observations else "no_observations",
            "title": title.strip(), "units": units.strip(), "frequency": frequency.strip(),
            "observations": observations, "matched_count": len(observations),
            "withheld_conflict_count": len(conflicts),
        }

    async def get_economic_calendar(self, start_date: str, end_date: str) -> List[Dict[str, Any]]:
        """Fetch and normalize economic calendar events."""
        cache_key = cache.build_key("econ", "calendar", {"from": start_date, "to": end_date})
        cached = await cache.get(cache_key)
        if cached:
            return cached

        live = await self.get_live_calendar(start_date, end_date)
        # Keep the existing, explicitly flagged sample behavior for the legacy
        # calendar surface. Evidence consumers must use get_live_calendar.
        events = live["events"] or self._get_mock_calendar(start_date, end_date)

        # Sort by date
        events.sort(key=lambda x: (x["date"], x["time"]))

        await cache.set(cache_key, events, ttl=3600)
        return events

    async def get_live_calendar(self, start_date: str, end_date: str) -> Dict[str, Any]:
        """Live-only calendar evidence with provider and degradation status."""
        configured = ",".join(source for source, key in (("finnhub", self.finnhub_key), ("fmp", self.fmp_key)) if key)
        cache_key = cache.build_key("econ", "calendar_live", {"from": start_date, "to": end_date, "providers": configured})
        cached = await cache.get(cache_key)
        if cached is not None:
            return cached

        if not self.finnhub_key and not self.fmp_key:
            result = {"status": "unavailable", "reason": "missing_api_key", "source": None, "events": []}
        else:
            result = {"status": "unavailable", "reason": "provider_error", "source": None, "events": []}
            for source, key in (("finnhub", self.finnhub_key), ("fmp", self.fmp_key)):
                if not key:
                    continue
                try:
                    events = await self._fetch_live_calendar_source(source, key, start_date, end_date)
                except Exception as exc:
                    # HTTP client exceptions can embed tokenized request URLs.
                    logger.warning("%s live calendar failed (%s)", source, type(exc).__name__)
                    continue
                result = {"status": "available", "reason": None, "source": source, "events": events}
                if events:
                    break

        result["retrieved_at"] = datetime.now(timezone.utc).isoformat()
        await cache.set(cache_key, result, ttl=3600 if result["status"] == "available" else 60)
        return result

    async def _fetch_live_calendar_source(self, source: str, key: str, start_date: str, end_date: str) -> List[Dict[str, Any]]:
        if source == "finnhub":
            url = f"{self.base_finnhub}/calendar/economic"
            params = {"from": start_date, "to": end_date, "token": key}
        else:
            url = f"{self.base_fmp}/economic-calendar"
            params = {"from": start_date, "to": end_date, "apikey": key}

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()

        if source == "finnhub":
            if not isinstance(data, dict) or not isinstance(data.get("economicCalendar"), list):
                raise ValueError("Unexpected Finnhub calendar response")
            rows = data["economicCalendar"]
        else:
            rows = data
        if not isinstance(rows, list):
            raise ValueError(f"Unexpected {source} calendar response")
        events: List[Dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            raw_date = str(row.get("date") or "").strip()
            date_parts = raw_date.replace("T", " ").split(" ")
            date_part = date_parts[0]
            try:
                datetime.strptime(date_part, "%Y-%m-%d")
            except ValueError:
                continue
            event_name = str(row.get("event") or "").strip()
            if not event_name:
                continue
            events.append({
                "date": date_part,
                "time": date_parts[1] if source == "finnhub" and len(date_parts) > 1 else "00:00:00",
                "country": row.get("country"),
                "event_name": event_name,
                "impact": self._calendar_impact(row.get("impact")) if source == "finnhub" else "unknown",
                "actual": row.get("actual"),
                "forecast": row.get("estimate"),
                "previous": row.get("prev" if source == "finnhub" else "previous"),
                "unit": row.get("unit") if source == "finnhub" else None,
                "currency": row.get("currency") if source == "finnhub" else None,
            })
        return events

    @staticmethod
    def _calendar_impact(raw: Any) -> str:
        """Do not infer a low-impact event from an absent or unknown provider code."""
        value = str(raw).strip().lower() if raw is not None else ""
        return {
            "3": "high", "high": "high",
            "2": "medium", "medium": "medium", "med": "medium",
            "1": "low", "low": "low",
        }.get(value, "unknown")

    async def get_macro_indicators(self, country: Optional[str] = None) -> Dict[str, Any]:
        """Fetch key macro indicators, optionally filtered to one region.

        ``country`` accepts a country/region code (e.g. ``US``, ``EU``, ``CN``);
        unknown or empty values return every region.
        """
        region_filter = _COUNTRY_TO_REGION.get((country or "").strip().upper())
        config = (
            {region_filter: MACRO_CONFIG[region_filter]}
            if region_filter in MACRO_CONFIG
            else MACRO_CONFIG
        )

        cache_key = cache.build_key("econ", "indicators", {"region": region_filter or "all"})
        cached = await cache.get(cache_key)
        if cached:
            return cached

        results: Dict[str, Any] = {}
        if self.fred_key:
            tasks = []
            for region, series_map in config.items():
                for label, series_id in series_map.items():
                    tasks.append(self._fetch_fred_indicator(region, label, series_id))

            indicator_data = await asyncio.gather(*tasks)

            for item in indicator_data:
                if item:
                    region = item["region"]
                    if region not in results:
                        results[region] = {}
                    results[region][item["label"]] = {
                        "value": item["value"],
                        "last_value": item["last_value"],
                        "date": item["date"],
                        "history": item["history"]
                    }
            if not results:
                # Key present but every series failed — don't fabricate, flag it.
                results[DEGRADED_KEY] = degraded_marker(REASON_PROVIDER_ERROR, source=SOURCE_FALLBACK)
        else:
            mock = self._get_mock_macro()
            results = {r: mock[r] for r in config if r in mock} or dict(mock)
            # Mock macro values must never read as live (the calendar already
            # flags itself; macro used to omit any signal). See shared/degraded.
            results[DEGRADED_KEY] = degraded_marker(
                REASON_MISSING_API_KEY,
                detail="set FRED_API_KEY for live macro indicators",
            )

        await cache.set(cache_key, results, ttl=14400) # 4 hours
        return results

    async def _fetch_fred_indicator(self, region: str, label: str, series_id: str) -> Optional[Dict[str, Any]]:
        try:
            url = f"{self.base_fred}/series/observations"
            params = {
                "series_id": series_id,
                "api_key": self.fred_key,
                "file_type": "json",
                "sort_order": "desc",
                "limit": 13 # 12 months + 1 for trend
            }
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, params=params)
                if resp.status_code != 200:
                    return None
                data = resp.json()

            observations = data.get("observations", [])
            if not observations: return None

            valid_obs = [o for o in observations if o["value"] != "."]
            if not valid_obs: return None

            current = valid_obs[0]
            last = valid_obs[1] if len(valid_obs) > 1 else current

            history = [{"date": o["date"], "value": float(o["value"])} for o in reversed(valid_obs)]

            return {
                "region": region,
                "label": label,
                "value": float(current["value"]),
                "last_value": float(last["value"]),
                "date": current["date"],
                "history": history
            }
        except Exception as e:
            logger.error(f"FRED error for {series_id}: {e}")
            return None

    def _map_impact(self, impact: Any) -> str:
        if isinstance(impact, int):
            if impact >= 3: return "high"
            if impact == 2: return "medium"
            return "low"
        s = str(impact).lower()
        if "high" in s or "3" in s: return "high"
        if "med" in s or "2" in s: return "medium"
        return "low"

    def _get_mock_calendar(self, start: str, end: str) -> List[Dict[str, Any]]:
        # Placeholder sample events shown only when no live source is available
        # (no Finnhub/FMP key, or the provider is rate-limited). Each is flagged
        # `sample: True` so the UI can label it and never pass it off as live.
        d_start = datetime.strptime(start, "%Y-%m-%d")
        events = [
            {
                "date": (d_start + timedelta(days=1)).strftime("%Y-%m-%d"),
                "time": "14:00:00",
                "country": "US",
                "event_name": "Non-Farm Payrolls",
                "impact": "high",
                "actual": 210000,
                "forecast": 185000,
                "previous": 150000,
                "unit": "Jobs",
                "currency": "USD"
            },
            {
                "date": (d_start + timedelta(days=2)).strftime("%Y-%m-%d"),
                "time": "12:45:00",
                "country": "EU",
                "event_name": "ECB Interest Rate Decision",
                "impact": "high",
                "actual": None,
                "forecast": 2.5,
                "previous": 2.5,
                "unit": "%",
                "currency": "EUR"
            },
            {
                "date": (d_start + timedelta(days=3)).strftime("%Y-%m-%d"),
                "time": "13:30:00",
                "country": "US",
                "event_name": "CPI (YoY)",
                "impact": "high",
                "actual": None,
                "forecast": 3.1,
                "previous": 3.4,
                "unit": "%",
                "currency": "USD"
            }
        ]
        for ev in events:
            ev["sample"] = True
        return events

    def _get_mock_macro(self) -> Dict[str, Any]:
        return {
            "us": {
                "gdp": {"value": 2.1, "last_value": 2.0, "date": "2024-Q3", "history": []},
                "cpi": {"value": 3.4, "last_value": 3.7, "date": "2024-12", "history": []}
            },
            "eu": {
                "gdp": {"value": 0.9, "last_value": 0.6, "date": "2024-Q3", "history": []},
                "cpi": {"value": 2.4, "last_value": 2.9, "date": "2024-12", "history": []}
            }
        }

_econ_service: Optional[EconomicDataService] = None

def get_economic_data_service() -> EconomicDataService:
    global _econ_service
    if _econ_service is None:
        _econ_service = EconomicDataService()
    return _econ_service
