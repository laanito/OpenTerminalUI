from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import pytest


# Force the test suite onto an isolated, throwaway SQLite database BEFORE any
# backend module imports settings/db. This keeps tests hermetic regardless of a
# local `.env` (which may point DATABASE_URL at the Docker-only `postgres` host).
# load_local_env() uses os.environ.setdefault, so setting it here wins.
if not os.environ.get("OPENTERMINALUI_TEST_DB_INITIALIZED"):
    _test_db = Path(tempfile.gettempdir()) / "openterminalui_pytest.db"
    os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_test_db}"
    os.environ["OPENTERMINALUI_TEST_DB_INITIALIZED"] = "1"

# Never auto-seed the instrument universe during tests: some tests enter the app
# lifespan via `with TestClient(app)`, and seeding would hit the network.
os.environ["OPENTERMINALUI_INSTRUMENT_AUTOSEED"] = "0"


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
    from backend.adapters.mock import MockDataAdapter

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
def ensure_mock_adapter_registered():
    from backend.adapters.mock import MockDataAdapter
    from backend.adapters.registry import get_adapter_registry

    registry = get_adapter_registry()
    if "mock" not in registry._factory:  # noqa: SLF001
        registry._factory["mock"] = lambda: MockDataAdapter(seed=42)  # type: ignore[assignment] # noqa: SLF001
