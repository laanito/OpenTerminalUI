"""Conservative, accession-preserving selection from SEC Company Facts."""

from __future__ import annotations

import math
import re
from datetime import date
from typing import Any


CONCEPT_UNITS = {
    "Revenues": "USD",
    "RevenueFromContractWithCustomerExcludingAssessedTax": "USD",
    "NetIncomeLoss": "USD",
    "EarningsPerShareDiluted": "USD/shares",
}
_ACCESSION = re.compile(r"^\d{10}-\d{2}-\d{6}$")
_FORMS = {"10-K", "10-Q", "10-K/A", "10-Q/A"}
DISPLAY_LIMIT = 50
CANDIDATE_DISPLAY_LIMIT = 20
DISCLOSURES_PER_CANDIDATE_LIMIT = 8


def _eligible_facts(payload: dict[str, Any], start: date, end: date) -> tuple[list[tuple[Any, ...]], int]:
    facts = payload.get("facts")
    gaap = facts.get("us-gaap") if isinstance(facts, dict) else None
    if not isinstance(gaap, dict):
        return [], 0

    examined = 0
    selected: set[tuple[Any, ...]] = set()
    for concept, unit in CONCEPT_UNITS.items():
        node = gaap.get(concept)
        units = node.get("units") if isinstance(node, dict) else None
        entries = units.get(unit) if isinstance(units, dict) else None
        if not isinstance(entries, list):
            continue
        for row in entries:
            examined += 1
            if not isinstance(row, dict) or row.get("form") not in _FORMS:
                continue
            accession = row.get("accn")
            value = row.get("val")
            if not isinstance(accession, str) or not _ACCESSION.fullmatch(accession):
                continue
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                continue
            try:
                filed = date.fromisoformat(row["filed"])
                period_start = date.fromisoformat(row["start"])
                period_end = date.fromisoformat(row["end"])
            except (KeyError, TypeError, ValueError):
                continue
            if not (start <= filed <= end and period_start <= period_end <= filed):
                continue
            selected.add((filed, accession, concept, unit, row["form"], period_start, period_end, value))

    ordered = sorted(selected, key=lambda item: (item[0], item[1], item[2], item[5], item[6], item[7]), reverse=True)
    return ordered, examined


def _record(item: tuple[Any, ...]) -> dict[str, Any]:
    filed, accession, concept, unit, form, period_start, period_end, value = item
    return {"filed_date": filed, "accession": accession, "taxonomy": "us-gaap",
            "concept": concept, "unit": unit, "form": form, "period_start": period_start,
            "period_end": period_end, "value": value}


def filed_facts(payload: dict[str, Any], start: date, end: date) -> tuple[list[dict[str, Any]], int, int]:
    """Return bounded facts, matched count, and examined count; never infer revisions."""
    ordered, examined = _eligible_facts(payload, start, end)
    records = [_record(item) for item in ordered[:DISPLAY_LIMIT]]
    return records, len(ordered), examined


def disclosure_difference_candidates(payload: dict[str, Any], start: date, end: date) -> tuple[list[dict[str, Any]], int]:
    """Group exact-period differing values; source may be incomplete or revised later."""
    ordered, _ = _eligible_facts(payload, start, end)
    grouped: dict[tuple[Any, ...], list[tuple[Any, ...]]] = {}
    for item in ordered:
        identity = (item[2], item[3], item[5], item[6])  # concept, unit, exact duration
        grouped.setdefault(identity, []).append(item)

    candidates = []
    for (concept, unit, period_start, period_end), disclosures in grouped.items():
        if len({item[7] for item in disclosures}) < 2:
            continue
        by_accession: dict[str, set[int | float]] = {}
        for item in disclosures:
            by_accession.setdefault(item[1], set()).add(item[7])
        latest = disclosures[:DISCLOSURES_PER_CANDIDATE_LIMIT]
        candidates.append({
            "concept": concept, "unit": unit, "period_start": period_start,
            "period_end": period_end, "latest_filed_date": disclosures[0][0],
            "disclosure_count": len(disclosures), "distinct_accession_count": len(by_accession),
            "distinct_value_count": len({item[7] for item in disclosures}),
            "within_accession_conflict": any(len(values) > 1 for values in by_accession.values()),
            "disclosures": [_record(item) for item in reversed(latest)],
        })
    candidates.sort(key=lambda candidate: (candidate["latest_filed_date"], candidate["concept"],
                                           candidate["period_start"], candidate["period_end"]), reverse=True)
    return candidates[:CANDIDATE_DISPLAY_LIMIT], len(candidates)
