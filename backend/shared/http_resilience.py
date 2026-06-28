"""Shared HTTP resilience: retry-with-jitter + a lightweight circuit breaker.

The fork leans on free-tier external APIs (FMP, Finnhub, …) that rate-limit
aggressively. On a *cold cache* a burst of near-identical requests can all 429
at once; with no backoff we simply hammer the upstream, which keeps the limit
tripped and degrades every feature that depends on it.

This module gives the keyed HTTP clients two shared primitives:

* :func:`retry_request` — await an httpx call, retrying transient failures
  (429 + 5xx + network errors) with exponential backoff + full jitter, honoring
  an integer ``Retry-After`` header when the server sends one.
* :class:`CircuitBreaker` — a per-client breaker that opens after N consecutive
  failures and short-circuits further calls for a cooldown, so a struggling
  upstream gets room to recover instead of a continuous barrage.

Both are dependency-injected for time/sleep/jitter so they are deterministic in
tests (no real clock, no real sleeping).
"""
from __future__ import annotations

import asyncio
import logging
import random
import time
from typing import Awaitable, Callable, Iterable, Optional

import httpx

logger = logging.getLogger(__name__)

# Transient statuses worth retrying. 4xx other than 429 are the caller's problem
# (bad key, plan restriction, not found) and must NOT be retried.
RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})


class CircuitOpenError(Exception):
    """Raised by :func:`retry_request` when the breaker is open (request skipped)."""


class CircuitBreaker:
    """Minimal consecutive-failure circuit breaker.

    Opens after ``failure_threshold`` consecutive failures and stays open for
    ``cooldown`` seconds, after which it half-opens (a single trial is allowed);
    a success closes it, another failure re-opens it. Intended to be created
    once per client and shared across its requests.
    """

    def __init__(
        self,
        *,
        name: str = "",
        failure_threshold: int = 5,
        cooldown: float = 30.0,
        time_fn: Callable[[], float] = time.monotonic,
    ) -> None:
        self.name = name
        self._threshold = max(1, failure_threshold)
        self._cooldown = max(0.0, cooldown)
        self._time = time_fn
        self._failures = 0
        self._opened_at: Optional[float] = None

    def allow(self) -> bool:
        """Return True if a request may proceed (closed or half-open)."""
        if self._opened_at is None:
            return True
        if self._time() - self._opened_at >= self._cooldown:
            return True  # half-open: let one trial through
        return False

    def record_success(self) -> None:
        if self._opened_at is not None:
            logger.info("Circuit %s closed after recovery", self.name or "?")
        self._failures = 0
        self._opened_at = None

    def record_failure(self) -> None:
        self._failures += 1
        if self._failures >= self._threshold:
            was_open = self._opened_at is not None
            self._opened_at = self._time()
            if not was_open:
                logger.warning(
                    "Circuit %s opened after %d consecutive failures (cooldown %.0fs)",
                    self.name or "?", self._failures, self._cooldown,
                )

    def reset(self) -> None:
        """Force the breaker fully closed (mainly for test isolation)."""
        self._failures = 0
        self._opened_at = None

    @property
    def is_open(self) -> bool:
        return not self.allow()


def _parse_retry_after(response: httpx.Response, cap: float) -> Optional[float]:
    """Return the server's Retry-After (seconds) clamped to ``cap``, if integer."""
    raw = response.headers.get("Retry-After")
    if not raw:
        return None
    try:
        secs = float(raw.strip())
    except (TypeError, ValueError):
        return None  # HTTP-date form not supported; fall back to backoff
    if secs < 0:
        return None
    return min(secs, cap)


def _backoff_delay(attempt: int, base_delay: float, max_delay: float, rand: Callable[[], float]) -> float:
    """Full-jitter exponential backoff: uniform(0, min(max, base * 2**(attempt-1)))."""
    cap = min(max_delay, base_delay * (2 ** max(0, attempt - 1)))
    return cap * rand()


async def _default_sleep(seconds: float) -> None:
    """Indirection over ``asyncio.sleep`` so tests can no-op backoff narrowly."""
    await asyncio.sleep(seconds)


async def retry_request(
    send: Callable[[], Awaitable[httpx.Response]],
    *,
    max_attempts: int = 3,
    base_delay: float = 0.5,
    max_delay: float = 8.0,
    retry_statuses: Iterable[int] = RETRYABLE_STATUS,
    breaker: Optional[CircuitBreaker] = None,
    sleep: Optional[Callable[[float], Awaitable[None]]] = None,
    rand: Optional[Callable[[], float]] = None,
) -> httpx.Response:
    """Send an httpx request with retry-on-transient-failure + optional breaker.

    ``send`` is a zero-arg coroutine factory that issues one request (e.g.
    ``lambda: client.get(url, params=p)``); it is re-invoked per attempt.

    Returns the final :class:`httpx.Response`. On the last attempt a retryable
    response (429/5xx) is returned *as-is* so the caller can inspect/raise — the
    point of the retries is to give the upstream a chance, not to hide failures.
    Raises :class:`CircuitOpenError` if the breaker is open, or re-raises the
    last :class:`httpx.RequestError` if every attempt errored at the transport
    level.
    """
    retryable = frozenset(retry_statuses)
    _sleep = sleep if sleep is not None else _default_sleep
    _rand = rand if rand is not None else random.random
    last_exc: Optional[Exception] = None

    for attempt in range(1, max_attempts + 1):
        if breaker is not None and not breaker.allow():
            raise CircuitOpenError(f"circuit '{breaker.name}' is open")

        try:
            response = await send()
        except httpx.RequestError as exc:
            last_exc = exc
            if breaker is not None:
                breaker.record_failure()
            if attempt >= max_attempts:
                raise
            await _sleep(_backoff_delay(attempt, base_delay, max_delay, _rand))
            continue

        if response.status_code in retryable:
            if breaker is not None:
                breaker.record_failure()
            if attempt >= max_attempts:
                return response  # caller handles the final failure
            delay = _parse_retry_after(response, max_delay)
            if delay is None:
                delay = _backoff_delay(attempt, base_delay, max_delay, _rand)
            await _sleep(delay)
            continue

        # Any non-retryable status (2xx, or 4xx like 401/402/403/404): the host
        # is responsive, so the breaker should treat this as a success.
        if breaker is not None:
            breaker.record_success()
        return response

    # Unreachable: the loop either returns or raises. Kept for type-checkers.
    if last_exc is not None:
        raise last_exc
    raise RuntimeError("retry_request exhausted without a response")
