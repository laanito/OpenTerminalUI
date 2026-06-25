from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)


class DefiLlamaClient:
    """Thin async client for the keyless DefiLlama API.

    DefiLlama exposes on-chain fundamentals (TVL, fees, revenue) for free with no
    API key, which fits the fork's free-provider stance. All methods degrade
    gracefully: network errors and unexpected payloads return an empty result
    rather than raising, so a missing/unmapped protocol never breaks a response.
    """

    BASE_URL = "https://api.llama.fi"

    def __init__(self, timeout: float = 10.0) -> None:
        self.timeout = timeout
        self.client: Optional[httpx.AsyncClient] = None

    async def initialize(self) -> None:
        if self.client:
            return
        self.client = httpx.AsyncClient(
            timeout=self.timeout,
            headers={"accept": "application/json"},
            trust_env=False,
            follow_redirects=True,
        )

    async def close(self) -> None:
        if self.client:
            await self.client.aclose()
            self.client = None

    async def _get(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> Any:
        if not self.client:
            await self.initialize()
        try:
            resp = await self.client.get(f"{self.BASE_URL}{endpoint}", params=params or {})
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            logger.warning("DefiLlama request failed (HTTP %s): %s", e.response.status_code, endpoint)
            return None
        except Exception as e:  # noqa: BLE001
            logger.warning("DefiLlama request error for %s: %s", endpoint, e)
            return None
        try:
            return resp.json()
        except ValueError:
            logger.warning("DefiLlama non-JSON response for %s", endpoint)
            return None

    async def get_protocols(self) -> List[Dict[str, Any]]:
        """Return the full ``/protocols`` list (each row carries symbol/tvl/mcap/slug)."""
        data = await self._get("/protocols")
        return data if isinstance(data, list) else []

    async def get_fees_summary(self, slug: str) -> Dict[str, Any]:
        """Return the ``/summary/fees/{slug}`` totals (total24h/total7d/total30d), or {}."""
        cid = (slug or "").strip().lower()
        if not cid:
            return {}
        data = await self._get(f"/summary/fees/{cid}", {"dataType": "dailyFees"})
        return data if isinstance(data, dict) else {}
