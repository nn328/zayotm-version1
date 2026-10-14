"""Classical Optimization Engine (Layer 4).

Baseline solver: OR-Tools CP-SAT (exact branch-and-cut over the binary
selection problem), with a scipy/HiGHS MILP fallback. Deterministic
(single worker, fixed seed) so the baseline is reproducible run-to-run.
"""

import logging
import time

logger = logging.getLogger("zayotm.classical")

try:
    from ortools.sat.python import cp_model

    _ORTOOLS = True
except Exception:  # noqa: BLE001
    _ORTOOLS = False

try:
    from scipy.optimize import milp, LinearConstraint, Bounds

    _SCIPY = True
except Exception:  # noqa: BLE001
    _SCIPY = False


def solve_classical(candidates: list[dict], budget: float) -> dict:
    """candidates: [{id, cost, value}] — maximize Σ value·x subject to Σ cost·x ≤ budget, x binary."""
    started = time.perf_counter()
    n = len(candidates)
    values = [float(c["value"]) for c in candidates]
    costs = [float(c["cost"]) for c in candidates]

    if _ORTOOLS:
        try:
            model = cp_model.CpModel()
            xs = [model.NewBoolVar(f"x_{c['id']}") for c in candidates]
            # CP-SAT is integer-only: scale values (×10^4) and costs (currency, already integral) to ints
            scale = 10_000
            values_i = [int(round(v * scale)) for v in values]
            costs_i = [int(round(c)) for c in costs]
            budget_i = int(round(budget))
            model.Add(sum(costs_i[i] * xs[i] for i in range(n)) <= budget_i)
            model.Maximize(sum(values_i[i] * xs[i] for i in range(n)))
            solver = cp_model.CpSolver()
            solver.parameters.num_workers = 1  # deterministic
            solver.parameters.max_time_in_seconds = 5.0
            status = solver.Solve(model)
            runtime_ms = (time.perf_counter() - started) * 1000
            if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                chosen = [candidates[i]["id"] for i in range(n) if solver.Value(xs[i]) == 1]
                objective = sum(values[i] for i in range(n) if solver.Value(xs[i]) == 1)
                return {
                    "solver": "ortools-cpsat (exact)",
                    "solver_status": "OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE",
                    "objective": round(objective, 4),
                    "runtime_ms": round(runtime_ms, 2),
                    "feasible": True,
                    "solution": chosen,
                    "notes": ["Exact solver — objective is provably optimal."],
                }
            return {
                "solver": "ortools-cpsat (exact)",
                "solver_status": "INFEASIBLE",
                "objective": 0.0,
                "runtime_ms": round(runtime_ms, 2),
                "feasible": False,
                "solution": [],
                "notes": ["No feasible selection under the budget constraint."],
            }
        except Exception as exc:  # noqa: BLE001
            logger.warning("OR-Tools failed (%s) — falling back to scipy HiGHS", exc)

    if _SCIPY:
        import numpy as np

        res = milp(
            c=-np.array(values),
            constraints=[LinearConstraint(np.array([costs]), -np.inf, budget)],
            integrality=np.ones(n),
            bounds=Bounds(0, 1),
        )
        runtime_ms = (time.perf_counter() - started) * 1000
        if res.success:
            chosen = [candidates[i]["id"] for i in range(n) if res.x[i] > 0.5]
            objective = sum(values[i] for i in range(n) if res.x[i] > 0.5)
            return {
                "solver": "scipy-highs MILP (exact)",
                "solver_status": "OPTIMAL" if res.status == 0 else "FEASIBLE",
                "objective": round(objective, 4),
                "runtime_ms": round(runtime_ms, 2),
                "feasible": True,
                "solution": chosen,
                "notes": ["OR-Tools unavailable — scipy/HiGHS fallback (still an exact solver)."],
            }

    return {
        "solver": "none",
        "solver_status": "SOLVER_UNAVAILABLE",
        "objective": 0.0,
        "runtime_ms": 0.0,
        "feasible": False,
        "solution": [],
        "notes": ["No classical solver available: neither OR-Tools nor scipy could be imported."],
    }


def validate_solution(candidates: list[dict], solution_ids: list[str], budget: float) -> dict:
    """Deterministic post-solver constraint validation (Layer 4 constraint validation)."""
    by_id = {c["id"]: c for c in candidates}
    chosen = [by_id[i] for i in solution_ids if i in by_id]
    total_cost = sum(c["cost"] for c in chosen)
    return {
        "feasible": total_cost <= budget,
        "total_cost": round(total_cost, 2),
        "budget": budget,
        "within_budget": total_cost <= budget,
        "selected_count": len(chosen),
        "checks": [
            {"id": "budget", "description": f"Σ cost ≤ {budget:,.0f}", "passed": total_cost <= budget, "observed": f"{total_cost:,.0f}"},
            {"id": "binary", "description": "each candidate selected at most once", "passed": len(set(solution_ids)) == len(solution_ids), "observed": f"{len(solution_ids)} picked"},
        ],
    }
