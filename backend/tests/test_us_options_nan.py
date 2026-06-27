"""Regression: yfinance returns NaN for missing option volume/openInterest.

`int(opt.get("volume", 0))` crashed with "cannot convert float NaN to integer"
(500 on GET /api/fno/chain/SPY/summary). _normalize_chain must coerce NaN/None
to 0 instead.
"""

from __future__ import annotations

import math

from backend.adapters.us_options_adapter import USOptionsAdapter


def test_to_int_coerces_nan_none_and_garbage():
    a = USOptionsAdapter()
    assert a._to_int(float("nan")) == 0
    assert a._to_int(None) == 0
    assert a._to_int("nope") == 0
    assert a._to_int(3.0) == 3
    assert a._to_int(1234.7) == 1234


def test_normalize_chain_survives_nan_volume_and_oi():
    a = USOptionsAdapter()
    # A chain row as yfinance hands it over: volume/openInterest are NaN, not 0.
    data = [
        {
            "strike": 100.0,
            "type": "C",
            "impliedVolatility": 0.25,
            "lastPrice": 5.0,
            "bid": 4.9,
            "ask": 5.1,
            "change": 0.1,
            "volume": float("nan"),
            "openInterest": float("nan"),
        },
        {
            "strike": 100.0,
            "type": "P",
            "impliedVolatility": float("nan"),
            "lastPrice": 4.0,
            "bid": 3.9,
            "ask": 4.1,
            "change": -0.1,
            "volume": 12.0,
            "openInterest": 34.0,
        },
    ]

    result = a._normalize_chain("SPY", spot=100.0, expiry="2099-01-15", data=data, strike_range=5)

    assert result["symbol"] == "SPY"
    assert result["market"] == "US"
    leg = result["strikes"][0]
    # NaN volume/OI coerced to 0 (the crash site); real values pass through.
    assert leg["ce"]["volume"] == 0
    assert leg["ce"]["oi"] == 0
    assert leg["pe"]["volume"] == 12
    assert leg["pe"]["oi"] == 34
    # Totals are plain ints, never NaN.
    totals = result["totals"]
    for key in ("ce_oi_total", "pe_oi_total", "ce_volume_total", "pe_volume_total"):
        assert isinstance(totals[key], int)
        assert not math.isnan(totals[key])
