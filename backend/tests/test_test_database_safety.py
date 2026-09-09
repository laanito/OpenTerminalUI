"""The test runner must never inherit or casually opt into a deployment DB."""

from __future__ import annotations

import os

import pytest

from conftest import _explicit_postgres_test_url
from backend.shared.db import engine


def test_normal_test_lane_is_forced_to_sqlite() -> None:
    if os.environ.get("OPENTERMINALUI_ALLOW_POSTGRES_TESTS") == "1":
        pytest.skip("explicit PostgreSQL contract lane")
    assert engine.dialect.name == "sqlite"


def test_ambient_database_url_does_not_opt_into_postgres(monkeypatch) -> None:
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://openterminalui:password@127.0.0.1/openterminalui",
    )
    monkeypatch.delenv("OPENTERMINALUI_TEST_DATABASE_URL", raising=False)
    monkeypatch.delenv("OPENTERMINALUI_ALLOW_POSTGRES_TESTS", raising=False)

    assert _explicit_postgres_test_url() is None


def test_postgres_test_url_requires_explicit_opt_in(monkeypatch) -> None:
    monkeypatch.setenv(
        "OPENTERMINALUI_TEST_DATABASE_URL",
        "postgresql://openterminalui_ci:password@127.0.0.1/openterminalui_ci",
    )
    monkeypatch.delenv("OPENTERMINALUI_ALLOW_POSTGRES_TESTS", raising=False)

    with pytest.raises(RuntimeError, match="requires OPENTERMINALUI_ALLOW_POSTGRES_TESTS=1"):
        _explicit_postgres_test_url()


def test_postgres_test_url_rejects_local_execution(monkeypatch) -> None:
    monkeypatch.setenv("OPENTERMINALUI_ALLOW_POSTGRES_TESTS", "1")
    monkeypatch.setenv(
        "OPENTERMINALUI_TEST_DATABASE_URL",
        "postgresql://openterminalui_ci:password@127.0.0.1/openterminalui_ci",
    )
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)

    with pytest.raises(RuntimeError, match="only in GitHub Actions"):
        _explicit_postgres_test_url()


@pytest.mark.parametrize(
    ("url", "message"),
    [
        (
            "postgresql+asyncpg://openterminalui_ci:password@db.example.com/openterminalui_ci",
            "restricted to a localhost service",
        ),
        (
            "postgresql+asyncpg://openterminalui_ci:password@127.0.0.1/openterminalui",
            "database name must end in _ci or _test",
        ),
        (
            "postgresql+asyncpg://openterminalui:password@127.0.0.1/openterminalui_ci",
            "user name must end in _ci or _test",
        ),
        (
            "postgresql://openterminalui_ci:password@127.0.0.1/openterminalui_ci",
            "requires a postgresql\\+asyncpg URL",
        ),
    ],
)
def test_postgres_test_url_rejects_unsafe_targets(monkeypatch, url: str, message: str) -> None:
    monkeypatch.setenv("OPENTERMINALUI_ALLOW_POSTGRES_TESTS", "1")
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.setenv("OPENTERMINALUI_TEST_DATABASE_URL", url)

    with pytest.raises(RuntimeError, match=message):
        _explicit_postgres_test_url()


def test_postgres_test_url_accepts_disposable_ci_target(monkeypatch) -> None:
    url = "postgresql+asyncpg://openterminalui_ci:password@127.0.0.1/openterminalui_ci"
    monkeypatch.setenv("OPENTERMINALUI_ALLOW_POSTGRES_TESTS", "1")
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    monkeypatch.setenv("OPENTERMINALUI_TEST_DATABASE_URL", url)

    assert _explicit_postgres_test_url() == url
