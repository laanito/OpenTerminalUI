from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import pytest


def _explicit_postgres_test_url() -> str | None:
    """Return a deliberately isolated PostgreSQL test URL, or reject it.

    Normal pytest runs must never inherit DATABASE_URL: on a deployment host it
    can point at the live Compose database. The PostgreSQL CI contract therefore
    needs a separate URL, an explicit opt-in, localhost, and unmistakably
    disposable database/user names.
    """
    raw = os.environ.get("OPENTERMINALUI_TEST_DATABASE_URL")
    if not raw:
        return None
    if os.environ.get("OPENTERMINALUI_ALLOW_POSTGRES_TESTS") != "1":
        raise RuntimeError(
            "OPENTERMINALUI_TEST_DATABASE_URL requires OPENTERMINALUI_ALLOW_POSTGRES_TESTS=1",
        )
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise RuntimeError("PostgreSQL contract tests may run only in GitHub Actions")

    parsed = urlparse(raw)
    database = parsed.path.lstrip("/").split("/", 1)[0]
    disposable_suffixes = ("_ci", "_test")
    if parsed.scheme != "postgresql+asyncpg":
        raise RuntimeError(
            "PostgreSQL test opt-in requires a postgresql+asyncpg URL",
        )
    if parsed.hostname not in {"127.0.0.1", "localhost"}:
        raise RuntimeError("PostgreSQL tests are restricted to a localhost service")
    if not database.endswith(disposable_suffixes):
        raise RuntimeError("PostgreSQL test database name must end in _ci or _test")
    if not (parsed.username or "").endswith(disposable_suffixes):
        raise RuntimeError("PostgreSQL test user name must end in _ci or _test")
    return raw


# Force normal tests onto an isolated, throwaway SQLite database BEFORE any
# backend module imports settings/db. This remains hermetic regardless of a
# local `.env` or ambient DATABASE_URL pointing at the live Compose database.
# Only the guarded, GitHub Actions CI contract above may select PostgreSQL.
# load_local_env() uses os.environ.setdefault, so setting it here wins. Do not
# honor an ambient "already initialized" marker: that could bypass isolation on
# a deployment host.
_postgres_test_url = _explicit_postgres_test_url()
if _postgres_test_url:
    os.environ["DATABASE_URL"] = _postgres_test_url
else:
    _test_db = Path(tempfile.gettempdir()) / "openterminalui_pytest.db"
    os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_test_db}"

# Never auto-seed the instrument universe during tests: some tests enter the app
# lifespan via `with TestClient(app)`, and seeding would hit the network.
os.environ["OPENTERMINALUI_INSTRUMENT_AUTOSEED"] = "0"
# Keep the live Yahoo search fallback offline in tests (route consults it when
# the seeded DB has few hits); tests that exercise it monkeypatch explicitly.
os.environ["OPENTERMINALUI_INSTRUMENT_LIVE_SEARCH"] = "0"


# Ensure `import backend...` works even when pytest is launched from `backend/`.
REPO_ROOT = Path(__file__).resolve().parents[2]
repo_root_str = str(REPO_ROOT)
if repo_root_str not in sys.path:
    sys.path.insert(0, repo_root_str)


@pytest.fixture
def fixtures_dir() -> Path:
    return Path(__file__).resolve().parent / "fixtures"


@pytest.fixture
def mock_adapter():
    from backend.tests.mocks.mock_adapter import MockDataAdapter

    return MockDataAdapter(seed=42)


@pytest.fixture
def mock_adapter_registry(monkeypatch, mock_adapter):
    from backend.adapters import registry as registry_module
    from backend.adapters.registry import AdapterRegistry

    class _MockOnlyRegistry(AdapterRegistry):
        def __init__(self) -> None:
            super().__init__()
            self._factory["mock"] = lambda: mock_adapter

    test_registry = _MockOnlyRegistry()
    monkeypatch.setattr(registry_module, "_registry", test_registry, raising=False)
    monkeypatch.setattr(registry_module, "get_adapter_registry", lambda: test_registry)
    return test_registry


@pytest.fixture(autouse=True)
def _isolate_cache(monkeypatch):
    """Keep the shared multi-tier cache hermetic per test.

    The FMP client now persists successful responses in the shared cache (incl.
    the SQLite L3 tier that survives restarts). In tests that would let one
    test's cached response satisfy another's request and write a db file, so
    here we disable the Redis (L2) and SQLite (L3) tiers and clear the in-memory
    L1 tier around each test. Tests that exercise caching deliberately still see
    L1 working within a single test.
    """
    from backend.shared.cache import cache

    async def _noop_get(_key):
        return None

    async def _noop_set(_key, _value, _ttl=300):
        return None

    cache._l1_cache.clear()  # noqa: SLF001
    monkeypatch.setattr(cache, "_get_l2", _noop_get)
    monkeypatch.setattr(cache, "_set_l2", _noop_set)
    monkeypatch.setattr(cache, "_get_l3", _noop_get)
    monkeypatch.setattr(cache, "_set_l3", _noop_set)
    yield
    cache._l1_cache.clear()  # noqa: SLF001


@pytest.fixture(autouse=True)
def _reset_http_resilience(monkeypatch):
    """Keep the shared HTTP-resilience layer hermetic per test.

    The keyed clients (FMP, Finnhub) share a module-level circuit breaker, so one
    test's simulated 429 burst could otherwise leave the circuit open for the
    next test. We reset both breakers around each test, and no-op the backoff
    sleep so retry paths run instantly (the dedicated unit tests inject their own
    sleep/clock and are unaffected).
    """
    import backend.shared.http_resilience as hr

    async def _instant(_seconds: float) -> None:
        return None

    monkeypatch.setattr(hr, "_default_sleep", _instant)

    try:
        from backend.core.fmp_client import _FMP_BREAKER

        _FMP_BREAKER.reset()
    except Exception:  # pragma: no cover - import guard
        pass
    try:
        from backend.core.finnhub_client import _FINNHUB_BREAKER

        _FINNHUB_BREAKER.reset()
    except Exception:  # pragma: no cover - import guard
        pass
    try:
        from backend.core.yahoo_client import _YAHOO_BREAKER

        _YAHOO_BREAKER.reset()
    except Exception:  # pragma: no cover - import guard
        pass
    yield


@pytest.fixture(autouse=True)
def ensure_mock_adapter_registered():
    from backend.tests.mocks.mock_adapter import MockDataAdapter
    from backend.adapters.registry import get_adapter_registry

    registry = get_adapter_registry()
    if "mock" not in registry._factory:  # noqa: SLF001
        registry._factory["mock"] = lambda: MockDataAdapter(seed=42)  # type: ignore[assignment] # noqa: SLF001
