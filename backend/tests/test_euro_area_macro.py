from __future__ import annotations

from datetime import date

import pytest

from backend.services import euro_area_macro


def _eurostat(filters: dict[str, str]) -> dict:
    ids = ["freq", *filters, "time"]
    return {
        "id": ids, "size": [1] * (len(ids) - 1) + [2],
        "dimension": {**{"freq": {"category": {"index": {"M": 0}}}},
                      **{key: {"category": {"index": {value: 0}}} for key, value in filters.items()},
                      "time": {"category": {"index": {"2026-08": 0, "2026-09": 1}}}},
        "value": {"0": 2.1, "1": 2.2}, "status": {"1": "e"},
    }


def test_eurostat_monthly_reference_and_identity() -> None:
    filters = euro_area_macro.SERIES[0][5]
    rows = euro_area_macro._eurostat_observations(
        _eurostat(filters), filters, date(2026, 8, 20), date(2026, 9, 10),
    )
    assert rows == [
        {"reference_date": date(2026, 8, 1), "value": 2.1, "flag": None},
        {"reference_date": date(2026, 9, 1), "value": 2.2, "flag": "e"},
    ]
    wrong = _eurostat(filters)
    wrong["dimension"]["geo"]["category"]["index"] = {"EA20": 0}
    with pytest.raises(ValueError, match="identity"):
        euro_area_macro._eurostat_observations(wrong, filters, date(2026, 8, 20), date(2026, 9, 10))


def test_ecb_rejects_wrong_series_and_conflicting_dates() -> None:
    header = "KEY,TIME_PERIOD,OBS_VALUE,UNIT\n"
    row = f"{euro_area_macro.ECB_SERIES},2026-09-01,2.25,PCPA\n"
    assert euro_area_macro._ecb_observations(header + row, date(2026, 9, 1), date(2026, 9, 10)) == [
        {"reference_date": date(2026, 9, 1), "value": 2.25, "flag": None},
    ]
    with pytest.raises(ValueError, match="identity"):
        euro_area_macro._ecb_observations(header + row.replace("FM.D.", "FM.X."), date(2026, 9, 1), date(2026, 9, 10))
    with pytest.raises(ValueError, match="Conflicting"):
        euro_area_macro._ecb_observations(header + row + row.replace("2.25", "2.50"), date(2026, 9, 1), date(2026, 9, 10))


@pytest.mark.asyncio
async def test_euro_area_macro_reports_partial_feed_failure_without_samples(monkeypatch) -> None:
    class Response:
        def __init__(self, content):
            self.content = content

        def raise_for_status(self):
            return None

        def json(self):
            return self.content

        @property
        def text(self):
            return self.content

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url, params):
            if url.endswith("une_rt_m"):
                raise RuntimeError("provider down")
            if url.endswith("prc_hicp_minr"):
                assert params["geo"] == "EA21"
                return Response(_eurostat(euro_area_macro.SERIES[0][5]))
            assert params["format"] == "csvdata"
            return Response("KEY,TIME_PERIOD,OBS_VALUE,UNIT\n"
                            f"{euro_area_macro.ECB_SERIES},2026-09-01,2.25,PCPA\n")

    monkeypatch.setattr(euro_area_macro.httpx, "AsyncClient", lambda **kwargs: Client())
    result = await euro_area_macro.get_euro_area_macro_observations(date(2026, 8, 20), date(2026, 9, 10))
    assert result["region"] == "EA21"
    assert result["status"] == "available"
    assert [group["status"] for group in result["series"]] == ["available", "feed_error", "available"]
    assert result["series"][1]["observations"] == []
