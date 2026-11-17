"""Bounded daily cleanup under the configured policy; zero disables expiry."""
from __future__ import annotations

import asyncio
import logging

from backend.services.news_evidence_lifecycle import prune_batch

logger = logging.getLogger(__name__)


class EvidenceCleanup:
    def __init__(self, session_factory, retention_days, *, interval_seconds=86400):
        self.session_factory = session_factory
        self.retention_days = retention_days
        self.interval_seconds = interval_seconds
        self.task = None

    def start(self):
        if self.retention_days is not None and self.task is None:
            self.task = asyncio.create_task(self.run())

    async def run(self):
        while True:
            # No deletion at startup. Allow inspection before the first sweep.
            await asyncio.sleep(self.interval_seconds)
            operation = asyncio.create_task(asyncio.to_thread(
                prune_batch, self.session_factory, self.retention_days, limit=100,
            ))
            try:
                result = await asyncio.shield(operation)
                logger.info("News evidence cleanup: deleted=%s skipped=%s", result["deleted"], result["skipped"])
            except asyncio.CancelledError:
                # A synchronous DB transaction cannot be cancelled by cancelling
                # its awaiter. Finish this bounded batch before shutdown returns.
                try:
                    await operation
                except Exception as exc:
                    logger.warning("News evidence cleanup failed (%s)", type(exc).__name__)
                raise
            except Exception as exc:
                logger.warning("News evidence cleanup failed (%s)", type(exc).__name__)

    async def stop(self):
        if self.task is not None:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
            self.task = None
