"""Profile resolution is explicit, compatible, secret-safe and network-free."""
import json
import os
from dataclasses import FrozenInstanceError

import httpx
import pytest
import yaml
from pydantic import ValidationError

from backend.config import settings as configuration
from backend.config.settings import AppSettings
from backend.services import llm_client
from backend.services.llm_profiles import TASK_PROFILES, resolve_llm_profile


def settings(**overrides):
    values = dict(llm_model="fast-model", llm_base_url="https://fast.example/v1/",
                  llm_api_key="fast-test-secret", llm_timeout_seconds=30,
                  llm_structured_output="json", llm_embed_model="embedding-model")
    return AppSettings(**{**values, **overrides})


@pytest.mark.parametrize("task,name", [
    ("news_sentiment", "fast"), ("stock_emotion", "fast"), ("query_intent", "fast"),
    ("filing_analysis", "deep"), ("brain_answer", "deep"), ("comparison_briefing", "deep"),
    ("stock_briefing", "deep"), ("interrogate", "deep"), ("market_outlook", "deep"),
    ("portfolio_risk", "deep"), ("backtest_explanation", "deep"), ("collection_briefing", "deep"),
])
def test_explicit_task_map_and_unconfigured_deep_preserve_single_model(task, name):
    profile = resolve_llm_profile(settings(), task)
    assert profile.requested_profile == name
    assert profile.name == "fast" and profile.model == "fast-model"
    assert profile.timeout_seconds == 30 and profile.structured_output == "json"
    assert profile.api_key == "fast-test-secret" and profile.base_url == "https://fast.example/v1"


def test_shared_host_deep_uses_own_model_with_documented_inheritance():
    profile = resolve_llm_profile(settings(llm_deep_model="deep-model"), "brain_answer")
    assert profile.name == "deep" and profile.model == "deep-model"
    assert profile.base_url == "https://fast.example/v1" and profile.api_key == "fast-test-secret"
    assert profile.timeout_seconds == 30 and profile.structured_output == "auto"


@pytest.mark.parametrize("endpoint", ["http://localhost:1234/v1", "https://other.example/v1", "https://fast.example/v1/", "https://fast.example/other"])
def test_any_explicit_deep_endpoint_has_independent_credentials(endpoint):
    profile = resolve_llm_profile(settings(llm_deep_model="deep-model", llm_deep_base_url=endpoint), "comparison_briefing")
    assert profile.api_key is None
    assert profile.base_url == endpoint.rstrip("/")
    explicit = resolve_llm_profile(settings(llm_deep_model="deep-model", llm_deep_base_url=endpoint, llm_deep_api_key="deep-test-secret"), "comparison_briefing")
    assert explicit.api_key == "deep-test-secret"


def test_deep_overrides_do_not_mutate_fast_or_embedding_settings():
    configured = settings(llm_deep_model="deep-model", llm_deep_timeout_seconds=600,
                          llm_deep_structured_output="none", llm_deep_api_key="deep-test-secret")
    deep = resolve_llm_profile(configured, "interrogate")
    fast = resolve_llm_profile(configured, "news_sentiment")
    assert deep.timeout_seconds == 600 and deep.structured_output == "none"
    assert deep.api_key == "deep-test-secret"
    assert fast.model == "fast-model" and fast.api_key == "fast-test-secret" and fast.timeout_seconds == 30
    assert configured.llm_embed_model == "embedding-model"
    assert deep.public_identity() == {"requested_profile": "deep", "resolved_profile": "deep", "model": "deep-model"}
    assert "secret" not in repr(deep) + json.dumps(deep.public_identity())
    with pytest.raises(FrozenInstanceError):
        deep.name = "fast"
    with pytest.raises(TypeError):
        TASK_PROFILES["interrogate"] = "fast"


@pytest.mark.parametrize("task", ["embedding", "invented", "DO_NOT_ECHO_TASK", None, ["brain_answer"]])
def test_unknown_tasks_fail_closed_without_echoing_input(task):
    with pytest.raises(ValueError, match="^Unknown LLM generation task$"):
        resolve_llm_profile(settings(), task)


@pytest.mark.parametrize("override", [
    {"llm_deep_base_url": "https://deep.example/v1"}, {"llm_deep_api_key": "DO_NOT_ECHO_SECRET"},
    {"llm_deep_timeout_seconds": 600}, {"llm_deep_structured_output": "json"},
])
def test_partial_configuration_requires_a_model_without_leaking_credentials(override):
    with pytest.raises(ValidationError) as failure:
        settings(**override)
    assert "LLM_DEEP_MODEL is required" in str(failure.value)
    assert "DO_NOT_ECHO_SECRET" not in str(failure.value) + repr(failure.value)


