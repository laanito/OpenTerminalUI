"""Unit tests for the shared retry-with-jitter + circuit-breaker helper.

All time/sleep/jitter is injected so the tests are deterministic and never
actually sleep or touch the wall clock.
"""

from __future__ import annotations

import httpx
import pytest

from backend.shared.http_resilience import (
    CircuitBreaker,
    CircuitOpenError,
    retry_request,
)


def _resp(status: int, headers: dict | None = None) -> httpx.Response:
    return httpx.Response(status_code=status, headers=headers or {}, request=httpx.Request("GET", "http://x"))


class _Clock:
    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t


async def _noop_sleep(_seconds: float) -> None:  # pragma: no cover - trivial
    return None


# --- retry_request --------------------------------------------------------


@pytest.mark.asyncio
async def test_returns_first_success_without_retry():
    calls = 0

    async def send():
        nonlocal calls
        calls += 1
        return _resp(200)

    resp = await retry_request(send, sleep=_noop_sleep, rand=lambda: 0.0)
    assert resp.status_code == 200
    assert calls == 1


@pytest.mark.asyncio
async def test_retries_429_then_succeeds():
    statuses = [429, 429, 200]
    sleeps: list[float] = []

    async def send():
        return _resp(statuses.pop(0))

    async def sleep(s):
        sleeps.append(s)

    resp = await retry_request(send, max_attempts=3, sleep=sleep, rand=lambda: 1.0)
    assert resp.status_code == 200
    assert len(sleeps) == 2  # backed off before each retry


@pytest.mark.asyncio
async def test_returns_final_failure_after_exhaustion():
    async def send():
        return _resp(503)

    resp = await retry_request(send, max_attempts=3, sleep=_noop_sleep, rand=lambda: 0.0)
    # Last attempt's response is returned as-is for the caller to handle.
    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_does_not_retry_non_retryable_4xx():
    calls = 0

    async def send():
        nonlocal calls
        calls += 1
        return _resp(402)

    resp = await retry_request(send, sleep=_noop_sleep, rand=lambda: 0.0)
    assert resp.status_code == 402
    assert calls == 1  # 402 is not transient → no retry


@pytest.mark.asyncio
async def test_honors_integer_retry_after_header():
    statuses = [429, 200]
    sleeps: list[float] = []

    async def send():
        s = statuses.pop(0)
        return _resp(s, headers={"Retry-After": "5"} if s == 429 else None)

    async def sleep(s):
        sleeps.append(s)

    await retry_request(send, max_attempts=2, max_delay=10.0, sleep=sleep, rand=lambda: 0.0)
    assert sleeps == [5.0]  # used Retry-After, not jittered backoff


@pytest.mark.asyncio
async def test_retries_then_reraises_network_error():
    calls = 0

    async def send():
        nonlocal calls
        calls += 1
        raise httpx.ConnectError("boom")

    with pytest.raises(httpx.ConnectError):
        await retry_request(send, max_attempts=3, sleep=_noop_sleep, rand=lambda: 0.0)
    assert calls == 3


# --- CircuitBreaker -------------------------------------------------------


def test_breaker_opens_after_threshold_and_recovers_after_cooldown():
    clock = _Clock()
    cb = CircuitBreaker(name="t", failure_threshold=3, cooldown=30.0, time_fn=clock)

    assert cb.allow() is True
    cb.record_failure()
    cb.record_failure()
    assert cb.allow() is True  # still under threshold
    cb.record_failure()  # third failure → open
    assert cb.allow() is False

    clock.t = 29.0
    assert cb.allow() is False  # still cooling down
    clock.t = 30.0
    assert cb.allow() is True   # half-open trial allowed

    cb.record_success()         # trial succeeded → fully closed
    assert cb.allow() is True


@pytest.mark.asyncio
async def test_retry_request_raises_when_breaker_open():
    clock = _Clock()
    cb = CircuitBreaker(name="t", failure_threshold=1, cooldown=60.0, time_fn=clock)
    cb.record_failure()  # opens immediately

    async def send():  # pragma: no cover - must not be called
        raise AssertionError("send should not run while breaker is open")

    with pytest.raises(CircuitOpenError):
        await retry_request(send, breaker=cb, sleep=_noop_sleep, rand=lambda: 0.0)
