"""Current-vintage euro-area macro context from official public feeds."""

from __future__ import annotations

import asyncio
import csv
import io
import logging
import math
from datetime import date, datetime, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

EUROSTAT_URL = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data"
ECB_URL = "https://data-api.ecb.europa.eu/service/data/FM/D.U2.EUR.4F.KR.DFR.LEV"
ECB_SERIES = "FM.D.U2.EUR.4F.KR.DFR.LEV"

SERIES = (
    ("prc_hicp_minr", "Euro-area HICP, annual change", "eurostat", "Monthly", "Percent", {
        "geo": "EA21", "coicop18": "TOTAL", "unit": "RCH_A",
    }),
    ("une_rt_m", "Euro-area unemployment", "eurostat", "Monthly", "Percent of labour force", {
        "geo": "EA21", "s_adj": "SA", "age": "TOTAL", "unit": "PC_ACT", "sex": "T",
    }),
    (ECB_SERIES, "ECB deposit facility rate", "ecb", "Daily", "Percent per annum", {}),
)


def _month_start(value: str) -> date:
    if len(value) != 7 or value[4] != "-":
        raise ValueError("Invalid monthly period")
    return date.fromisoformat(f"{value}-01")


def _finite(value: Any) -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise ValueError("Non-finite observation")
    return parsed


def _eurostat_observations(data: Any, filters: dict[str, str], start: date, end: date) -> list[dict[str, Any]]:
    if not isinstance(data, dict) or not isinstance(data.get("dimension"), dict):
        raise ValueError("Invalid Eurostat response")
    dimensions = data["dimension"]
    ids, sizes = data.get("id"), data.get("size")
    if not isinstance(ids, list) or not isinstance(sizes, list) or len(ids) != len(sizes):
        raise ValueError("Invalid Eurostat dimensions")
    if set(ids) != {"freq", *filters, "time"} or any(size != 1 for dim, size in zip(ids, sizes) if dim != "time"):
        raise ValueError("Unexpected Eurostat selection")
    for name, code in {"freq": "M", **filters}.items():
        if dimensions.get(name, {}).get("category", {}).get("index") != {code: 0}:
            raise ValueError("Unexpected Eurostat series identity")
    time_index = dimensions.get("time", {}).get("category", {}).get("index")
    values = data.get("value")
    if not isinstance(time_index, dict) or not isinstance(values, dict):
        raise ValueError("Invalid Eurostat observations")
    statuses = data.get("status") or {}
    if not isinstance(statuses, dict):
        raise ValueError("Invalid Eurostat observation flags")
    observations = []
    for period, index in time_index.items():
        month = _month_start(period)
        # A monthly observation belongs to its reference month, even if the
        # pair window starts after the first day of that month.
        if (month.year == start.year and month.month == start.month) or start <= month <= end:
            raw = values.get(str(index))
            if raw is not None:
                flag = statuses.get(str(index))
                if flag is not None and not isinstance(flag, str):
                    raise ValueError("Invalid Eurostat observation flag")
                observations.append({"reference_date": month, "value": _finite(raw),
                                     "flag": flag})
    return sorted(observations, key=lambda row: row["reference_date"])


def _ecb_observations(body: str, start: date, end: date) -> list[dict[str, Any]]:
    reader = csv.DictReader(io.StringIO(body))
    if not reader.fieldnames or not {"KEY", "TIME_PERIOD", "OBS_VALUE", "UNIT"} <= set(reader.fieldnames):
        raise ValueError("Invalid ECB CSV schema")
    values: dict[date, float] = {}
    for row in reader:
        if row["KEY"] != ECB_SERIES or row["UNIT"] != "PCPA":
            raise ValueError("Unexpected ECB series identity or unit")
        observed_on = date.fromisoformat(row["TIME_PERIOD"])
        if start <= observed_on <= end and row["OBS_VALUE"]:
            value = _finite(row["OBS_VALUE"])
            if observed_on in values and values[observed_on] != value:
                raise ValueError("Conflicting ECB observations")
            values[observed_on] = value
    return [{"reference_date": day, "value": value, "flag": None} for day, value in sorted(values.items())]


async def get_euro_area_macro_observations(start: date, end: date) -> dict[str, Any]:
    """Return reference-period data, never sample or point-in-time claims."""
    retrieved_at = datetime.now(timezone.utc)

    async def fetch(client: httpx.AsyncClient, spec: tuple) -> dict[str, Any]:
        series_id, label, source, frequency, units, filters = spec
        if source == "eurostat":
            response = await client.get(f"{EUROSTAT_URL}/{series_id}", params={
                **filters, "sinceTimePeriod": start.strftime("%Y-%m"),
                "untilTimePeriod": end.strftime("%Y-%m"),
            })
            response.raise_for_status()
            observations = _eurostat_observations(response.json(), filters, start, end)
        else:
            response = await client.get(ECB_URL, params={
                "startPeriod": start.isoformat(), "endPeriod": end.isoformat(), "format": "csvdata",
            })
            response.raise_for_status()
            observations = _ecb_observations(response.text, start, end)
        return {"series_id": series_id, "label": label, "source": source, "units": units,
                "frequency": frequency, "status": "available" if observations else "no_observations",
                "observations": observations}

    async with httpx.AsyncClient(timeout=10.0) as client:
        results = await asyncio.gather(*(fetch(client, spec) for spec in SERIES), return_exceptions=True)
    groups = []
    for spec, result in zip(SERIES, results):
        if isinstance(result, BaseException):
            if not isinstance(result, Exception):
                raise result
            logger.warning("Euro-area macro context failed for %s (%s)", spec[0], type(result).__name__)
            groups.append({"series_id": spec[0], "label": spec[1], "source": spec[2],
                           "units": spec[4], "frequency": spec[3], "status": "feed_error", "observations": []})
        else:
            groups.append(result)
    available = any(group["status"] != "feed_error" for group in groups)
    return {"retrieved_at": retrieved_at, "region": "EA21", "status": "available" if available else "unavailable",
            "reason": None if available else "provider_error", "series": groups}
