#!/usr/bin/env python3
"""Fail when the checked-in v1.4 API-family inventory drifts from OpenAPI."""

from __future__ import annotations

import json
import warnings
from collections import Counter
from pathlib import Path

from backend.main import app


ROOT = Path(__file__).resolve().parents[1]
INVENTORY_PATH = ROOT / "docs" / "surface-inventory.json"
HTTP_METHODS = {"get", "post", "put", "patch", "delete"}


def main() -> int:
    inventory = json.loads(INVENTORY_PATH.read_text(encoding="utf-8"))
    allowed = set(inventory["allowed_states"])
    classified: dict[str, str] = inventory["api_families"]
    invalid = {tag: state for tag, state in classified.items() if state not in allowed}

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        schema = app.openapi()
    duplicate_operations = sorted(
        str(warning.message)
        for warning in caught
        if "Duplicate Operation ID" in str(warning.message)
    )

    operations = []
    for path_item in schema["paths"].values():
        operations.extend(
            operation
            for method, operation in path_item.items()
            if method in HTTP_METHODS and isinstance(operation, dict)
        )
    actual = {
        tag
        for operation in operations
        for tag in (operation.get("tags") or ["untagged"])
    }
    missing = actual - set(classified)
    stale = set(classified) - actual
    duplicate_tags = sorted(
        str(operation.get("operationId") or "unknown")
        for operation in operations
        if len(operation.get("tags") or []) != len(set(operation.get("tags") or []))
    )

    if invalid or missing or stale or duplicate_operations or duplicate_tags:
        if invalid:
            print(f"invalid states: {invalid}")
        if missing:
            print(f"unclassified OpenAPI tags: {sorted(missing)}")
        if stale:
            print(f"inventory tags absent from OpenAPI: {sorted(stale)}")
        if duplicate_operations:
            print("duplicate OpenAPI operation IDs:")
            for warning in duplicate_operations:
                print(f"- {warning}")
        if duplicate_tags:
            print(f"operations with duplicate tags: {duplicate_tags}")
        return 1

    counts = Counter(classified.values())
    summary = ", ".join(f"{state}={counts[state]}" for state in inventory["allowed_states"])
    print(f"surface inventory covers {len(actual)} API families and {len(operations)} operations ({summary})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
