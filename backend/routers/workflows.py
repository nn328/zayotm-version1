"""Workflow router — multi-agent runs (async execution, polling)."""

import asyncio

from fastapi import APIRouter, Depends

from lib.audit import audit
from lib.db import clean, db
from lib.deps import get_actor
from lib.demo_content import get_settings
from lib.engines.orchestrator import workflow_for
from lib.errors import ApiError
from models.data import WorkflowRunIn

router = APIRouter(prefix="/workflows", tags=["workflows"])


@router.post("/run")
async def start_run(body: WorkflowRunIn, actor: dict = Depends(get_actor)):
    dataset = clean(await db.datasets.find_one({"id": body.dataset_id}))
    if not dataset:
        raise ApiError(404, "not_found", "Dataset not found — load the sample dataset or upload a CSV first.")
    settings = await get_settings()

    wf = workflow_for(dataset, settings, actor["name"], actor["role"])
    # visible "running" doc immediately, so the UI can poll from the first click
    await db.agent_runs.update_one(
        {"id": wf.run_id},
        {"$set": {"id": wf.run_id, "dataset_id": dataset["id"], "dataset_name": dataset.get("name"), "status": "running", "mode": "adaptive multi-agent (conditional routing)", "started_at": dataset.get("created_at"), "agents": [], "errors": []}},
        upsert=True,
    )
    run_id = wf.run_id
    asyncio.create_task(wf.run())
    await audit("workflow.started", actor["name"], actor["role"], "agent_run", run_id, f"Multi-agent workflow started on dataset '{dataset.get('name')}'.")
    return {"run_id": run_id, "status": "running"}


@router.get("/runs")
async def list_runs():
    out = []
    for r in await db.agent_runs.find().sort("started_at", -1).to_list(20):
        r = clean(r) or {}
        out.append(
            {
                "id": r.get("id"),
                "dataset_name": r.get("dataset_name"),
                "status": r.get("status"),
                "started_at": r.get("started_at"),
                "finished_at": r.get("finished_at"),
                "uncertainty": r.get("uncertainty"),
                "case_id": r.get("case_id"),
                "agents_completed": len([a for a in r.get("agents", []) if a.get("status") == "completed"]),
                "agents_total": len(r.get("agents", [])),
            }
        )
    return out


@router.get("/runs/{run_id}")
async def get_run(run_id: str):
    run = clean(await db.agent_runs.find_one({"id": run_id}))
    if not run:
        raise ApiError(404, "not_found", "Workflow run not found.")
    return run
