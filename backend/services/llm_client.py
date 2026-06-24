"""Async client for any OpenAI-compatible chat-completions endpoint.

This talks the OpenAI ``POST {base_url}/chat/completions`` spec, so the same
client works against Ollama (``http://localhost:11434/v1``), LM Studio
(``:1234/v1``), OpenAI, OpenRouter, Groq, Together, vLLM, llama.cpp — anything
that implements the spec. Local servers ignore the API key; hosted providers
require one (sent as a ``Bearer`` token).

Structured output is not uniform across providers, so JSON requests degrade
gracefully: strict ``json_schema`` → ``json_object`` → plain text, falling back
on the next form whenever the endpoint rejects the previous one.
"""

from __future__ import annotations

import json
import re
from typing import Any

import httpx

from backend.config.settings import get_settings

_JSON_OBJ_RE = re.compile(r"\{.*\}", re.DOTALL)

# HTTP statuses a server returns when it doesn't support a given response_format.
_UNSUPPORTED_STATUSES = {400, 404, 422, 501}


class LLMError(RuntimeError):
    """Raised when the LLM endpoint is unreachable or returns bad data."""


class LLMClient:
    """Thin async wrapper around an OpenAI-compatible chat endpoint."""

    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float | None = None,
        api_key: str | None = None,
        structured_output: str | None = None,
    ) -> None:
        settings = get_settings()
        self.base_url = (base_url or settings.llm_base_url).rstrip("/")
        self.model = model or settings.llm_model
        self.timeout = float(timeout or settings.llm_timeout_seconds)
        self.api_key = api_key if api_key is not None else settings.llm_api_key
        # auto | json_schema | json | none — how to request JSON from this provider.
        self.structured_output = (structured_output or settings.llm_structured_output or "auto").lower()

    def _headers(self) -> dict[str, str]:
        # Local servers (Ollama/LM Studio) ignore this; hosted providers need it.
        return {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}

    def _response_format_ladder(self, json_schema: dict[str, Any] | None) -> list[dict[str, Any] | None]:
        """Ordered response_format variants to attempt, most→least structured."""
        if json_schema is None or self.structured_output == "none":
            return [None]
        schema_rf: dict[str, Any] = {
            "type": "json_schema",
            "json_schema": {"name": "response", "strict": True, "schema": json_schema},
        }
        json_rf: dict[str, Any] = {"type": "json_object"}
        if self.structured_output == "json_schema":
            return [schema_rf, None]
        if self.structured_output == "json":
            return [json_rf, None]
        # auto: try strict schema, then loose json mode, then plain text.
        return [schema_rf, json_rf, None]

    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float = 0.1,
        max_tokens: int = 512,
        json_schema: dict[str, Any] | None = None,
        frequency_penalty: float = 0.0,
    ) -> str:
        """Send a chat completion and return the assistant message text.

        When ``json_schema`` is supplied the request asks the provider to
        constrain output to JSON, stepping down through the response_format
        ladder if the endpoint rejects a given form.
        """
        url = f"{self.base_url}/chat/completions"
        ladder = self._response_format_ladder(json_schema)
        last_exc: Exception | None = None

        for response_format in ladder:
            payload: dict[str, Any] = {
                "model": self.model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "stream": False,
            }
            if frequency_penalty:
                payload["frequency_penalty"] = frequency_penalty
            if response_format is not None:
                payload["response_format"] = response_format

            try:
                async with httpx.AsyncClient(timeout=self.timeout, trust_env=False) as client:
                    resp = await client.post(url, json=payload, headers=self._headers())
                    resp.raise_for_status()
                    data = resp.json()
            except httpx.HTTPStatusError as exc:
                status = exc.response.status_code if exc.response is not None else None
                # Endpoint rejected this response_format — try the next, simpler form.
                if response_format is not None and status in _UNSUPPORTED_STATUSES:
                    last_exc = exc
                    continue
                raise LLMError(f"LLM HTTP {status if status is not None else '?'}") from exc
            except (httpx.HTTPError, ValueError) as exc:
                raise LLMError(f"LLM request failed: {exc}") from exc

            try:
                return str(data["choices"][0]["message"]["content"] or "")
            except (KeyError, IndexError, TypeError) as exc:
                raise LLMError("LLM returned an unexpected payload") from exc

        # Exhausted the ladder (every structured form was rejected).
        raise LLMError("LLM rejected all response formats") from last_exc

    async def health(self) -> bool:
        """Return True when the model endpoint is reachable."""
        try:
            async with httpx.AsyncClient(timeout=min(5.0, self.timeout), trust_env=False) as client:
                resp = await client.get(f"{self.base_url}/models", headers=self._headers())
                resp.raise_for_status()
            return True
        except httpx.HTTPError:
            return False


def parse_json_response(content: str) -> dict[str, Any]:
    """Parse a JSON object out of a model response, tolerating code fences."""
    text = (content or "").strip()
    if text.startswith("```"):
        text = text.strip("`").strip()
        if text[:4].lower() == "json":
            text = text[4:].strip()
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    match = _JSON_OBJ_RE.search(text)
    if match:
        try:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
    raise LLMError("Could not parse JSON from LLM response")


def get_llm_client() -> LLMClient:
    """Return an LLM client built from current settings."""
    return LLMClient()
