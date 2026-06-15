from __future__ import annotations

import asyncio

from backend.services.finnhub_ws import FinnhubWebSocket


def test_reconnect_delay_uses_capped_exponential_backoff(monkeypatch) -> None:
    ws = FinnhubWebSocket(lambda *args: None)
    ws._running = True

    slept: list[float] = []

    async def fake_sleep(delay: float) -> None:
        slept.append(delay)

    async def fake_connect() -> None:
        return None

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(ws, "_connect", fake_connect)

    async def run() -> None:
        for _ in range(5):
            await ws._reconnect_later()

    asyncio.run(run())

    # 5 -> 10 -> 20 -> 40 -> capped at 60
    assert slept == [5, 10, 20, 40, 60]


def test_reconnect_stops_when_not_running(monkeypatch) -> None:
    ws = FinnhubWebSocket(lambda *args: None)
    ws._running = False

    connected = False

    async def fake_connect() -> None:
        nonlocal connected
        connected = True

    monkeypatch.setattr(ws, "_connect", fake_connect)
    asyncio.run(ws._reconnect_later())

    assert connected is False
