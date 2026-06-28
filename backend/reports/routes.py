from __future__ import annotations

import asyncio
import hashlib
from datetime import date, datetime, timezone
from typing import Any, List, Dict

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.deps import get_db, get_unified_fetcher
from backend.auth.deps import get_current_user
from backend.models.user import User
from backend.reports.generator import generate_pdf_report, rows_for_data_type
from backend.reports.scheduler import scheduled_reports_service
from backend.shared.degraded import (
    DEGRADED_KEY,
    REASON_NO_PROVIDER_DATA,
    degraded_marker,
)

router = APIRouter()
US_MARKETS = {"NASDAQ", "NYSE"}
IN_MARKETS = {"NSE", "BSE"}
SUPPORTED_MARKETS = US_MARKETS | IN_MARKETS


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        out = float(value)
        return out if out == out else None
    if isinstance(value, str):
        cleaned = value.replace(",", "").strip()
        if cleaned in ("", "-", "NA", "N/A", "null", "None"):
            return None
        try:
            out = float(cleaned)
            return out if out == out else None
        except ValueError:
            return None
    return None


def _extract_index_metrics(payload: Dict[str, Any], accepted_names: set[str]) -> tuple[float | None, float | None]:
    candidates: list[dict[str, Any]] = []
    for key in ("data", "indexList", "indices", "results"):
        node = payload.get(key)
        if isinstance(node, list):
            candidates.extend([x for x in node if isinstance(x, dict)])
    if not candidates and payload:
        candidates = [payload]

    for row in candidates:
        name = str(
            row.get("index")
            or row.get("indexName")
            or row.get("name")
            or row.get("symbol")
            or ""
        ).strip().upper()
        if name not in accepted_names:
            continue
        value_out: float | None = None
        pct_out: float | None = None
        for value_key in ("last", "lastPrice", "ltp", "indexValue", "value", "current"):
            parsed = _to_float(row.get(value_key))
            if parsed is not None:
                value_out = parsed
                break
        for pct_key in ("pChange", "percentChange", "changePercent", "netChangePercent"):
            parsed = _to_float(row.get(pct_key))
            if parsed is not None:
                pct_out = parsed
                break
        if value_out is not None or pct_out is not None:
            return value_out, pct_out
    return None, None


def _quarter_end(year: int, quarter: int) -> date:
    if quarter == 1:
        return date(year, 3, 31)
    if quarter == 2:
        return date(year, 6, 30)
    if quarter == 3:
        return date(year, 9, 30)
    return date(year, 12, 31)


