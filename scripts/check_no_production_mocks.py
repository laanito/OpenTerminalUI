#!/usr/bin/env python3
"""Fail the build if fabricated-data sources leak into production code.

The v1.0 "silent-mock" sweep was a one-time manual audit; this guard turns its
result into an enforced invariant. The north star is *don't get fooled* — when
there's no live source, production must return empty + a ``degraded`` marker
(``backend/shared/degraded.py``), never fabricated data presented as real.

What it forbids (in production code only — ``backend/`` minus ``tests/``):

- Any reference to the test-only ``MockDataAdapter`` / ``backend.adapters.mock``
  / ``backend.tests.mocks`` — fakes belong under ``backend/tests/`` and must not
  be importable from a serving path.
- A leftover ``_mock_chain``-style fabricator in a route/service.
- A ``mock`` adapter named in an ``adapters*.yaml`` chain (it would make the
  registry serve invented quotes).

Scope is deliberately narrow and high-signal: it does NOT blanket-ban ``random``
(legitimate for retry jitter, Monte-Carlo risk sims, portfolio optimization).
Broadening to flag net-new ``random``/``uniform`` in the data-serving layer
behind a ``# mock-ok: <reason>`` allowlist is a possible future extension.

Run: ``python scripts/check_no_production_mocks.py`` (exits non-zero on a hit).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PROD_ROOT = REPO_ROOT / "backend"

# Directories never scanned (tests legitimately use fakes; venv is third-party).
EXCLUDED_DIR_PARTS = {"tests", ".venv", "__pycache__", "node_modules"}

# High-signal forbidden patterns for production .py files. Each is (regex, why).
FORBIDDEN_PY: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bMockDataAdapter\b"), "MockDataAdapter is a test-only fake"),
    (re.compile(r"backend\.adapters\.mock\b"), "the mock adapter module was removed from production"),
    (re.compile(r"backend\.tests\b"), "production code must not import from the test tree"),
    (re.compile(r"\b_mock_chain\b"), "fabricated option-chain generator"),
]

# In adapter config, the literal token `mock` as an adapter name is forbidden.
FORBIDDEN_YAML = re.compile(r"\bmock\b", re.IGNORECASE)


def _is_excluded(path: Path) -> bool:
    return any(part in EXCLUDED_DIR_PARTS for part in path.parts)


def find_violations() -> list[str]:
    violations: list[str] = []

    for py in sorted(PROD_ROOT.rglob("*.py")):
        rel = py.relative_to(REPO_ROOT)
        if _is_excluded(rel):
            continue
        for lineno, line in enumerate(py.read_text(encoding="utf-8").splitlines(), 1):
            for pattern, why in FORBIDDEN_PY:
                if pattern.search(line):
                    violations.append(f"{rel}:{lineno}: {why} -> {line.strip()}")

    # Adapter config: any `adapters*.yaml` naming a `mock` chain.
    config_dir = REPO_ROOT / "config"
    for yml in sorted(config_dir.glob("adapters*.yaml")) if config_dir.exists() else []:
        for lineno, line in enumerate(yml.read_text(encoding="utf-8").splitlines(), 1):
            if FORBIDDEN_YAML.search(line):
                rel = yml.relative_to(REPO_ROOT)
                violations.append(f"{rel}:{lineno}: 'mock' adapter must not be in a chain -> {line.strip()}")

    return violations


def main() -> int:
    violations = find_violations()
    if not violations:
        print("check_no_production_mocks: OK — no fabricated-data sources in production code.")
        return 0
    print("check_no_production_mocks: FAILED — fabricated-data sources found in production code.\n")
    for v in violations:
        print(f"  {v}")
    print(
        "\nProduction code must return empty + a `degraded` marker when there's no live\n"
        "source (see backend/shared/degraded.py). Move fakes under backend/tests/.",
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
