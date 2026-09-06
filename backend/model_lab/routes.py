from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

from backend.model_lab.schemas import (
    CompareRequest,
    ExperimentCreate,
    ExperimentRunRequest,
    MonteCarloRequest,
    ExperimentSummary,
    ParamSweepRequest,
    RunMetrics,
    RunTimeseries,
    WalkForwardRequest,
)
from backend.model_lab.montecarlo import create_monte_carlo_job, execute_monte_carlo_job, get_monte_carlo_job
from backend.model_lab.service import get_model_lab_service

router = APIRouter()


@router.post("/model-lab/experiments", response_model=ExperimentSummary)
async def create_experiment(payload: ExperimentCreate) -> ExperimentSummary:
    created = await get_model_lab_service().create_experiment(payload)
    return ExperimentSummary(**created)


@router.get("/model-lab/experiments")
async def list_experiments(
    tag: str | None = Query(default=None),
    model: str | None = Query(default=None),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
) -> dict:
    items = await get_model_lab_service().list_experiments(
        tag=tag,
        model_key=model,
        start_date=start_date,
        end_date=end_date,
    )
    return {"items": items}


@router.get("/model-lab/experiments/{experiment_id}")
async def get_experiment(experiment_id: str) -> dict:
    return await get_model_lab_service().get_experiment(experiment_id)


@router.post("/model-lab/experiments/{experiment_id}/run")
async def run_experiment(experiment_id: str, payload: ExperimentRunRequest) -> dict:
    return await get_model_lab_service().enqueue_run(experiment_id=experiment_id, force_refresh=payload.force_refresh)


@router.get("/model-lab/runs/{run_id}")
async def run_status(run_id: str) -> dict:
    return await get_model_lab_service().get_run(run_id)


@router.get("/model-lab/runs/{run_id}/report")
async def run_report(run_id: str, force_refresh: bool = Query(default=False)) -> dict:
    report = await get_model_lab_service().get_report(run_id=run_id, force_refresh=force_refresh)
    if "metrics" in report:
        RunMetrics(run_id=run_id, metrics=report.get("metrics") or {})
    if "series" in report:
        RunTimeseries(run_id=run_id, series=report.get("series") or {})
    return report


@router.post("/model-lab/runs/{run_id}/monte-carlo")
async def run_monte_carlo(run_id: str, payload: MonteCarloRequest, background_tasks: BackgroundTasks) -> dict:
    report = await get_model_lab_service().get_report(run_id=run_id, force_refresh=False)
    if report.get("status") != "succeeded":
        raise HTTPException(status_code=400, detail="Run must be completed before Monte Carlo")
    job = create_monte_carlo_job(run_id)
    background_tasks.add_task(execute_monte_carlo_job, job.id, report, payload.model_dump())
    return {"job_id": job.id, "run_id": run_id, "status": job.status}


@router.get("/model-lab/monte-carlo/{job_id}")
async def monte_carlo_status(job_id: str) -> dict:
    job = get_monte_carlo_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Monte Carlo job not found")
    return {
        "job_id": job.id,
        "run_id": job.run_id,
        "status": job.status,
        "created_at": job.created_at,
        "finished_at": job.finished_at,
        "error": job.error,
        "result": job.result,
    }


@router.post("/model-lab/compare")
async def compare_runs(payload: CompareRequest) -> dict:
    return await get_model_lab_service().compare(payload.run_ids)


@router.get("/model-lab/leaderboard")
async def model_lab_leaderboard(
    sort_by: str = Query(default="sharpe"),
    descending: bool = Query(default=True),
    limit: int = Query(default=50, ge=1, le=250),
    market: str | None = Query(default=None),
) -> dict:
    return await get_model_lab_service().leaderboard(
        sort_by=sort_by,
        descending=descending,
        limit=limit,
        market=market,
    )


@router.post("/model-lab/experiments/{experiment_id}/walk-forward")
async def run_walk_forward(experiment_id: str, payload: WalkForwardRequest) -> dict:
    return await get_model_lab_service().walk_forward(
        experiment_id=experiment_id,
        train_window_days=payload.train_window_days,
        test_window_days=payload.test_window_days,
    )


@router.post("/model-lab/experiments/{experiment_id}/param-sweep")
async def run_param_sweep(experiment_id: str, payload: ParamSweepRequest) -> dict:
    return await get_model_lab_service().param_sweep(
        experiment_id=experiment_id,
        grid=payload.grid,
        max_combinations=payload.max_combinations,
    )
