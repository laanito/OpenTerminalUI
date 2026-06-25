from __future__ import annotations

from backend.services.crypto_fundamentals import _match_protocol, compute_fundamentals


def test_compute_fundamentals_full() -> None:
    cg_row = {
        "name": "Uniswap",
        "circulating_supply": 600_000_000,
        "total_supply": 1_000_000_000,
        "max_supply": 1_000_000_000,
        "market_cap": 6_000_000_000,
        "fully_diluted_valuation": 10_000_000_000,
        "ath": 44.0,
        "ath_change_percentage": -77.0,
    }
    dl_entry = {"slug": "uniswap", "symbol": "UNI", "tvl": 4_000_000_000, "category": "Dexes", "chains": ["Ethereum", "Arbitrum"]}
    dl_fees = {"total24h": 1_000_000, "total30d": 30_000_000}

    out = compute_fundamentals("UNI-USD", cg_row, dl_entry, dl_fees)

    assert out["symbol"] == "UNI-USD"
    assert out["name"] == "Uniswap"
    # 600M / 1B = 60% circulating.
    assert out["tokenomics"]["circulating_pct"] == 60.0
    # FDV/MCap = 10B / 6B.
    assert out["valuation"]["fdv_mcap_ratio"] == round(10_000_000_000 / 6_000_000_000, 4)
    # MCap/TVL = 6B / 4B.
    assert out["valuation"]["mcap_tvl_ratio"] == 1.5
    # Annualised fees from 30d window: 30M * 365/30 = 365M.
    assert out["onchain"]["fees_annualized"] == round(30_000_000 * 365 / 30, 2)
    assert out["onchain"]["tracked"] is True
    assert out["sources"] == ["CoinGecko", "DefiLlama"]


def test_compute_fundamentals_without_defillama() -> None:
    cg_row = {
        "name": "Bitcoin",
        "circulating_supply": 19_700_000,
        "total_supply": 19_700_000,
        "max_supply": 21_000_000,
        "market_cap": 1_300_000_000_000,
        "fully_diluted_valuation": 1_380_000_000_000,
        "ath": 73000.0,
        "ath_change_percentage": -10.0,
    }
    out = compute_fundamentals("BTC-USD", cg_row, None, None)

    # Tokenomics still computed (circ / max).
    assert out["tokenomics"]["circulating_pct"] == round(19_700_000 / 21_000_000 * 100, 2)
    # On-chain fields null, not fabricated; protocol untracked.
    assert out["onchain"]["tvl"] is None
    assert out["onchain"]["tracked"] is False
    assert out["valuation"]["mcap_tvl_ratio"] is None
    assert out["sources"] == ["CoinGecko"]


def test_match_protocol_picks_highest_tvl() -> None:
    protocols = [
        {"symbol": "UNI", "slug": "uniswap-v2", "tvl": 1_000_000},
        {"symbol": "UNI", "slug": "uniswap-v3", "tvl": 3_000_000},
        {"symbol": "AAVE", "slug": "aave-v3", "tvl": 9_000_000},
    ]
    match = _match_protocol(protocols, "UNI-USD")
    assert match is not None
    assert match["slug"] == "uniswap-v3"
    assert _match_protocol(protocols, "DOGE-USD") is None


def test_compute_fundamentals_handles_missing_supply() -> None:
    out = compute_fundamentals("FOO-USD", {"name": "Foo"}, None, None)
    assert out["tokenomics"]["circulating_pct"] is None
    assert out["valuation"]["fdv_mcap_ratio"] is None
