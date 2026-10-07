"""On-demand filed SEC facts; independent of FMP and saved terminal captures."""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.api.routes.market_context import _symbol
from backend.auth.deps import get_current_user
from backend.core.sec_edgar_client import SecEdgarClient, get_sec_edgar_client
from backend.models import User
from backend.services.sec_filing_evidence import (
    CANDIDATE_DISPLAY_LIMIT,
    DISCLOSURES_PER_CANDIDATE_LIMIT,
    DISPLAY_LIMIT,
    disclosure_difference_candidates,
    filed_facts,
)
from backend.services.sec_submission_evidence import crosscheck_recent_submission, recent_submission_index


router = APIRouter(prefix="/api/market-context", tags=["market-context"])
logger = logging.getLogger(__name__)


class SecFiledFactsRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=40, examples=["AAPL"])
    filed_start: date
    filed_end: date


class SecFiledFact(BaseModel):
    filed_date: date
    accession: str
    taxonomy: Literal["us-gaap"]
    concept: str
    unit: str
    form: str
    period_start: date
    period_end: date
    value: float


class SecDisclosureDifferenceCandidate(BaseModel):
    concept: str
    unit: str
    period_start: date
    period_end: date
    latest_filed_date: date
    disclosure_count: int
    distinct_accession_count: int
    distinct_value_count: int
    within_accession_conflict: bool
    disclosures: list[SecFiledFact]


class SecFiledFactsResponse(BaseModel):
    contract_version: Literal[1] = 1
    symbol: str
    filed_start: date
    filed_end: date
    retrieved_at: datetime
    status: Literal["available", "no_matching_facts", "not_covered", "ambiguous_ticker", "configuration_required", "provider_error"]
    evidence_scope: Literal["sec_current_companyfacts_accession_tagged"] = "sec_current_companyfacts_accession_tagged"
    cik: int | None = None
    matched_count: int = 0
    examined_count: int = 0
    display_limit: int = DISPLAY_LIMIT
    facts: list[SecFiledFact] = Field(default_factory=list)
    difference_basis: Literal["same_concept_unit_exact_period_values_not_verified_revisions"] = "same_concept_unit_exact_period_values_not_verified_revisions"
    candidate_group_count: int = 0
    candidate_display_limit: int = CANDIDATE_DISPLAY_LIMIT
    disclosures_per_candidate_limit: int = DISCLOSURES_PER_CANDIDATE_LIMIT
    difference_candidates: list[SecDisclosureDifferenceCandidate] = Field(default_factory=list)


class SecSubmissionClaim(BaseModel):
    accession: str = Field(pattern=r"^\d{10}-\d{2}-\d{6}$")
    form: Literal["10-K", "10-Q", "10-K/A", "10-Q/A"]
    filed_date: date


class SecSubmissionCrosscheckRequest(BaseModel):
    cik: int = Field(ge=1, le=9_999_999_999)
    claims: list[SecSubmissionClaim] = Field(min_length=1, max_length=100)


class SecSubmissionCrosscheckItem(SecSubmissionClaim):
    status: Literal["matched", "metadata_mismatch", "not_in_recent_index", "ambiguous_in_recent_index"]
    submission_form: str | None
    submission_filed_date: date | None
    accepted_at: datetime | None


class SecSubmissionCrosscheckResponse(BaseModel):
    contract_version: Literal[1] = 1
    cik: int
    retrieved_at: datetime
    status: Literal["available", "configuration_required", "provider_error"]
    index_scope: Literal["sec_current_recent_submissions_only"] = "sec_current_recent_submissions_only"
    checked_count: int = 0
    matched_count: int = 0
    results: list[SecSubmissionCrosscheckItem] = Field(default_factory=list)


@router.post("/sec-filed-facts", response_model=SecFiledFactsResponse)
async def sec_file_facts(
    payload: SecFiledFactsRequest,
    _user: User = Depends(get_current_user),
    client: SecEdgarClient = Depends(get_sec_edgar_client),
) -> dict[str, Any]:
    """Inspect current SEC Company Facts by accession, not an archived vintage."""
    symbol = _symbol(payload.symbol)
    if payload.filed_start > payload.filed_end or (payload.filed_end - payload.filed_start).days > 730:
        raise HTTPException(status_code=422, detail="Filed window must be ordered and at most 730 days")
    result: dict[str, Any] = {
        "symbol": symbol, "filed_start": payload.filed_start, "filed_end": payload.filed_end,
        "retrieved_at": datetime.now(timezone.utc), "status": "configuration_required",
    }
    if not client.configured:
        return result
    try:
        ciks = await client.ticker_ciks(symbol)
        if not ciks:
            result["status"] = "not_covered"
        elif len(ciks) > 1:
            result["status"] = "ambiguous_ticker"
        else:
            result["cik"] = ciks[0]
            raw = await client.company_facts(ciks[0])
            if raw.get("cik") != ciks[0]:
                raise ValueError("SEC CIK mismatch")
            facts, matched, examined = filed_facts(raw, payload.filed_start, payload.filed_end)
            candidates, candidate_count = disclosure_difference_candidates(raw, payload.filed_start, payload.filed_end)
            result.update(status="available" if matched else "no_matching_facts", facts=facts,
                          matched_count=matched, examined_count=examined,
                          difference_candidates=candidates, candidate_group_count=candidate_count)
    except Exception as exc:
        # HTTP exceptions can include upstream URLs. Never expose those to clients or logs.
        logger.warning("SEC filed-facts fetch failed for %s (%s)", symbol, type(exc).__name__)
        result.update(status="provider_error", cik=None, facts=[], matched_count=0, examined_count=0,
                      difference_candidates=[], candidate_group_count=0)
    return result


@router.post("/sec-submission-crosscheck", response_model=SecSubmissionCrosscheckResponse)
async def sec_submission_crosscheck(
    payload: SecSubmissionCrosscheckRequest,
    _user: User = Depends(get_current_user),
    client: SecEdgarClient = Depends(get_sec_edgar_client),
) -> dict[str, Any]:
    """Check supplied accession/date/form claims against the current recent index."""
    result: dict[str, Any] = {
        "cik": payload.cik, "retrieved_at": datetime.now(timezone.utc), "status": "configuration_required",
    }
    if not client.configured:
        return result
    try:
        index = recent_submission_index(await client.recent_submissions(payload.cik), payload.cik)
        seen: set[tuple[str, str, date]] = set()
        checks = []
        for claim in payload.claims:
            identity = (claim.accession, claim.form, claim.filed_date)
            if identity in seen:
                continue
            seen.add(identity)
            checks.append({**claim.model_dump(),
                           **crosscheck_recent_submission(index, claim.accession, claim.form, claim.filed_date)})
        result.update(status="available", checked_count=len(checks),
                      matched_count=sum(row["status"] == "matched" for row in checks), results=checks)
    except Exception as exc:
        # Never expose upstream URLs or transport diagnostics in a public response.
        logger.warning("SEC submissions cross-check failed for CIK %s (%s)", payload.cik, type(exc).__name__)
        result["status"] = "provider_error"
    return result
