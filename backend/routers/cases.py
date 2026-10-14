"""Cases router — decision cases, optimization, recommendation, human approval."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from lib.audit import audit
from lib.db import clean, db
from lib.deps import get_actor, require_roles
from lib.demo_content import get_settings
from lib.engines.classical import solve_classical, validate_solution
from lib.engines.quantum import run_quantum
from lib.errors import ApiError
from models.decision import ApprovalIn

router = APIRouter(prefix="/cases", tags=["cases"])

FINAL_STATUSES = {"approved", "rejected"}


async def _case_or_404(case_id: str) -> dict:
    case = clean(await db.cases.find_one({"id": case_id}))
    if not case:
        raise ApiError(404, "not_found", "Decision case not found.")
    return case


@router.get("")
async def list_cases():
    out = []
    async for c in db.cases.find().sort("created_at", -1):
        c = clean(c) or {}
        out.append(
            {
                "id": c["id"],
                "title": c["title"],
                "status": c["status"],
                "uncertainty": c.get("uncertainty"),
                "created_at": c.get("created_at"),
                "has_recommendation": bool(c.get("recommendation")),
                "optimization_run_id": c.get("optimization_run_id"),
            }
        )
    return out


@router.get("/{case_id}")
async def get_case(case_id: str):
    case = await _case_or_404(case_id)
    latest_opt = clean(await db.optimization_runs.find_one({"case_id": case_id}, sort=[("created_at", -1)]))
    return {**case, "latest_optimization": latest_opt}


@router.get("/{case_id}/optimizations")
async def list_optimizations(case_id: str):
    await _case_or_404(case_id)
    out = []
    for r in await db.optimization_runs.find({"case_id": case_id}).sort("created_at", -1).to_list(20):
        r = clean(r)
        if r:
            out.append(r)
    return out


@router.post("/{case_id}/optimize")
async def optimize(case_id: str, actor: dict = Depends(get_actor)):
    case = await _case_or_404(case_id)
    settings = await get_settings()
    eligible = [c for c in case.get("candidates", []) if not c.get("excluded")]
    if not eligible:
        raise ApiError(409, "nothing_to_optimize", "No eligible candidates — every candidate was excluded by constraint checks.")

    candidates = [{"id": c["po_id"], "cost": float(c["cost"]), "value": float(c["value_score"])} for c in eligible]
    budget = float(case.get("budget_envelope") or settings.get("budget_envelope") or 180000)

    classical = solve_classical(candidates, budget)
    classical_validation = validate_solution(candidates, classical["solution"], budget)
    quantum = run_quantum(
        candidates,
        budget,
        p=int(settings.get("qaoa_layers", 1)),
        shots=int(settings.get("qaoa_shots", 1024)),
    )
    quantum_validation = validate_solution(candidates, quantum["solution"], budget)

    # selection policy: feasible first, then higher objective; classical wins ties (exact, reproducible)
    selected_solver, selected = "classical", classical
    if classical["feasible"] != quantum["feasible"]:
        if quantum["feasible"] and not classical["feasible"]:
            selected_solver, selected = "quantum", quantum
    elif quantum["objective"] > classical["objective"]:
        selected_solver, selected = "quantum", quantum

    run_doc = {
        "id": uuid.uuid4().hex,
        "case_id": case_id,
        "created_at": datetime.now(timezone.utc),
        "formulation": case.get("formulation") or quantum.get("formulation") or {},
        "classical": classical,
        "classical_validation": classical_validation,
        "quantum": {k: v for k, v in quantum.items() if k not in ("variable_order",)},
        "quantum_validation": quantum_validation,
        "selected": {
            "solver": selected_solver,
            "solution": selected["solution"],
            "objective": selected["objective"],
            "feasible": selected["feasible"],
            "policy": "best validated objective (feasible first; classical preferred on ties — exact and reproducible)",
        },
        "candidate_pool": [c["id"] for c in candidates],
        "budget": budget,
    }
    await db.optimization_runs.insert_one(dict(run_doc))

    total_cost = sum(float(c["cost"]) for c in eligible if c["po_id"] in selected["solution"])
    await db.cases.update_one(
        {"id": case_id},
        {"$set": {
            "optimization_run_id": run_doc["id"],
            "selected_solution": {
                "solver": selected_solver,
                "solution_ids": selected["solution"],
                "objective": selected["objective"],
                "total_cost": round(total_cost, 2),
                "feasible": selected["feasible"],
            },
        }},
    )
    approx = ""
    if classical["feasible"] and classical["objective"] > 0:
        ratio = quantum["objective"] / classical["objective"] if quantum["feasible"] else 0.0
        approx = f" — quantum approximation ratio {ratio:.2f}"
    await audit(
        "optimization.completed",
        actor["name"],
        actor["role"],
        "optimization_run",
        run_doc["id"],
        (
            f"Optimization on {len(candidates)} candidates: classical {classical['solver']} objective "
            f"{classical['objective']:.3f} in {classical['runtime_ms']:.0f}ms; QAOA ({quantum['engine']}) objective "
            f"{quantum['objective']:.3f} in {quantum['runtime_ms']:.0f}ms{approx}. Selected: {selected_solver}."
        ),
        {"selected_solver": selected_solver},
    )
    return clean(run_doc)


@router.post("/{case_id}/recommendation")
async def create_recommendation(case_id: str, actor: dict = Depends(get_actor)):
    case = await _case_or_404(case_id)
    if not case.get("optimization_run_id"):
        raise ApiError(409, "optimize_first", "Run the optimization before generating the recommendation.")
    opt = clean(await db.optimization_runs.find_one({"id": case["optimization_run_id"]}))
    if not opt:
        raise ApiError(500, "missing_run", "Optimization run referenced by this case is missing.")

    sel = case.get("selected_solution") or {}
    excluded = [c for c in case.get("candidates", []) if c.get("excluded")]
    held = ", ".join(c["po_id"] for c in excluded) or "none"
    summary = (
        f"Release {len(sel.get('solution_ids', []))} purchase order(s) totalling {sel.get('total_cost', 0):,.0f} "
        f"against the {case.get('budget_envelope', 0):,.0f} envelope (selected solver: {sel.get('solver', 'n/a')}); "
        f"hold {len(excluded)} flagged record(s) ({held}) for correction or escalation."
    )
    rationale_parts = [case.get("rationale") or "Constraint-validated selection based on value scores and policy findings."]
    rationale_parts.append(
        f"Optimization evidence: classical {opt['classical'].get('solver')} → objective {opt['classical'].get('objective'):.3f} "
        f"({opt['classical'].get('runtime_ms'):.0f} ms, status {opt['classical'].get('solver_status')}); "
        f"quantum {opt['quantum'].get('engine')} → objective {opt['quantum'].get('objective'):.3f} "
        f"({opt['quantum'].get('runtime_ms'):.0f} ms, feasible={opt['quantum'].get('feasible')})."
    )
    recommendation = {
        "id": uuid.uuid4().hex,
        "case_id": case_id,
        "summary": summary,
        "executive_summary": case.get("executive_summary", ""),
        "rationale": " ".join(rationale_parts)[:3000],
        "evidence": case.get("evidence", []),
        "constraints": case.get("constraints", []),
        "uncertainty": case.get("uncertainty"),
        "limitations": case.get("limitations", []),
        "alternatives_considered": [{"id": a["id"], "label": a["label"], "feasible": a.get("feasible")} for a in case.get("alternatives", [])],
        "optimization_run_id": opt["id"],
        "created_by": actor["name"],
        "created_by_role": actor["role"],
        "created_at": datetime.now(timezone.utc),
        "note": "Decision support, not proof of correctness: verify evidence and constraints before relying on this recommendation.",
    }
    await db.recommendations.insert_one(dict(recommendation))  # copy: keep _id out of the embedded case doc
    await db.cases.update_one({"id": case_id}, {"$set": {"recommendation": recommendation, "status": "in_review" if case["status"] == "draft" else case["status"]}})
    await audit("recommendation.created", actor["name"], actor["role"], "case", case_id, f"Recommendation generated for case '{case['title']}'.")
    return await _case_or_404(case_id)


@router.post("/{case_id}/approve")
async def approve(case_id: str, body: ApprovalIn, actor: dict = Depends(get_actor)):
    case = await _case_or_404(case_id)
    action = body.action
    if action not in ("approve", "reject", "revise"):
        raise ApiError(422, "bad_action", "action must be one of: approve, reject, revise.")
    require_roles(actor, {"approver", "executive"}, f"{action} a decision (analysts draft and analyze; final sign-off requires the Approver or Executive role)")

    if case["status"] in FINAL_STATUSES:
        raise ApiError(409, "already_final", f"Case is already {case['status']}. Final decisions are immutable in this prototype.")

    transitions = {"approve": "approved", "reject": "rejected", "revise": "revision_requested"}
    to_status = transitions[action]
    approval = {
        "id": uuid.uuid4().hex,
        "action": action,
        "actor_id": actor["id"],
        "actor": actor["name"],
        "actor_role": actor["role"],
        "reason": body.reason,
        "from_status": case["status"],
        "to_status": to_status,
        "ts": datetime.now(timezone.utc),
    }
    await db.cases.update_one({"id": case_id}, {"$set": {"status": to_status}, "$push": {"approvals": approval}})
    await audit(
        f"approval.{action}",
        actor["name"],
        actor["role"],
        "case",
        case_id,
        f"{action.upper()} — {actor['name']} ({actor['role']}) moved '{case['title']}' from {case['status']} to {to_status}: {body.reason}",
        {"from_status": case["status"], "to_status": to_status},
    )
    return await _case_or_404(case_id)
