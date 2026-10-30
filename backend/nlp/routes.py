from __future__ import annotations

from typing import Any
import asyncio
import json
from contextlib import aclosing

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import get_db
from backend.nlp.filing_parser import get_conviction_record, ingest_symbol_filings
from backend.config.settings import get_settings
from backend.services.llm_profiles import resolve_llm_profile
from backend.services.insight_lifecycle import stream_insight_lifecycle

router = APIRouter(prefix="/stock-picking/conviction", tags=["stock-conviction"])


class FilingDocument(BaseModel):
    title: str = ""
    text: str = ""
    summary: str = ""
    published_at: str | None = None
    source: str = ""
    url: str = ""


class ConvictionIngestRequest(BaseModel):
    symbol: str
    market: str | None = None
    record_date: str | None = None
    use_llm: bool = True
    documents: list[FilingDocument] = Field(default_factory=list)


@router.get("/{symbol}")
def get_symbol_conviction(
    symbol: str,
    market: str | None = Query(default=None),
    record_date: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    row = get_conviction_record(db, symbol=symbol, market=market, record_date=record_date)
    if row is None:
        raise HTTPException(status_code=404, detail="No conviction record available for symbol")
    return row


@router.post("/ingest")
async def post_ingest_conviction(payload: ConvictionIngestRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Analyze and save a report using the resolved filing-analysis profile.

    Provider work shares its configured deadline; lexical fallback includes an
    explicit reason and saved model provenance. Legacy rows have unknown provenance.
    """
    profile = resolve_llm_profile(get_settings(), "filing_analysis")
    return await _ingest(payload, db, profile)


async def _ingest(payload, db, profile):
    return await ingest_symbol_filings(
        db,
        symbol=payload.symbol,
        market=payload.market,
        documents=[doc.model_dump() for doc in payload.documents],
        record_date=payload.record_date,
        use_llm=payload.use_llm,
        profile=profile,
    )


@router.post("/ingest/stream")
async def stream_ingest_conviction(payload: ConvictionIngestRequest, db: Session = Depends(get_db)) -> StreamingResponse:
    """One cancellable ingestion lifecycle; start announces identity/operation budget.

    The operation allowance is the selected model timeout plus 45 seconds for
    source collection/persistence. Provider failures return a labelled lexical
    report; interruption is not replayed. This remains an experimental saved,
    installation-wide report, not a private Brain source or a source-filing check.
    """
    profile = resolve_llm_profile(get_settings(), "filing_analysis")
    async def operation():
        async with asyncio.timeout(profile.timeout_seconds + 45):
            return await _ingest(payload, db, profile)
    async def events():
        async with aclosing(stream_insight_lifecycle(operation)) as lifecycle:
            async for event in lifecycle:
                if event["type"] == "start":
                    event = {**event, "model_profile": profile.public_identity(),
                             "deadlines": {"operation_seconds": profile.timeout_seconds + 45}}
                yield json.dumps(event, separators=(",", ":")) + "\n"
    return StreamingResponse(events(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

