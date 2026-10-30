"""Cancellable lifecycle transport for explicit, profile-resolved model tasks."""
import asyncio
import json
from contextlib import aclosing
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi.responses import StreamingResponse
from backend.services.insight_lifecycle import stream_insight_lifecycle
from backend.services.llm_profiles import ResolvedLLMProfile


def model_operation_response(
    operation: Callable[[], Awaitable[Any]],
    profile: ResolvedLLMProfile,
    *,
    preparation_seconds: float = 60,
) -> StreamingResponse:
    async def bounded():
        async with asyncio.timeout(profile.timeout_seconds + preparation_seconds):
            return await operation()

    async def events():
        async with aclosing(stream_insight_lifecycle(bounded)) as lifecycle:
            async for event in lifecycle:
                if event["type"] == "start":
                    event = {**event, "model_profile": profile.public_identity(),
                             "deadlines": {"operation_seconds": profile.timeout_seconds + preparation_seconds}}
                yield json.dumps(event, separators=(",", ":")) + "\n"
    return StreamingResponse(events(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
