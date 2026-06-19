from __future__ import annotations

import asyncio
import json
import logging
import os
from collections.abc import Awaitable, Callable
from typing import Any

logger = logging.getLogger(__name__)


def to_binance_stream(app_symbol: str) -> str | None:
    """App symbol (BTC-USD) -> Binance spot stream symbol (btcusdt), or None.

    The app quotes crypto against USD; Binance spot pairs are vs USDT.
    """
    s = (app_symbol or "").strip().upper()
    if not s.endswith("-USD"):
        return None
    base = s[:-4]
    if not base:
        return None
    return f"{base.lower()}usdt"


def app_symbol_from_binance(binance_symbol: str) -> str | None:
    """Binance pair (BTCUSDT) -> app symbol (BTC-USD), or None."""
    s = (binance_symbol or "").strip().upper()
    if not s.endswith("USDT"):
        return None
    base = s[:-4]
    if not base:
        return None
    return f"{base}-USD"


def parse_ticker_message(payload: Any) -> tuple[str, float, float, float, int] | None:
    """Parse a Binance ``24hrTicker`` event into (app_symbol, price, change_pct,
    volume, ts_ms), or None if it isn't a usable ticker frame."""
    if not isinstance(payload, dict) or payload.get("e") != "24hrTicker":
        return None
    app_symbol = app_symbol_from_binance(str(payload.get("s") or ""))
    if not app_symbol:
        return None
    try:
        price = float(payload.get("c"))
    except (TypeError, ValueError):
        return None
    try:
        change_pct = float(payload.get("P"))
    except (TypeError, ValueError):
        change_pct = 0.0
    try:
        volume = float(payload.get("v") or 0.0)
    except (TypeError, ValueError):
        volume = 0.0
    try:
        ts_ms = int(payload.get("E") or 0)
    except (TypeError, ValueError):
        ts_ms = 0
    return app_symbol, price, change_pct, volume, ts_ms


class BinanceSpotWebSocket:
    """Live crypto spot prices from Binance's public combined WS.

    Mirrors FinnhubWebSocket: maintains a desired set of app symbols (BTC-USD),
    SUBSCRIBE/UNSUBSCRIBEs the matching ``<pair>@ticker`` streams, and invokes a
    callback per tick. No API key required.
    """

    WS_URL = "wss://stream.binance.com:9443/ws"
    _RECONNECT_BASE_DELAY = 5
    _RECONNECT_MAX_DELAY = 60

    def __init__(self, on_ticker: Callable[[str, float, float, float, int], Awaitable[None] | None]) -> None:
        self.enabled = os.getenv("OPENTERMINALUI_BINANCE_WS_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
        self._on_ticker = on_ticker
        self._ws: Any = None
        self._listen_task: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        self._desired_streams: set[str] = set()  # e.g. {"btcusdt@ticker"}
        self._sent_streams: set[str] = set()
        self._running = False
        self._connected = False
        self._msg_id = 0
        self._reconnect_delay = self._RECONNECT_BASE_DELAY

    @property
    def connected(self) -> bool:
        return self._connected

    async def start(self) -> None:
        if not self.enabled:
            return
        async with self._lock:
            if self._running:
                return
            self._running = True
        await self._connect()

    async def stop(self) -> None:
        async with self._lock:
            self._running = False
            task = self._listen_task
            self._listen_task = None
            ws = self._ws
            self._ws = None
            self._connected = False
            self._sent_streams.clear()
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        if ws:
            try:
                await ws.close()
            except Exception:
                pass

    async def set_symbols(self, app_symbols: set[str]) -> None:
        streams = {f"{s}@ticker" for sym in app_symbols if (s := to_binance_stream(sym))}
        async with self._lock:
            self._desired_streams = streams
            ws = self._ws
            connected = self._connected
        if ws and connected:
            await self._flush_subscriptions()

    async def _connect(self) -> None:
        if not self.enabled:
            return
        try:
            import websockets  # type: ignore
        except Exception as exc:  # noqa: BLE001
            logger.warning("Binance WS disabled: websockets unavailable (%s)", exc)
            self.enabled = False
            return
        try:
            ws = await websockets.connect(self.WS_URL, ping_interval=20, ping_timeout=60)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Binance WS connect failed: %s", exc)
            async with self._lock:
                if self._running:
                    asyncio.create_task(self._reconnect_later())
            return
        async with self._lock:
            self._ws = ws
            self._connected = True
            self._sent_streams.clear()
            self._reconnect_delay = self._RECONNECT_BASE_DELAY
            self._listen_task = asyncio.create_task(self._listen_loop(), name="binance-ws-listen")
        await self._flush_subscriptions()
        logger.info("Binance spot WS connected")

    async def _reconnect_later(self) -> None:
        async with self._lock:
            if not self._running:
                return
            delay = self._reconnect_delay
            self._reconnect_delay = min(self._reconnect_delay * 2, self._RECONNECT_MAX_DELAY)
        await asyncio.sleep(delay)
        async with self._lock:
            if not self._running:
                return
        await self._connect()

    async def _flush_subscriptions(self) -> None:
        async with self._lock:
            ws = self._ws
            if not ws or not self._connected:
                return
            desired = set(self._desired_streams)
            sent = set(self._sent_streams)
        to_sub = sorted(desired - sent)
        to_unsub = sorted(sent - desired)
        applied = set(sent)
        try:
            if to_unsub:
                self._msg_id += 1
                await ws.send(json.dumps({"method": "UNSUBSCRIBE", "params": to_unsub, "id": self._msg_id}))
                applied -= set(to_unsub)
            if to_sub:
                self._msg_id += 1
                await ws.send(json.dumps({"method": "SUBSCRIBE", "params": to_sub, "id": self._msg_id}))
                applied |= set(to_sub)
        except Exception:  # noqa: BLE001
            pass
        async with self._lock:
            self._sent_streams = applied

    async def _listen_loop(self) -> None:
        ws = self._ws
        if not ws:
            return
        try:
            async for raw in ws:
                try:
                    payload = json.loads(raw)
                except Exception:
                    continue
                parsed = parse_ticker_message(payload)
                if parsed is None:
                    continue
                app_symbol, price, change_pct, volume, ts_ms = parsed
                result = self._on_ticker(app_symbol, price, change_pct, volume, ts_ms)
                if asyncio.iscoroutine(result):
                    await result
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            try:
                import websockets  # type: ignore

                expected = isinstance(exc, websockets.exceptions.ConnectionClosed)
            except Exception:
                expected = False
            if expected:
                logger.info("Binance WS connection closed (%s); reconnecting", exc)
            else:
                logger.warning("Binance WS listen loop failed: %s", exc)
        finally:
            async with self._lock:
                self._connected = False
                self._ws = None
                self._sent_streams.clear()
                running = self._running
            if running:
                await self._reconnect_later()
