"""Deterministic generation task routing; no provider calls or model escalation.

No-argument LLM clients and embeddings retain their legacy behavior. Workflows
must opt in explicitly and use the same resolution for identity and deadlines.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Literal

from pydantic import BaseModel, ConfigDict

from backend.config.settings import AppSettings

ProfileName = Literal["fast", "deep"]
GenerationTask = Literal[
    "news_sentiment", "stock_emotion", "query_intent", "filing_analysis",
    "brain_answer", "comparison_briefing", "stock_briefing", "interrogate",
    "market_outlook", "portfolio_risk", "backtest_explanation", "collection_briefing",
]
TASK_PROFILES = MappingProxyType({
    "news_sentiment": "fast", "stock_emotion": "fast", "query_intent": "fast",
    "filing_analysis": "deep", "brain_answer": "deep", "comparison_briefing": "deep",
    "stock_briefing": "deep", "interrogate": "deep", "market_outlook": "deep",
    "portfolio_risk": "deep", "backtest_explanation": "deep", "collection_briefing": "deep",
})


class LLMProfileIdentity(BaseModel):
    """Public identity of the selected model, never its connection settings."""
    model_config = ConfigDict(extra="forbid", frozen=True)
    requested_profile: ProfileName
    resolved_profile: ProfileName
    model: str


@dataclass(frozen=True)
class ResolvedLLMProfile:
    requested_profile: ProfileName
    name: ProfileName
    model: str
    base_url: str = field(repr=False)
    api_key: str | None = field(repr=False)
    timeout_seconds: float
    structured_output: str
    enabled: bool

    def __post_init__(self):
        if not math.isfinite(self.timeout_seconds) or self.timeout_seconds <= 0:
            raise ValueError("Resolved LLM timeout must be positive and finite")

    def public_identity(self) -> dict[str, str]:
        # No endpoint or credentials. Requested Deep may resolve to legacy Fast
        # only when Deep is unconfigured, never after a configured model fails.
        return {"requested_profile": self.requested_profile, "resolved_profile": self.name, "model": self.model}


def resolve_llm_profile(settings: AppSettings, task: GenerationTask) -> ResolvedLLMProfile:
    requested = TASK_PROFILES.get(task) if isinstance(task, str) else None
    if requested is None:
        raise ValueError("Unknown LLM generation task")
    if requested == "deep" and settings.llm_deep_model is not None:
        separate_endpoint = settings.llm_deep_base_url is not None
        # Explicit URL means independent credentials, even when its origin or
        # text equals Fast's URL. Only an omitted URL may inherit Fast's key.
        key = settings.llm_deep_api_key
        if key is None and not separate_endpoint:
            key = settings.llm_api_key
        return ResolvedLLMProfile(
            requested_profile=requested, name="deep", model=settings.llm_deep_model,
            base_url=settings.llm_deep_base_url or settings.llm_base_url.rstrip("/"), api_key=key,
            timeout_seconds=settings.llm_deep_timeout_seconds or settings.llm_timeout_seconds,
            structured_output=settings.llm_deep_structured_output or "auto", enabled=settings.llm_enabled,
        )
    return ResolvedLLMProfile(
        requested_profile=requested, name="fast", model=settings.llm_model,
        base_url=settings.llm_base_url.rstrip("/"), api_key=settings.llm_api_key,
        timeout_seconds=settings.llm_timeout_seconds,
        structured_output=settings.llm_structured_output, enabled=settings.llm_enabled,
    )
