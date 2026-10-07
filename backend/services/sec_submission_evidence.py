"""Conservative checks against the bounded recent SEC submissions index."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any


def recent_submission_index(payload: dict[str, Any], cik: int) -> dict[str, dict[str, Any] | None]:
    """Map accession to metadata; None marks contradictory rows in this index."""
    if payload.get("cik") != cik:
        raise ValueError("SEC submissions CIK mismatch")
    filings = payload.get("filings")
    recent = filings.get("recent") if isinstance(filings, dict) else None
    if not isinstance(recent, dict):
        raise ValueError("SEC recent submissions missing")
    columns = [recent.get(name) for name in ("accessionNumber", "form", "filingDate")]
    if any(not isinstance(column, list) for column in columns) or len({len(column) for column in columns}) != 1:
        raise ValueError("SEC recent submissions columns invalid")
    accepted = recent.get("acceptanceDateTime")
    if accepted is not None and (not isinstance(accepted, list) or len(accepted) != len(columns[0])):
        raise ValueError("SEC recent acceptance column invalid")

    index: dict[str, dict[str, Any] | None] = {}
    for offset, accession in enumerate(columns[0]):
        form = columns[1][offset]
        filed_raw = columns[2][offset]
        if not isinstance(accession, str) or not isinstance(form, str) or not isinstance(filed_raw, str):
            continue
        try:
            filed_date = date.fromisoformat(filed_raw)
        except ValueError:
            continue
        accepted_at = None
        if accepted is not None and isinstance(accepted[offset], str):
            try:
                parsed = datetime.fromisoformat(accepted[offset])
                if parsed.tzinfo is not None and parsed.utcoffset() is not None:
                    accepted_at = parsed
            except ValueError:
                pass
        row = {"form": form, "filed_date": filed_date, "accepted_at": accepted_at}
        if accession not in index:
            index[accession] = row
        elif index[accession] != row:
            index[accession] = None
    return index


def crosscheck_recent_submission(
    index: dict[str, dict[str, Any] | None], accession: str, form: str, filed_date: date,
) -> dict[str, Any]:
    if accession not in index:
        return {"status": "not_in_recent_index", "submission_form": None,
                "submission_filed_date": None, "accepted_at": None}
    row = index[accession]
    if row is None:
        return {"status": "ambiguous_in_recent_index", "submission_form": None,
                "submission_filed_date": None, "accepted_at": None}
    return {"status": "matched" if row["form"] == form and row["filed_date"] == filed_date else "metadata_mismatch",
            "submission_form": row["form"], "submission_filed_date": row["filed_date"],
            "accepted_at": row["accepted_at"]}
