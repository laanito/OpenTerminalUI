from __future__ import annotations

import pytest

from backend import main
from backend.api import deps
from backend.bg_services import scanner_alert_scheduler
from backend.shared import ws_manager


@pytest.mark.asyncio
async def test_deep_health_reports_runtime_dependencies(monkeypatch) -> None:
    class _Hub:
        is_running = True

        async def metrics_snapshot(self):
            return {"ws_connected_clients": 1, "ws_subscriptions": 1}

        def kite_stream_status(self):
            return "uninitialized"

    async def _fetcher():
        return object()

    async def _cache_health():
        return {"status": "ok"}

    monkeypatch.setattr(deps, "get_unified_fetcher", _fetcher)
    monkeypatch.setattr(main.cache_instance, "health", _cache_health)
    monkeypatch.setattr(ws_manager, "get_marketdata_hub", lambda: _Hub())

    payload = await main.healthz()

    assert payload["status"] == "ok"
    assert payload["timestamp"].endswith("+00:00")
    assert payload["cache"] == {"status": "ok"}
    assert payload["marketdata_hub"] == {
        "status": "ok",
        "clients": 1,
        "subscriptions": 1,
    }
    assert payload["unified_fetcher"] == {"initialized": True}


@pytest.mark.asyncio
async def test_metrics_lite_uses_hub_snapshot(monkeypatch) -> None:
    class _Hub:
        async def metrics_snapshot(self):
            return {"ws_connected_clients": 2, "ws_subscriptions": 3}

        def kite_stream_status(self):
            return "disabled"

    class _Scanner:
        def status_snapshot(self):
            return {
                "last_run_at": "2026-09-10T18:00:00+00:00",
                "last_status": "ok",
                "last_scanned_symbols": 7,
            }

    monkeypatch.setattr(ws_manager, "get_marketdata_hub", lambda: _Hub())
    monkeypatch.setattr(
        scanner_alert_scheduler,
        "get_scanner_alert_scheduler_service",
        lambda: _Scanner(),
    )

    payload = await main.metrics_lite()

    assert payload["ws_clients"] == 2
    assert payload["ws_subscriptions"] == 3
    assert payload["scanner_alert_last_run"] == "2026-09-10T18:00:00+00:00"
    assert payload["scanner_alert_last_status"] == "ok"
    assert payload["scanner_alert_scanned_symbols"] == 7
    assert payload["last_kite_stream_status"] == "disabled"
