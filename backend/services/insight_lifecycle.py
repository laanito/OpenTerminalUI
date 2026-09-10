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
    streaming_operation: Callable[[Callable[[str], None]], Awaitable[dict[str, Any]]]
    | None = None,
    heartbeat_seconds: float = 10.0,
) -> AsyncIterator[dict[str, Any]]:
    """Run one insight operation and emit NDJSON-friendly lifecycle events.

    Closing or cancelling the iterator cancels the provider task, so a browser
    AbortController does not leave expensive inference running in the server.
    """

    yield {"type": "start", "phase": "queued"}
    token_queue: asyncio.Queue[str] = asyncio.Queue()
    task = asyncio.create_task(
        streaming_operation(token_queue.put_nowait)
        if streaming_operation is not None
        else operation(),
        name="llm-insight-operation",
    )
    started_at = monotonic()
    received_chars = 0
    next_token: asyncio.Task[str] | None = None

    try:
        # Let the provider coroutine enter its own cleanup scope before exposing
        # the cancellable generating state to the response consumer.
        await asyncio.sleep(0)
        yield {"type": "progress", "phase": "generating", "elapsed_seconds": 0.0}
        while not task.done():
            next_token = asyncio.create_task(token_queue.get())
            done, _ = await asyncio.wait(
                {task, next_token},
                timeout=heartbeat_seconds,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if next_token in done:
                token = next_token.result()
                received_chars += len(token)
                yield {
                    "type": "delta",
                    "text": token,
                    "received_chars": received_chars,
                }
            else:
                next_token.cancel()
                with suppress(asyncio.CancelledError):
                    await next_token
            next_token = None
            if not done:
                yield {
                    "type": "progress",
                    "phase": "generating",
                    "elapsed_seconds": round(monotonic() - started_at, 1),
                    "received_chars": received_chars,
                }
        while not token_queue.empty():
            token = token_queue.get_nowait()
            received_chars += len(token)
            yield {
                "type": "delta",
                "text": token,
                "received_chars": received_chars,
            }
        yield {"type": "result", "result": task.result()}
    except asyncio.CancelledError:
        if next_token is not None and not next_token.done():
            next_token.cancel()
            with suppress(asyncio.CancelledError):
                await next_token
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
