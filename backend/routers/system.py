"""System router: health, dashboard metrics, settings, evaluation harness."""

import importlib
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from lib.blockchain import besu_status
from lib.db import clean, db
from lib.deps import get_actor, require_roles
from lib.engines import quantum as quantum_engine
from lib.engines.evaluation import run_evaluation
from lib.errors import ApiError
from lib.llm import llm_available, model_label
from lib.demo_content import get_settings
from models.core import SettingsModel

router = APIRouter(tags=["system"])


def _versions() -> dict:
    versions = {}
    for module in ("sklearn", "ortools", "scipy", "qiskit", "qiskit_aer"):
        try:
            versions[module] = importlib.import_module(module).__version__
        except Exception:  # noqa: BLE001
            versions[module] = None
    return versions


def capabilities() -> dict:
    q = quantum_engine.engine_label()
    return {
        "llm": {"available": llm_available(), "detail": model_label()},
        "quantum": {**q, "note": "Simulator only — no quantum hardware access is configured."},
        "ledger": {"mode": "dev-simulation", "simulated": True, "besu": besu_status()},
        "classical_solver": ("ortools-cpsat" if _versions().get("ortools") else ("scipy-highs" if _versions().get("scipy") else None)),
        "versions": _versions(),
    }


@router.get("/health")
async def health():
    return {"status": "ok", "version": "0.9.0-prototype", "time": datetime.now(timezone.utc), "capabilities": capabilities()}


@router.get("/dashboard")
async def dashboard():
    datasets = await db.datasets.find().sort("created_at", -1).to_list(10)
    latest_run = await db.agent_runs.find_one(sort=[("started_at", -1)])
    findings = await db.findings.find({"run_id": latest_run["id"]}).to_list(1000) if latest_run else []
    cases = await db.cases.find().sort("created_at", -1).to_list(200)
    records = [clean(r) for r in await db.decision_records.find().sort("created_at", -1).to_list(100)]
    events_count = await db.audit_events.count_documents({})

    by_severity: dict[str, int] = {}
    for f in findings:
        by_severity[f.get("severity", "?")] = by_severity.get(f.get("severity", "?"), 0) + 1
    cases_by_status: dict[str, int] = {}
    for c in cases:
        cases_by_status[c["status"]] = cases_by_status.get(c["status"], 0) + 1

    approved = next((c for c in cases if c["status"] == "approved"), None)
    tamper_tested = any(r.get("tamper_tests") for r in records if r)
    verified_ok = len([r for r in records if (r.get("last_verification") or {}).get("match")])
    anchored_sim = len([r for r in records if (r.get("anchored") or {}).get("simulated")])
    anchored_real = len([r for r in records if r.get("anchored") and not (r.get("anchored") or {}).get("simulated")])

    return {
        "datasets": len(datasets),
        "latest_quality_score": min((f["quality"]["score"] for f in datasets[0]["files"]), default=None) if datasets else None,
        "open_findings": len(findings),
        "findings_by_severity": by_severity,
        "cases_by_status": cases_by_status,
        "pending_decisions": len([c for c in cases if c["status"] in ("draft", "in_review", "revision_requested")]),
        "records": len(records),
        "verified_ok": verified_ok,
        "anchored_real": anchored_real,
        "anchored_simulated": anchored_sim,
        "audit_events": events_count,
        "recent_decisions": [
            {"id": c["id"], "title": c["title"], "status": c["status"], "uncertainty": (c.get("uncertainty") or {}).get("score"), "created_at": c["created_at"]}
            for c in cases[:5]
        ],
        "demo_state": {
            "dataset_loaded": bool(datasets),
            "workflow_ran": bool(latest_run and latest_run.get("status", "").startswith("completed")),
            "case_created": bool(cases),
            "optimized": bool(approved or any(c.get("optimization_run_id") for c in cases)),
            "approved": bool(approved),
            "record_created": bool(records),
            "anchored": bool(records and any(r.get("anchored") for r in records if r)),
            "tamper_tested": tamper_tested,
            "evaluated": bool(await db.eval_results.find_one()),
        },
        "capabilities": capabilities(),
        "latest_run_id": latest_run["id"] if latest_run else None,
        "latest_case_id": cases[0]["id"] if cases else None,
    }


@router.get("/settings")
async def read_settings():
    return await get_settings()


@router.put("/settings")
async def update_settings(body: SettingsModel, actor: dict = Depends(get_actor)):
    require_roles(actor, {"executive"}, "change system configuration")
    doc = body.model_dump()
    doc["key"] = "global"
    doc["updated_at"] = datetime.now(timezone.utc)
    await db.settings.replace_one({"key": "global"}, doc, upsert=True)
    from lib.audit import audit

    await audit("settings.updated", actor["name"], actor["role"], "settings", "global", f"Settings updated (threshold={doc['uncertainty_threshold']}, envelope={doc['budget_envelope']:,.0f}, QAOA p={doc['qaoa_layers']}, shots={doc['qaoa_shots']}).")
    return clean(await db.settings.find_one({"key": "global"}))


@router.post("/eval/run")
async def eval_run(actor: dict = Depends(get_actor)):
    settings = await get_settings()
    result = await run_evaluation(settings)
    if result.get("status") == "no_dataset":
        raise ApiError(409, "no_dataset", "Load a dataset before running the evaluation harness.")
    from lib.audit import audit

    await audit("eval.completed", actor["name"], actor["role"], "eval", result["id"], "Evaluation harness compared proposed workflow vs baselines against planted ground truth.")
    return result


@router.get("/eval/latest")
async def eval_latest():
    return clean(await db.eval_results.find_one(sort=[("created_at", -1)])) or {"status": "never_run"}