def _last_quarter_ends(limit: int) -> list[date]:
    today = date.today()
    quarter = ((today.month - 1) // 3) + 1
    year = today.year
    out: list[date] = []
    while len(out) < limit:
        q_end = _quarter_end(year, quarter)
        if q_end <= today:
            out.append(q_end)
        quarter -= 1
        if quarter == 0:
            quarter = 4
            year -= 1
    return out


def _iso_day(day: date) -> str:
    return datetime(day.year, day.month, day.day, tzinfo=timezone.utc).isoformat()


def _stable_id(market: str, symbol: str, period_end: str, report_type: str) -> str:
    raw = f"{market}|{symbol}|{period_end}|{report_type}".encode("utf-8")
    return hashlib.sha1(raw).hexdigest()[:16]

@router.get("/reports/bulk-deals")
async def bulk_deals() -> Dict[str, Any]:
    fetcher = await get_unified_fetcher()
    try:
        data = await fetcher.nse.get_bulk_deals()
        return data
    except Exception as e:
        return {"error": str(e), "data": []}

@router.get("/reports/block-deals")
async def block_deals() -> Dict[str, Any]:
    fetcher = await get_unified_fetcher()
    try:
        data = await fetcher.nse.get_block_deals()
        return data
    except Exception as e:
        return {"error": str(e), "data": []}


@router.get("/reports/market-status")
async def market_status() -> Dict[str, Any]:
    fetcher = await get_unified_fetcher()

    # Concurrent tasks for speed
    nse_market_task = fetcher.nse.get_market_status()
    nse_indices_task = fetcher.nse.get_index_quote("NIFTY 50")
    yahoo_quotes_task = fetcher.yahoo.get_quotes(
        [
            "^NSEI", "^BSESN", "^GSPC", "^IXIC", "^DJI", "^FTSE", "^GDAXI", "^N225", "^HSI",
            "INRUSD=X", "USDINR=X", "BTC-USD", "ETH-USD",
            # Commodity futures — without these GC=F/SI=F/CL=F never resolve and the
            # ticker tape silently served the hardcoded mock fallbacks below.
            "GC=F", "SI=F", "CL=F",
        ]
    )

    results = await asyncio.gather(
        nse_market_task,
        nse_indices_task,
        yahoo_quotes_task,
        return_exceptions=True,
    )

    nse_market_raw = results[0] if not isinstance(results[0], Exception) else {}
    indices_payload = results[1] if not isinstance(results[1], Exception) else {}
    yahoo_quotes = results[2] if not isinstance(results[2], Exception) else []

    nifty, nifty_pct = _extract_index_metrics(indices_payload, {"NIFTY 50", "NIFTY50", "NIFTY"})
    sensex, sensex_pct = _extract_index_metrics(indices_payload, {"SENSEX", "BSE SENSEX"})

    yahoo_map: dict[str, dict[str, Any]] = {}
    for item in yahoo_quotes:
        if isinstance(item, dict) and item.get("symbol"):
            yahoo_map[item["symbol"].upper()] = item

    # Fallback Logic
    if nifty is None:
        q = yahoo_map.get("^NSEI", {})
        nifty = _to_float(q.get("regularMarketPrice"))
        nifty_pct = _to_float(q.get("regularMarketChangePercent"))

    if sensex is None:
        q = yahoo_map.get("^BSESN", {})
        sensex = _to_float(q.get("regularMarketPrice"))
        sensex_pct = _to_float(q.get("regularMarketChangePercent"))

    sp500 = _to_float(yahoo_map.get("^GSPC", {}).get("regularMarketPrice"))
    sp500_pct = _to_float(yahoo_map.get("^GSPC", {}).get("regularMarketChangePercent"))

    nasdaq = _to_float(yahoo_map.get("^IXIC", {}).get("regularMarketPrice"))
    nasdaq_pct = _to_float(yahoo_map.get("^IXIC", {}).get("regularMarketChangePercent"))

    dow = _to_float(yahoo_map.get("^DJI", {}).get("regularMarketPrice"))
    dow_pct = _to_float(yahoo_map.get("^DJI", {}).get("regularMarketChangePercent"))

    ftse = _to_float(yahoo_map.get("^FTSE", {}).get("regularMarketPrice"))
    ftse_pct = _to_float(yahoo_map.get("^FTSE", {}).get("regularMarketChangePercent"))

    dax = _to_float(yahoo_map.get("^GDAXI", {}).get("regularMarketPrice"))
    dax_pct = _to_float(yahoo_map.get("^GDAXI", {}).get("regularMarketChangePercent"))

    nikkei = _to_float(yahoo_map.get("^N225", {}).get("regularMarketPrice"))
    nikkei_pct = _to_float(yahoo_map.get("^N225", {}).get("regularMarketChangePercent"))

    hangseng = _to_float(yahoo_map.get("^HSI", {}).get("regularMarketPrice"))
    hangseng_pct = _to_float(yahoo_map.get("^HSI", {}).get("regularMarketChangePercent"))

    usd_inr = _to_float(yahoo_map.get("USDINR=X", {}).get("regularMarketPrice"))
    usd_inr_pct = _to_float(yahoo_map.get("USDINR=X", {}).get("regularMarketChangePercent"))

    gold = _to_float(yahoo_map.get("GC=F", {}).get("regularMarketPrice"))
    gold_pct = _to_float(yahoo_map.get("GC=F", {}).get("regularMarketChangePercent"))

    silver = _to_float(yahoo_map.get("SI=F", {}).get("regularMarketPrice"))
    silver_pct = _to_float(yahoo_map.get("SI=F", {}).get("regularMarketChangePercent"))

    crude = _to_float(yahoo_map.get("CL=F", {}).get("regularMarketPrice"))
    crude_pct = _to_float(yahoo_map.get("CL=F", {}).get("regularMarketChangePercent"))

    # Integrity: never fabricate index/commodity quotes. When a quote is
    # unavailable it stays None and the frontend renders "NA" rather than a
    # convincing fake number. If *any* quote is missing we attach the standard
    # degraded marker so the UI can show a "live data unavailable" banner.
    quotes = {
        "nifty50": nifty, "sensex": sensex, "sp500": sp500, "nasdaq": nasdaq,
        "dowjones": dow, "ftse100": ftse, "dax": dax, "nikkei225": nikkei,
        "hangseng": hangseng, "usdInr": usd_inr, "gold": gold, "silver": silver,
        "crude": crude,
    }
    missing = [k for k, v in quotes.items() if v is None]

    market_state = nse_market_raw.get("marketState", []) if isinstance(nse_market_raw, dict) else []

    payload: Dict[str, Any] = {
        "marketState": market_state,
        "nifty50": nifty,
        "nifty50Pct": nifty_pct,
        "sensex": sensex,
        "sensexPct": sensex_pct,
        "usdInr": usd_inr,
        "usdInrPct": usd_inr_pct,
        "sp500": sp500,
        "sp500Pct": sp500_pct,
        "nasdaq": nasdaq,
        "nasdaqPct": nasdaq_pct,
        "dowjones": dow,
        "dowjonesPct": dow_pct,
        "ftse100": ftse,
        "ftse100Pct": ftse_pct,
        "dax": dax,
        "daxPct": dax_pct,
        "nikkei225": nikkei,
        "nikkei225Pct": nikkei_pct,
        "hangseng": hangseng,
        "hangsengPct": hangseng_pct,
        "gold": gold,
        "goldPct": gold_pct,
        "silver": silver,
        "silverPct": silver_pct,
        "crude": crude,
        "crudePct": crude_pct,
        # Back-compat flag (kept for existing consumers); `degraded` is the
        # canonical signal.
        "fallbackEnabled": bool(missing),
        "ts": datetime.now(timezone.utc).isoformat()
    }
    if missing:
        payload[DEGRADED_KEY] = degraded_marker(
            REASON_NO_PROVIDER_DATA,
            detail=f"no live quote for: {', '.join(missing)}",
        )
    return payload

@router.get("/reports/events")
async def events() -> List[Dict[str, Any]]:
    # No live corporate-events calendar is wired to this legacy endpoint. Return
    # an empty list rather than the previous hardcoded India earnings/AGM dates,
    # which masqueraded as real events; the UI shows "No upcoming events found."
    # (The real per-symbol events live under the corporate-actions service.)
    return []


@router.get("/reports/quarterly")
async def quarterly_reports(
    market: str = Query(..., description="NSE|BSE|NASDAQ|NYSE"),
    symbol: str = Query(..., min_length=1, max_length=24),
    limit: int = Query(default=8, ge=1, le=50),
) -> Dict[str, Any]:
    market_code = market.strip().upper()
    ticker = symbol.strip().upper()
    if market_code not in SUPPORTED_MARKETS:
        raise HTTPException(status_code=400, detail=f"Unsupported market: {market_code}")

    # India contract stability path: no provider linked yet.
    if market_code in IN_MARKETS:
        return {"items": []}

    # US stub with SEC links. TODO: replace with direct SEC filings API ingestion.
    quarter_ends = _last_quarter_ends(limit)
    items: list[dict[str, Any]] = []
    for period in quarter_ends:
        report_type = "10-K" if period.month == 12 else "10-Q"
        published = period.replace(day=min(period.day, 28))
        published_day = published if report_type == "10-Q" else date(period.year + 1, 2, 28)
        period_iso = _iso_day(period)
        published_iso = _iso_day(published_day)
        sec_query = f"{ticker} {report_type}"
        sec_search_url = f"https://www.sec.gov/edgar/search/#/q={sec_query.replace(' ', '%20')}"
        items.append(
            {
                "id": _stable_id(market_code, ticker, period_iso, report_type),
                "symbol": ticker,
                "market": market_code,
                "periodEndDate": period_iso,
                "publishedAt": published_iso,
                "reportType": report_type,
                "title": f"{ticker} {report_type} filing",
                "links": [
                    {"label": "PDF", "url": sec_search_url},
                    {"label": "SOURCE", "url": sec_search_url},
                ],
                "source": "SEC",
            }
        )

    items.sort(key=lambda item: item["publishedAt"], reverse=True)
    return {"items": items[:limit]}


# --- Scheduled reports + on-demand generation -----------------------------


def _serialize_scheduled(row: Any) -> Dict[str, Any]:
    return {
        "id": row.id,
        "report_type": row.report_type,
        "frequency": row.frequency,
        "email": row.email,
        "data_type": row.data_type,
        "enabled": bool(row.enabled),
    }


class ScheduledReportCreate(BaseModel):
    report_type: str = Field(min_length=1, max_length=64)
    frequency: str = Field(default="daily", max_length=32)
    # Optional: when omitted, delivery falls back to the authenticated user's
    # account email (see create_scheduled_report). Previously this was required
    # (min_length=3), so omitting it 422'd even though we know the user's email.
    email: str | None = Field(default=None, max_length=255)
    data_type: str = Field(default="positions", max_length=64)


class GenerateReportRequest(BaseModel):
    type: str = Field(default="portfolio", max_length=32)
    params: Dict[str, Any] = Field(default_factory=dict)


@router.get("/reports/scheduled")
def list_scheduled_reports(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    rows = scheduled_reports_service.list(db, current_user.id)
    return {"items": [_serialize_scheduled(r) for r in rows]}


@router.post("/reports/scheduled")
def create_scheduled_report(
    payload: ScheduledReportCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    # Fall back to the authenticated user's account email when none is supplied,
    # so the common "just schedule it for me" case works without a 422.
    email = (payload.email or "").strip() or (current_user.email or "").strip()
    if not email:
        raise HTTPException(status_code=400, detail="No delivery email available")
    row = scheduled_reports_service.create(
        db,
        current_user.id,
        report_type=payload.report_type.strip(),
        frequency=payload.frequency.strip().lower(),
        email=email,
        data_type=payload.data_type.strip().lower(),
    )
    return _serialize_scheduled(row)


@router.delete("/reports/scheduled/{config_id}")
def delete_scheduled_report(
    config_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    deleted = scheduled_reports_service.delete(db, current_user.id, config_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Scheduled report not found")
    return {"status": "deleted", "id": config_id}


# Maps a requested report type to the underlying data rows. Reuses the generator's
# data-type row builders; "stock" narrows the holdings/lots to a single ticker.
def _rows_for_report(db: Session, report_type: str, params: Dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
    key = (report_type or "portfolio").strip().lower()
    if key == "portfolio":
        return "Portfolio Report", rows_for_data_type(db, "positions")
    if key == "backtest":
        return "Backtest Report", rows_for_data_type(db, "screening_results")
    if key == "stock":
        ticker = str(params.get("ticker", "")).strip().upper()
        positions = [r for r in rows_for_data_type(db, "positions") if str(r.get("ticker", "")).upper() == ticker]
        lots = [r for r in rows_for_data_type(db, "tax_lots") if str(r.get("ticker", "")).upper() == ticker]
        return f"Stock Report - {ticker or 'N/A'}", positions + lots
    # Unknown type: fall back to portfolio positions rather than erroring.
    return f"{key.title()} Report", rows_for_data_type(db, "positions")


@router.post("/reports/generate")
def generate_report(
    payload: GenerateReportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    title, rows = _rows_for_report(db, payload.type, payload.params)
    try:
        pdf = generate_pdf_report(rows, title=title)
    except RuntimeError as exc:  # reportlab missing
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    filename = f"{title.lower().replace(' ', '_').replace('-', '')}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
