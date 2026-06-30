"""The mock-detection guard must stay green — no fabricated data in production.

Mirrors `scripts/check_no_production_mocks.py` so the invariant is enforced by the
test suite as well as the standalone CI step. See `docs/wiki/Roadmap.md` →
*Integrity invariants*.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

_GUARD = Path(__file__).resolve().parents[2] / "scripts" / "check_no_production_mocks.py"


def _load_guard():
    spec = importlib.util.spec_from_file_location("check_no_production_mocks", _GUARD)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_no_fabricated_data_sources_in_production():
    guard = _load_guard()
    violations = guard.find_violations()
    assert violations == [], "Fabricated-data sources leaked into production:\n" + "\n".join(violations)
