"""Shared progress and cancellation lifecycle for slow AI insight operations."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import suppress
from time import monotonic
from typing import Any


async def stream_insight_lifecycle(
    operation: Callable[[], Awaitable[dict[str, Any]]],
    *,
    heartbeat_seconds: float = 10.0,
) -> AsyncIterator[dict[str, Any]]:
    """Run one insight operation and emit NDJSON-friendly lifecycle events.

    Closing or cancelling the iterator cancels the provider task, so a browser
    AbortController does not leave expensive inference running in the server.
    """

    yield {"type": "start", "phase": "queued"}
    task = asyncio.create_task(operation(), name="llm-insight-operation")
    started_at = monotonic()
    yield {"type": "progress", "phase": "generating", "elapsed_seconds": 0.0}

    try:
        while not task.done():
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=heartbeat_seconds)
            except asyncio.TimeoutError:
                yield {
                    "type": "progress",
                    "phase": "generating",
                    "elapsed_seconds": round(monotonic() - started_at, 1),
                }
        yield {"type": "result", "result": task.result()}
    except asyncio.CancelledError:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        raise
    except Exception:
        yield {
            "type": "error",
            "error": {
                "code": "internal_error",
                "message": "The insight operation failed unexpectedly.",
                "retryable": True,
            },
        }
    finally:
        if not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
