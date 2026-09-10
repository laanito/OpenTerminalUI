from __future__ import annotations

import asyncio

import pytest

from backend.services.insight_lifecycle import stream_insight_lifecycle


@pytest.mark.asyncio
async def test_lifecycle_emits_progress_heartbeats_and_result() -> None:
    async def operation():
        await asyncio.sleep(0.02)
        return {"engine": "llm", "summary": "done", "sections": []}

    events = [event async for event in stream_insight_lifecycle(operation, heartbeat_seconds=0.005)]

    assert events[0] == {"type": "start", "phase": "queued"}
    assert events[1]["phase"] == "generating"
    assert len([event for event in events if event["type"] == "progress"]) > 1
    assert events[-1]["type"] == "result"
    assert events[-1]["result"]["summary"] == "done"


@pytest.mark.asyncio
async def test_lifecycle_emits_provider_deltas_before_validated_result() -> None:
    async def fallback_operation():
        raise AssertionError("streaming operation should be selected")

    async def streaming_operation(emit):
        emit('{"summary":')
        await asyncio.sleep(0)
        emit('"done"}')
        return {"engine": "llm", "summary": "done", "sections": []}

    events = [
        event
        async for event in stream_insight_lifecycle(
            fallback_operation,
            streaming_operation=streaming_operation,
            heartbeat_seconds=1,
        )
    ]

    assert [event["type"] for event in events] == [
        "start",
        "progress",
        "delta",
        "delta",
        "result",
    ]
    assert [event["received_chars"] for event in events if event["type"] == "delta"] == [
        11,
        18,
    ]
    assert events[-1]["result"]["summary"] == "done"


@pytest.mark.asyncio
async def test_cancelling_consumer_cancels_provider_operation() -> None:
    cancelled = asyncio.Event()

    async def operation():
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    stream = stream_insight_lifecycle(operation, heartbeat_seconds=60)
    assert (await anext(stream))["type"] == "start"
    assert (await anext(stream))["type"] == "progress"
    waiting = asyncio.create_task(anext(stream))
    await asyncio.sleep(0)
    waiting.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiting

    await asyncio.wait_for(cancelled.wait(), timeout=1)


@pytest.mark.asyncio
async def test_closing_after_initial_progress_cancels_provider_operation() -> None:
    cancelled = asyncio.Event()

    async def operation():
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    stream = stream_insight_lifecycle(operation, heartbeat_seconds=60)
    assert (await anext(stream))["type"] == "start"
    assert (await anext(stream))["type"] == "progress"
    await stream.aclose()

    await asyncio.wait_for(cancelled.wait(), timeout=1)
