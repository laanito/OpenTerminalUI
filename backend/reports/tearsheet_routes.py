from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Response

from backend.api.deps import get_db
from backend.core.historical_data_service import get_historical_data_service
from backend.model_lab.service import get_model_lab_service
from backend.models import ModelExperiment, ModelRun, PortfolioDefinition, PortfolioRun
from backend.portfolio_lab.service import get_portfolio_lab_service
from backend.reports.tearsheet import generate_strategy_tearsheet_html, infer_benchmark
from backend.shared.market_defaults import DEFAULT_EQUITY_MARKET

tearsheet_router = APIRouter()


def _run_context(lab_key: str, run_id: str) -> dict:
    db = next(get_db())
    try:
        if lab_key == "model-lab":
            row = (
                db.query(ModelRun, ModelExperiment)
                .join(ModelExperiment, ModelRun.experiment_id == ModelExperiment.id)
                .filter(ModelRun.id == run_id)
                .first()
            )
            if not row:
                return {}
            _run, experiment = row
            universe = experiment.universe_json or {}
            return {
                "market": universe.get("market", DEFAULT_EQUITY_MARKET)
                if isinstance(universe, dict)
                else DEFAULT_EQUITY_MARKET,
                "start": experiment.start_date,
                "end": experiment.end_date,
            }
        row = (
            db.query(PortfolioRun, PortfolioDefinition)
            .join(PortfolioDefinition, PortfolioRun.portfolio_id == PortfolioDefinition.id)
            .filter(PortfolioRun.id == run_id)
            .first()
        )
        if not row:
            return {}
        _run, portfolio = row
        universe = portfolio.universe_json or {}
        return {
            "market": universe.get("market", DEFAULT_EQUITY_MARKET)
            if isinstance(universe, dict)
            else DEFAULT_EQUITY_MARKET,
            "start": portfolio.start_date,
            "end": portfolio.end_date,
        }
    finally:
        db.close()


def _benchmark_curve(market: str, start: str | None, end: str | None) -> list[dict]:
    symbol = infer_benchmark(market)
    fetch_market = "NYSE" if symbol == "SPY" else "NSE"
    try:
        _resolved, bars = get_historical_data_service().fetch_daily_ohlcv(
            raw_symbol=symbol,
            market=fetch_market,
            start=start,
            end=end,
            limit=4000,
        )
    except Exception:
        return []
    if not bars:
        return []
    first = float(bars[0].close or 0.0)
    if first <= 0:
        return []
    return [{"date": bar.date, "value": round(float(bar.close) / first * 100000.0, 6)} for bar in bars if float(bar.close or 0.0) > 0]


@tearsheet_router.get("/reports/tearsheets/{lab}/{run_id}")
async def get_tearsheet(lab: str, run_id: str, download: bool = Query(default=False)) -> Response:
    lab_key = lab.strip().lower().replace("_", "-")
    if lab_key == "model-lab":
        report = await get_model_lab_service().get_report(run_id)
    elif lab_key == "portfolio-lab":
        report = await get_portfolio_lab_service().get_report(run_id)
    else:
        raise HTTPException(status_code=400, detail="lab must be model-lab or portfolio-lab")
    if report.get("status") not in {"succeeded", "completed"}:
        raise HTTPException(status_code=400, detail="Run report is not ready")
    context = _run_context(lab_key, run_id)
    report["market"] = context.get("market")
    series = report.setdefault("series", {})
    if not series.get("benchmark_curve") and not series.get("benchmark_equity"):
        series["benchmark_curve"] = _benchmark_curve(
            str(context.get("market") or DEFAULT_EQUITY_MARKET),
            context.get("start"),
            context.get("end"),
        )
    html = generate_strategy_tearsheet_html(run_id=run_id, lab=lab_key, report=report, market=context.get("market"))
    headers = {}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{lab_key}-{run_id}-tearsheet.html"'
    return Response(content=html, media_type="text/html; charset=utf-8", headers=headers)
