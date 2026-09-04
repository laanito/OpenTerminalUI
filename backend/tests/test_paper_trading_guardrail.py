from __future__ import annotations

import warnings

from backend.main import app


def _openapi_paths() -> set[str]:
    # Other retained duplicate-router decisions are handled separately in v1.4;
    # they should not add unrelated warning noise to this removal guard.
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="Duplicate Operation ID.*")
        return set(app.openapi()["paths"])


def test_legacy_global_portfolio_and_watchlist_routes_are_removed() -> None:
    paths = _openapi_paths()
    assert "/api/watchlists/items" not in paths
    assert all("/portfolio/holdings" not in p for p in paths)
    assert all("/portfolio/tax-lots" not in p for p in paths)


def test_canonical_portfolio_and_watchlist_routes_remain() -> None:
    paths = _openapi_paths()
    assert "/api/portfolios" in paths
    assert "/api/watchlists" in paths
