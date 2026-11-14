"""Regression for the observed BTC 1h response's extra off-grid quote sample."""
import asyncio
from copy import deepcopy

import pytest
from fastapi import HTTPException
from backend.api.routes import crypto
from backend.core.models import OhlcvPoint

START = 1794650400  # 2026-11-14 10:00 UTC


def bar(**changes):
    return OhlcvPoint(**{"t": START, "o": 67345.7578125, "h": 67372.4765625,
                        "l": 67131.6875, "c": 67137.53125, "v": 709126144, **changes})


def quote(**changes):
    return OhlcvPoint(**{"t": START + 2193, "o": 67112.4765625, "h": 67112.4765625,
                        "l": 67112.4765625, "c": 67112.4765625, "v": 0, **changes})


def test_quote_tail_updates_real_candle_without_inventing_open_or_erasing_range_volume():
    original = [bar(), quote()]
    before = [row.model_dump() for row in original]
    merged = crypto._coalesce_yahoo_quote_tail(original, "1h")
    assert len(merged) == 1
    assert merged[0].model_dump() == {**before[0], "l": before[1]["c"], "c": before[1]["c"]}
    assert [row.model_dump() for row in original] == before


@pytest.mark.parametrize("price", [67000, 67400])
def test_quote_can_extend_but_never_shrink_known_extremes(price):
    merged = crypto._coalesce_yahoo_quote_tail([bar(), quote(o=price, h=price, l=price, c=price)], "1h")
    assert merged[0].o == bar().o
    assert merged[0].h == max(bar().h, price)
    assert merged[0].l == min(bar().l, price)
    assert merged[0].v == bar().v


@pytest.mark.parametrize("tail,interval", [
    (quote(t=START + 3600), "1h"),  # Genuine aligned, still-flat period bar.
    (quote(h=67400), "1h"), (quote(v=5), "1h"), (quote(), "1wk"),
])
def test_only_recognizable_off_grid_zero_volume_quote_tails_are_coalesced(tail, interval):
    rows = [bar(), tail]
    assert crypto._coalesce_yahoo_quote_tail(rows, interval) == rows


def test_quote_for_a_missing_period_is_not_promoted_to_a_fake_period_open():
    assert crypto._coalesce_yahoo_quote_tail([bar(), quote(t=START + 3601)], "1h") == [bar()]
    assert crypto._coalesce_yahoo_quote_tail([quote()], "1h") == []


def _patch_yahoo(monkeypatch, points):
    payload = {"chart": {"result": [{"timestamp": [row.t for row in points], "indicators": {"quote": [{
        field: [getattr(row, short) for row in points]
        for field, short in (("open", "o"), ("high", "h"), ("low", "l"), ("close", "c"), ("volume", "v"))
    }]}}]}}
    class Yahoo:
        async def get_chart(self, *args, **kwargs): return deepcopy(payload)
    class Fetcher: yahoo = Yahoo()
    async def fetcher(): return Fetcher()
    async def forbidden(*args): pytest.fail("Recognized Yahoo quote tail must not fetch differently grained fallback")
    monkeypatch.setattr(crypto, "get_unified_fetcher", fetcher)
    monkeypatch.setattr(crypto, "load_candles", forbidden)


def test_hourly_route_emits_one_current_period_and_retains_existing_contract(monkeypatch):
    _patch_yahoo(monkeypatch, [bar(), quote()])
    result = asyncio.run(crypto.crypto_candles(symbol="BTC-USD", interval="1h", range="3mo"))
    assert result.interval == "1h" and result.ticker == "BTC-USD"
    assert len(result.data) == 1 and result.data[0].o == bar().o
    assert result.data[0].c == quote().c and result.data[0].t == START


def test_quote_only_response_cannot_invent_an_hourly_candle_or_silently_fetch_daily_fallback(monkeypatch):
    _patch_yahoo(monkeypatch, [quote()])
    with pytest.raises(HTTPException) as error:
        asyncio.run(crypto.crypto_candles(symbol="BTC-USD", interval="1h", range="3mo"))
    assert error.value.status_code == 404


@pytest.mark.parametrize("price", [0, -1])
def test_invalid_quote_samples_cannot_corrupt_real_candle_extremes(price):
    assert crypto._coalesce_yahoo_quote_tail([bar(), quote(o=price, h=price, l=price, c=price)], "1h") == [bar()]