@pytest.mark.parametrize("timeout", [0, -1, float("nan"), float("inf"), "invalid"])
def test_deep_deadline_must_be_positive_and_finite(timeout):
    with pytest.raises(ValidationError):
        settings(llm_deep_model="deep-model", llm_deep_timeout_seconds=timeout)


@pytest.mark.parametrize("timeout", [0, -1, float("inf"), float("nan")])
def test_task_resolution_cannot_inherit_an_unbounded_legacy_deadline(timeout):
    with pytest.raises(ValueError, match="Resolved LLM timeout must be positive and finite"):
        resolve_llm_profile(settings(llm_timeout_seconds=timeout), "brain_answer")


@pytest.mark.parametrize("endpoint", [
    "file:///tmp/model", "ftp://deep.example", "/relative", "https://secret:DO_NOT_ECHO_SECRET@deep.example/v1",
    "https://deep.example/v1?key=DO_NOT_ECHO_SECRET", "https://deep.example/v1#secret", "https://deep.example/v1?",
    "https://deep.example/v1#", "http://[invalid", "http://deep.example:invalid/v1", "https://deep.example/v1\nother",
])
def test_invalid_or_credential_bearing_endpoint_is_rejected_safely(endpoint):
    with pytest.raises(ValidationError) as failure:
        settings(llm_deep_model="deep-model", llm_deep_base_url=endpoint)
    assert "DO_NOT_ECHO_SECRET" not in str(failure.value)


def test_blank_overrides_are_unconfigured_and_settings_do_not_dump_deep_key():
    blank = settings(llm_deep_model="  ", llm_deep_base_url="", llm_deep_api_key="\t",
                     llm_deep_timeout_seconds="", llm_deep_structured_output=" ")
    assert resolve_llm_profile(blank, "brain_answer").name == "fast"
    configured = settings(llm_deep_model=" deep-model ", llm_deep_api_key="DO_NOT_ECHO_SECRET")
    assert configured.llm_deep_model == "deep-model"
    assert "DO_NOT_ECHO_SECRET" not in repr(configured) + configured.model_dump_json()
    with pytest.raises(ValidationError):
        settings(llm_deep_model="deep-model", llm_deep_structured_output="unknown")


@pytest.mark.parametrize("key", ["DO_NOT_ECHO\nSECRET", "DO_NOT_ECHO\x00SECRET", "DO_NOT_ECHO SECRET", "DO_NOT_ECHOé"])
def test_invalid_bearer_values_are_rejected_without_reflection(key):
    with pytest.raises(ValidationError) as failure:
        settings(llm_deep_model="deep-model", llm_deep_api_key=key)
    assert "DO_NOT_ECHO" not in str(failure.value) + repr(failure.value)


@pytest.fixture
def config_env(monkeypatch, tmp_path):
    for key in list(os.environ):
        if key.startswith(("LLM_", "OPENTERMINALUI_LLM_", "LM_STUDIO_", "OPENTERMINALUI_LM_STUDIO_")) or key in {"OPENAI_API_KEY", "OPENTERMINALUI_OPENAI_API_KEY"}:
            monkeypatch.delenv(key)
    monkeypatch.setattr(configuration, "_workspace_root", lambda: tmp_path)
    configuration.get_settings.cache_clear()
    yield tmp_path
    configuration.get_settings.cache_clear()


def test_config_loader_env_alias_precedence_and_yaml(config_env, monkeypatch):
    config = config_env / "backend/config/settings.yaml"
    config.parent.mkdir(parents=True)
    config.write_text(yaml.safe_dump({"app": {"llm_deep_model": "yaml-model", "llm_deep_timeout_seconds": 100}}))
    assert configuration.get_settings().llm_deep_model == "yaml-model"
    configuration.get_settings.cache_clear()
    monkeypatch.setenv("LLM_DEEP_MODEL", "env-model")
    monkeypatch.setenv("OPENTERMINALUI_LLM_DEEP_MODEL", "prefixed-model")
    monkeypatch.setenv("LLM_DEEP_TIMEOUT_SECONDS", "600")
    monkeypatch.setenv("LLM_DEEP_BASE_URL", "http://localhost:1234/v1/")
    monkeypatch.setenv("LLM_DEEP_API_KEY", "test-secret")
    monkeypatch.setenv("LLM_DEEP_STRUCTURED_OUTPUT", "json_object_is_not_valid")
    with pytest.raises(ValidationError):
        configuration.get_settings()
    monkeypatch.setenv("LLM_DEEP_STRUCTURED_OUTPUT", "json")
    resolved = configuration.get_settings()
    assert resolved.llm_deep_model == "prefixed-model" and resolved.llm_deep_timeout_seconds == 600
    assert resolved.llm_deep_base_url == "http://localhost:1234/v1"
    assert resolved.llm_deep_api_key == "test-secret" and resolved.llm_deep_structured_output == "json"


