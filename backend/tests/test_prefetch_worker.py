from __future__ import annotations

from backend.services import prefetch_worker


def test_db_tickers_combines_held_and_watchlist_symbol_unions(monkeypatch) -> None:
    class _FakeSession:
        def close(self) -> None:
            return None

    session = _FakeSession()
    monkeypatch.setattr(prefetch_worker, "SessionLocal", lambda: session)
    monkeypatch.setattr(prefetch_worker, "all_held_symbols", lambda db: ["MSFT", "AAPL"])
    monkeypatch.setattr(prefetch_worker, "all_watchlist_symbols", lambda db: ["AAPL", "TSLA"])

    assert set(prefetch_worker.get_db_tickers()) == {"AAPL", "MSFT", "TSLA"}
