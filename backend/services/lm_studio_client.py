"""Back-compat shim.

The LM Studio client was generalized into a provider-agnostic, OpenAI-compatible
client in :mod:`backend.services.llm_client` (works with Ollama, LM Studio,
OpenAI, and any compatible endpoint). These aliases keep older imports working;
prefer importing from ``backend.services.llm_client`` in new code.
"""

from __future__ import annotations

from backend.services.llm_client import (
    LLMClient,
    LLMError,
    get_llm_client,
    parse_json_response,
)

# Legacy names.
LMStudioClient = LLMClient
LMStudioError = LLMError
get_lm_studio_client = get_llm_client

__all__ = [
    "LMStudioClient",
    "LMStudioError",
    "get_lm_studio_client",
    "parse_json_response",
    "LLMClient",
    "LLMError",
    "get_llm_client",
]