def test_empty_compose_environment_does_not_enable_deep(config_env, monkeypatch):
    for suffix in ["MODEL", "BASE_URL", "API_KEY", "TIMEOUT_SECONDS", "STRUCTURED_OUTPUT"]:
        monkeypatch.setenv(f"LLM_DEEP_{suffix}", "")
    monkeypatch.setenv("LM_STUDIO_MODEL", "legacy-model")
    configured = configuration.get_settings()
    assert configured.llm_model == "legacy-model" and configured.llm_deep_model is None


@pytest.mark.parametrize("suffix,field,plain,value,expected", [
    ("MODEL", "llm_deep_model", "plain-deep", "prefixed-deep", "prefixed-deep"),
    ("BASE_URL", "llm_deep_base_url", "https://plain.example/v1", "http://localhost:9999/v1/", "http://localhost:9999/v1"),
    ("API_KEY", "llm_deep_api_key", "plain-test-secret", "prefixed-test-secret", "prefixed-test-secret"),
    ("TIMEOUT_SECONDS", "llm_deep_timeout_seconds", "30", "900", 900),
    ("STRUCTURED_OUTPUT", "llm_deep_structured_output", "json", "none", "none"),
])
def test_all_prefixed_deep_aliases_override_plain_variables(config_env, monkeypatch, suffix, field, plain, value, expected):
    monkeypatch.setenv("LLM_DEEP_MODEL", "plain-deep")
    monkeypatch.setenv(f"LLM_DEEP_{suffix}", plain)
    monkeypatch.setenv(f"OPENTERMINALUI_LLM_DEEP_{suffix}", value)
    assert getattr(configuration.get_settings(), field) == expected


def test_client_factory_is_explicit_and_preserves_global_disable(monkeypatch):
    configured = settings(llm_deep_model="deep-model", llm_deep_base_url="https://deep.example/v1", llm_enabled=False)
    monkeypatch.setattr(llm_client, "get_settings", lambda: configured)
    legacy = llm_client.get_llm_client()
    assert legacy.resolved_profile is None and legacy.model == "fast-model"
    assert legacy._headers() == {"Authorization": "Bearer fast-test-secret"}
    deep = llm_client.get_llm_client("brain_answer")
    assert deep.resolved_profile.enabled is False and deep.resolved_profile.name == "deep"
    assert deep.model == "deep-model" and deep._headers() == {}


@pytest.mark.asyncio
async def test_deep_requests_are_isolated_and_legacy_embeddings_stay_on_original_endpoint(monkeypatch):
    calls = []
    configured = settings(llm_deep_model="deep-model", llm_deep_base_url="https://deep.example/v1", llm_deep_timeout_seconds=600)
    monkeypatch.setattr(llm_client, "get_settings", lambda: configured)

    def handle(request):
        payload = json.loads(request.content) if request.content else None
        calls.append((str(request.url), request.headers.get("authorization"), payload))
        if request.url.path.endswith("/embeddings"):
            return httpx.Response(200, json={"data": [{"index": 0, "embedding": [1.0, 0.0]}]})
        return httpx.Response(503, json={"error": "unavailable"})

    original = httpx.AsyncClient
    monkeypatch.setattr(llm_client.httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs))
    deep = llm_client.get_llm_client("comparison_briefing")
    assert deep.timeout == 600
    assert await deep.health() is False
    with pytest.raises(llm_client.LLMError):
        await deep.chat([{"role": "user", "content": "test"}])
    assert all(url.startswith("https://deep.example/") and key is None for url, key, _ in calls)
    assert calls[-1][2]["model"] == "deep-model"
    assert await llm_client.get_llm_client().embed(["test"]) == [[1.0, 0.0]]
    assert calls[-1] == ("https://fast.example/v1/embeddings", "Bearer fast-test-secret", {"model": "embedding-model", "input": ["test"]})
