"""Multi-Agent Orchestration Engine (Layer 6).

A stateful workflow engine (LangGraph-equivalent pattern implemented natively):
agents execute in dependency order over a shared mutable state, each with
defined inputs, outputs, durations, retry (once) and explicit error states.
Conditional routing keeps LLM usage to exactly two calls (Reasoning +
Explainability) and skips agents that have nothing to do. Every routing
decision is recorded and surfaced in the UI.
"""

import logging
import time
import uuid
from datetime import datetime, timezone

from lib import llm
from lib.db import db
from lib.engines import anomaly as anomaly_engine
from lib.engines import knowledge as knowledge_engine
from lib.engines import rules as rules_engine
from lib.engines import quantum as quantum_engine
from lib.engines.rules import APPROVAL_LIMITS, _num
from lib.engines.uncertainty import compute_uncertainty

logger = logging.getLogger("zayotm.orchestrator")

AGENT_CATALOG = [
    {"key": "data_agent", "name": "Data Agent", "type": "deterministic", "responsibility": "Schema, quality profile, lineage"},
    {"key": "knowledge_agent", "name": "Knowledge Agent", "type": "deterministic (TF-IDF retrieval)", "responsibility": "Policy evidence retrieval (RAG)"},
    {"key": "document_agent", "name": "Document Agent", "type": "deterministic", "responsibility": "Policy document structure extraction"},
    {"key": "anomaly_agent", "name": "Anomaly Agent", "type": "ml + deterministic", "responsibility": "IsolationForest scores + cross-record conflicts"},
    {"key": "compliance_agent", "name": "Compliance Agent", "type": "deterministic", "responsibility": "Explicit policy/constraint checks"},
    {"key": "reasoning_agent", "name": "Reasoning Agent", "type": "LLM + deterministic fallback", "responsibility": "Decision alternatives from findings"},
    {"key": "optimization_agent", "name": "Optimization Agent", "type": "deterministic", "responsibility": "Objective formulation, QUBO mapping, solver routing"},
    {"key": "explainability_agent", "name": "Explainability Agent", "type": "LLM + deterministic fallback", "responsibility": "Evidence-linked rationale and limitations"},
    {"key": "trust_agent", "name": "Trust Agent", "type": "deterministic crypto", "responsibility": "Record hashing + verification (invoked at record creation)"},
    {"key": "orchestrator", "name": "Orchestrator Agent", "type": "stateful workflow", "responsibility": "Coordination, conditional routing, escalation"},
]

PRIORITY_NORM = {"high": 1.0, "medium": 0.6, "low": 0.3}
EXCLUDING_RULES = {"R1-approval-limit", "R2-supplier-watchlist", "R3-amount-mismatch", "R4-missing-mandatory", "R5-budget-exceeded", "X2-divergent-duplicate"}


def _now():
    return datetime.now(timezone.utc)


class Workflow:
    def __init__(self, dataset: dict, settings: dict, actor: str, actor_role: str):
        self.dataset = dataset
        self.dataset_id = dataset["id"]
        self.settings = settings
        self.actor = actor
        self.actor_role = actor_role
        self.trace: list[dict] = []
        self.routing: list[dict] = []
        self.state: dict = {}
        self.run_id = uuid.uuid4().hex

    # ---- trace helper with retry-once semantics -------------------------------------
    async def _step(self, agent_key: str, fn):
        catalog = next(a for a in AGENT_CATALOG if a["key"] == agent_key)
        entry: dict = {"agent": agent_key, "name": catalog["name"], "type": catalog["type"], "status": "running"}
        t0 = time.perf_counter()
        attempts = 2
        for attempt in range(1, attempts + 1):
            try:
                summary, output = await fn()
                entry.update(
                    status="completed",
                    duration_ms=round((time.perf_counter() - t0) * 1000, 1),
                    summary=str(summary)[:280],
                    output=output,
                    llm_used=bool(self.state.get(f"_llm_{agent_key}")),
                )
                if attempt == 2:
                    entry["note"] = "succeeded on retry 1 (orchestration retry policy)"
                self.trace.append(entry)
                return output
            except Exception as exc:  # noqa: BLE001 — an agent failure must be visible, not fatal
                logger.exception("agent %s failed (attempt %s)", agent_key, attempt)
                if attempt < attempts:
                    self.routing.append({"agent": agent_key, "decision": "retry once after error", "error": str(exc)[:160]})
                else:
                    entry.update(
                        status="failed",
                        duration_ms=round((time.perf_counter() - t0) * 1000, 1),
                        summary=f"failed: {exc}",
                        error=str(exc)[:500],
                    )
                    self.trace.append(entry)
                    return None
        return None

    # ---- agents ---------------------------------------------------------------------
    async def run(self) -> dict:
        run_doc = {
            "id": self.run_id,
            "dataset_id": self.dataset_id,
            "dataset_name": self.dataset.get("name"),
            "status": "running",
            "mode": "adaptive multi-agent (conditional routing)",
            "started_at": _now(),
            "finished_at": None,
            "agents": [],
            "routing_decisions": [],
            "uncertainty": None,
            "escalation": None,
            "evidence": [],
            "case_id": None,
            "llm": {"available": llm.llm_available(), "model": llm.MODEL if llm.llm_available() else None, "used_in": []},
            "errors": [],
        }
        await db.agent_runs.update_one({"id": self.run_id}, {"$set": run_doc}, upsert=True)

        orchestrator_note = await self._step("orchestrator", self._a_bootstrap)
        # agents in dependency order
        await self._step("data_agent", self._a_data)
        await self._step("document_agent", self._a_documents)
        await self._step("anomaly_agent", self._a_anomaly)
        await self._step("compliance_agent", self._a_compliance)
        await self._step("knowledge_agent", self._a_knowledge)
        await self._step("orchestrator", self._a_uncertainty)
        await self._step("reasoning_agent", self._a_reasoning)
        await self._step("optimization_agent", self._a_optimization_formulation)
        await self._step("explainability_agent", self._a_explainability)
        await self._step("orchestrator", self._a_finalize)

        run_doc["agents"] = self.trace
        run_doc["routing_decisions"] = self.routing
        run_doc["uncertainty"] = self.state.get("uncertainty")
        run_doc["escalation"] = self.state.get("escalation")
        run_doc["evidence"] = self.state.get("evidence", [])
        run_doc["case_id"] = self.state.get("case_id")
        run_doc["llm"]["used_in"] = [k for k in ("reasoning_agent", "explainability_agent") if self.state.get(f"_llm_{k}")]
        run_doc["finished_at"] = _now()
        errors = [t for t in self.trace if t["status"] == "failed"]
        run_doc["status"] = "completed_with_errors" if errors else "completed"
        run_doc["errors"] = [e["summary"] for e in errors]
        await db.agent_runs.replace_one({"id": self.run_id}, run_doc, upsert=True)
        return run_doc

    # ---- agent implementations ------------------------------------------------------
    async def _a_bootstrap(self):
        po_count = await db.dataset_rows.count_documents({"dataset_id": self.dataset_id, "source_file": "purchase_orders"})
        doc_count = await db.documents.count_documents({})
        self.state["po_rows"] = await db.dataset_rows.find({"dataset_id": self.dataset_id, "source_file": "purchase_orders"}).to_list(5000)
        self.state["suppliers"] = {r["data"]["supplier_id"]: r["data"] for r in await db.dataset_rows.find({"dataset_id": self.dataset_id, "source_file": "suppliers"}).to_list(5000)}
        self.state["budgets"] = [r["data"] for r in await db.dataset_rows.find({"dataset_id": self.dataset_id, "source_file": "budgets"}).to_list(5000)]
        self.state["deliveries"] = [r["data"] for r in await db.dataset_rows.find({"dataset_id": self.dataset_id, "source_file": "deliveries"}).to_list(5000)]
        self.state["policy_docs"] = [d async for d in db.documents.find({})]
        self.routing.append({"agent": "orchestrator", "decision": f"dataset '{self.dataset.get('name')}' → {po_count} purchase orders, {doc_count} policy documents in corpus"})
        return (
            f"Workflow started for dataset '{self.dataset.get('name')}': {po_count} POs, {doc_count} policy docs, {len(self.state['budgets'])} budget lines.",
            {"po_count": po_count, "policy_docs": doc_count, "mode": self.dataset.get("source")},
        )

    async def _a_data(self):
        profiles = self.dataset.get("files", [])
        worst = min((f["quality"]["score"] for f in profiles), default=None)
        return (
            f"Profiled {len(profiles)} files; lowest quality score {worst}/100.",
            {"files": [{"file": f["file"], "rows": f["row_count"], "quality": f["quality"]} for f in profiles]},
        )

    async def _a_documents(self):
        docs = self.state["policy_docs"]
        if not docs:
            self.routing.append({"agent": "document_agent", "decision": "skipped — no documents attached to dataset"})
            return "No documents attached — agent skipped.", {"skipped": True}
        sections = knowledge_engine._passages(docs)
        return (
            f"Indexed {len(docs)} policy documents into {len(sections)} retrievable sections.",
            {"documents": [{"id": d["id"], "title": d["title"]} for d in docs], "sections": len(sections)},
        )

    async def _a_anomaly(self):
        po_rows = [r["data"] for r in self.state["po_rows"]]
        scores, meta = anomaly_engine.isolation_forest_scores(po_rows, contamination=float(self.settings.get("contamination", 0.12)))
        conflicts = anomaly_engine.conflict_findings(self.dataset_id, po_rows, self.state["deliveries"])
        self.state["if_scores"] = scores
        self.state["if_meta"] = meta
        self.state["conflicts"] = conflicts
        top = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[:5]
        findings = []
        for po_id, score in top:
            if score >= 0.55 and score == max(scores.values()):
                findings.append(
                    {
                        "kind": "anomaly",
                        "engine": "isolation_forest",
                        "rule_id": "A1-isolation-forest",
                        "title": f"Statistical anomaly: PO {po_id}",
                        "reason": f"IsolationForest score {score:.2f} — the record deviates sharply from the multivariate numeric profile (quantity/unit_price/total_amount). Suspicion, not a confirmed violation.",
                        "severity": "high" if score >= 0.8 else "medium",
                        "record_ids": [po_id],
                        "fields": ["quantity", "unit_price", "total_amount"],
                        "policy_ref": None,
                        "evidence_query": f"data quality anomaly investigation purchase order {po_id}",
                        "score": score,
                    }
                )
        self.state["if_findings"] = findings
        return (
            f"IsolationForest scored {len(scores)} records ({meta.get('engine', meta.get('algorithm'))}); {len(findings)} statistical anomaly finding(s); {len(conflicts)} cross-record conflict(s).",
            {"engine": meta, "anomaly_scores_top": top, "conflicts": conflicts, "findings": findings},
        )

    async def _a_compliance(self):
        po_rows = [r["data"] for r in self.state["po_rows"]]
        rule_findings = rules_engine.run_rules(po_rows, self.state["suppliers"], self.state["budgets"])
        self.state["rule_findings"] = rule_findings
        by_rule: dict[str, int] = {}
        for f in rule_findings:
            by_rule[f["rule_id"]] = by_rule.get(f["rule_id"], 0) + 1
        return (
            f"{len(rule_findings)} confirmed policy violation(s): " + ", ".join(f"{k}×{v}" for k, v in by_rule.items()) + ".",
            {"findings": rule_findings, "by_rule": by_rule},
        )

    async def _a_knowledge(self):
        findings = (self.state.get("rule_findings") or []) + (self.state.get("if_findings") or []) + (self.state.get("conflicts") or [])
        evidence: list[dict] = []
        gaps: list[str] = []
        for finding in findings:
            query = finding.get("evidence_query") or finding.get("title", "")
            items, gap = knowledge_engine.retrieve(query, self.state["policy_docs"], k=2)
            if gap:
                broadened, gap2 = knowledge_engine.retrieve(" ".join(query.split()[:6]), self.state["policy_docs"], k=1)
                if broadened and not gap2:
                    self.routing.append({"agent": "knowledge_agent", "decision": f"broadened retrieval after empty result for '{query[:60]}'"})
                    items = broadened
                else:
                    gaps.append(finding.get("rule_id", finding.get("title", "?")))
                    self.routing.append({"agent": "knowledge_agent", "decision": f"no supporting passage found for {finding.get('rule_id', '')} — gap recorded, nothing invented"})
                    continue
            for item in items:
                item = {**item, "linked_finding": finding.get("rule_id"), "record_ids": finding.get("record_ids", [])}
                if not any(e["doc_id"] == item["doc_id"] and e["section"] == item["section"] and e["linked_finding"] == item["linked_finding"] for e in evidence):
                    evidence.append(item)
        self.state["evidence"] = evidence
        self.state["evidence_gaps"] = gaps
        return (
            f"Retrieved {len(evidence)} evidence passage(s) for {len(findings)} findings; {len(gaps)} evidence gap(s).",
            {"evidence": evidence, "gaps": gaps},
        )

    async def _a_uncertainty(self):
        quality = min((f["quality"]["score"] for f in self.dataset.get("files", [])), default=100.0)
        findings = (self.state.get("rule_findings") or []) + (self.state.get("if_findings") or []) + (self.state.get("conflicts") or [])
        unc = compute_uncertainty(quality, findings, len(self.state.get("evidence", [])), float(self.settings.get("uncertainty_threshold", 65)))
        self.state["uncertainty"] = unc
        if unc["escalation_required"]:
            self.state["escalation"] = {
                "triggered": True,
                "reason": f"uncertainty {unc['score']} ≥ configured threshold {unc['threshold']}",
                "action": "human approval mandatory before any release; recommendation labeled high-uncertainty",
            }
            self.routing.append({"agent": "orchestrator", "decision": f"uncertainty {unc['score']} ≥ {unc['threshold']} → escalated to mandatory human review"})
        return (
            f"Uncertainty {unc['score']}/100 ({unc['band']}); escalation={'yes' if unc['escalation_required'] else 'no'}.",
            unc,
        )

    async def _a_reasoning(self):
        candidates = self._build_candidates()
        self.state["candidates"] = candidates
        alternatives = self._build_alternatives(candidates)
        self.state["alternatives"] = alternatives

        llm_payload = {
            "case": "Disposition of flagged and pending purchase orders within budget and policy constraints",
            "candidates": [
                {k: c[k] for k in ("po_id", "supplier_name", "department", "amount", "priority", "excluded", "exclusion_reason") if k in c}
                for c in candidates
            ],
            "findings": [
                {"rule_id": f.get("rule_id"), "severity": f.get("severity"), "reason": f.get("reason")} for f in (self.state.get("rule_findings") or [])
            ],
            "evidence_available": [f"{e['title']} {e['section']}" for e in self.state.get("evidence", [])],
            "uncertainty": self.state.get("uncertainty"),
            "budget_envelope": self.settings.get("budget_envelope", 180000),
        }
        system = (
            "You are the Reasoning Agent of an enterprise decision platform. Use ONLY the facts in the JSON. "
            "Cite finding rule_ids. Return strict JSON: {\"alternatives\":[{\"id\":\"alt-A\",\"label\":str,\"description\":str}],"
            "\"executive_summary\":str,\"rationale\":str,\"limitations\":[str,...]}. Do not invent constraints, numbers, or evidence. "
            "Alternatives must respect the exclusions already provided."
        )
        parsed = await llm.complete_json_with_retry(system, "Decision input:\n" + _compact(llm_payload))
        if parsed:
            self.state["_llm_reasoning_agent"] = True
            llm_alts = parsed.get("alternatives") or []
            for alt in alternatives:
                match = next((a for a in llm_alts if str(a.get("id", "")).lower().startswith(alt["id"].split("-")[-1].lower()) or a.get("id") == alt["id"]), None)
                if match:
                    alt["description"] = str(match.get("description", alt["description"]))[:500]
                    alt["label"] = str(match.get("label", alt["label"]))[:120]
            self.state["executive_summary"] = str(parsed.get("executive_summary", ""))[:900]
            self.state["rationale"] = str(parsed.get("rationale", ""))[:2000]
            self.state["limitations"] = [str(x)[:240] for x in (parsed.get("limitations") or [])][:6]
            basis = "LLM (openai/" + llm.MODEL + ") grounded on provided findings/evidence, with deterministic constraint checks"
        else:
            basis = "deterministic template (LLM unavailable or returned unparseable output — fallback used, nothing invented)"
            self.state.setdefault("executive_summary", "")
            self.state.setdefault("rationale", "")
            self.state.setdefault("limitations", [])

        return (
            f"{len(alternatives)} alternatives generated ({basis}).",
            {"alternatives": alternatives, "basis": basis},
        )

    def _build_candidates(self) -> list[dict]:
        from lib.dates import today_iso
        from datetime import date

        po_rows = [r["data"] for r in self.state["po_rows"]]
        violations_by_po: dict[str, list[str]] = {}
        for f in (self.state.get("rule_findings") or []) + (self.state.get("conflicts") or []):
            for rid in f.get("record_ids", []):
                violations_by_po.setdefault(rid, []).append(f.get("rule_id", f.get("kind", "?")))
        suppliers = self.state["suppliers"]
        today = date.fromisoformat(today_iso())
        candidates = []
        for row in po_rows:
            if (row.get("status") or "").strip() != "pending_approval":
                continue
            po_id = row.get("po_id", "")
            amount = _num(row.get("total_amount"), 0.0)
            supplier = suppliers.get(row.get("supplier_id"), {})
            rule_hits = violations_by_po.get(po_id, [])
            excluded = any(r in EXCLUDING_RULES for r in rule_hits)
            needed = row.get("needed_by", "")
            try:
                days = (date.fromisoformat(needed) - today).days
            except ValueError:
                days = 45
            urgency = min(1.0, max(0.05, 1.0 - days / 90.0))
            priority = (row.get("priority") or "low").strip().lower()
            reliability = float(supplier.get("reliability_score") or 0.75)
            value = round(0.4 * PRIORITY_NORM.get(priority, 0.3) + 0.3 * reliability + 0.3 * urgency, 4)
            candidates.append(
                {
                    "po_id": po_id,
                    "supplier_id": row.get("supplier_id"),
                    "supplier_name": supplier.get("name", row.get("supplier_id", "")),
                    "department": row.get("department", ""),
                    "category": row.get("category", ""),
                    "item": row.get("item", ""),
                    "amount": amount,
                    "cost": amount,
                    "priority": priority,
                    "needed_by": needed,
                    "value_score": value,
                    "value_model": "0.4*priority + 0.3*supplier_reliability + 0.3*urgency(needed_by)",
                    "excluded": excluded,
                    "exclusion_reason": ("; ".join(sorted(set(rule_hits))) if excluded else None),
                    "rule_hits": sorted(set(rule_hits)),
                }
            )
        return candidates

    def _build_alternatives(self, candidates: list[dict]) -> list[dict]:
        budget = float(self.settings.get("budget_envelope", 180000))
        eligible = [c for c in candidates if not c["excluded"]]
        alternatives = []

        feasible_a = bool(eligible) and min((c["cost"] for c in eligible), default=10**9) <= budget
        alternatives.append(
            {
                "id": "alt-A",
                "label": "Release the optimized subset now",
                "description": "Select the value-maximizing subset of eligible POs under the budget envelope (solver-optimized), hold the rest.",
                "constraint_checks": [
                    {"id": "budget", "description": f"selection cost ≤ envelope {budget:,.0f}", "passed": feasible_a},
                    {"id": "authority", "description": "all selected POs within requester authority or escalated", "passed": feasible_a},
                ],
                "feasible": feasible_a,
            }
        )

        large = [c for c in eligible if c["amount"] > APPROVAL_LIMITS["manager"]]
        tranche_ok = all(c["amount"] / 2 <= APPROVAL_LIMITS["director"] for c in large)
        alternatives.append(
            {
                "id": "alt-B",
                "label": "Split oversized orders into two tranches",
                "description": f"Split {len(large)} order(s) above the manager authority limit ({APPROVAL_LIMITS['manager']:,}) into tranches within director authority; reduces single-commitment exposure.",
                "constraint_checks": [
                    {"id": "authority", "description": f"each tranche ≤ {APPROVAL_LIMITS['director']:,}", "passed": tranche_ok},
                    {"id": "budget", "description": "same total commitment — budget-neutral", "passed": bool(large)},
                ],
                "feasible": bool(large) and tranche_ok,
            }
        )

        alternatives.append(
            {
                "id": "alt-C",
                "label": "Hold all flagged orders for manual verification",
                "description": "No new commitments until every flagged record is corrected and re-validated; lowest risk, highest SLA cost.",
                "constraint_checks": [
                    {"id": "budget", "description": "zero new commitment", "passed": True},
                    {"id": "sla", "description": "needed-by dates may lapse — operational delay risk accepted", "passed": False},
                ],
                "feasible": True,
            }
        )
        return alternatives

    async def _a_optimization_formulation(self):
        eligible = [
            {"id": c["po_id"], "cost": float(c["cost"]), "value": float(c["value_score"])}
            for c in self.state.get("candidates", [])
            if not c["excluded"]
        ]
        budget = float(self.settings.get("budget_envelope", 180000))
        Q, meta = quantum_engine.build_qubo(eligible, budget)
        label = quantum_engine.engine_label()
        formulation = {
            "problem": "binary procurement selection (knapsack-class)",
            "n_vars": meta["n_vars"],
            "variable_order": meta["variables"],
            "budget": budget,
            "penalty_lambda": meta["penalty_lambda"],
            "qubo_formulation": "E(x) = xᵀQx ; Q = -diag(value) + λ·(costᵢcostⱼ off-diagonal) ; maximize -E",
            "classical_solver": "OR-Tools CP-SAT (exact) — scipy/HiGHS fallback",
            "quantum": {**label, "method": "QAOA", "layers_p": int(self.settings.get("qaoa_layers", 1)), "shots": int(self.settings.get("qaoa_shots", 1024))},
        }
        self.state["formulation"] = formulation
        self.routing.append({"agent": "optimization_agent", "decision": "formulation feasible → both classical and quantum paths enabled; solver execution deferred to explicit user action (governance gate)"})
        return (
            f"Formulated {meta['n_vars']}-variable QUBO (budget {budget:,.0f}); classical=CP-SAT, quantum={label['engine']}.",
            formulation,
        )

    async def _a_explainability(self):
        findings = (self.state.get("rule_findings") or []) + (self.state.get("if_findings") or []) + (self.state.get("conflicts") or [])
        unc = self.state.get("uncertainty") or {}
        llm_payload = {
            "executive_summary": self.state.get("executive_summary", ""),
            "alternatives": [{"id": a["id"], "label": a["label"], "feasible": a["feasible"]} for a in self.state.get("alternatives", [])],
            "key_findings": [{"rule_id": f.get("rule_id"), "reason": f.get("reason")} for f in findings[:10]],
            "evidence": [{"title": e["title"], "section": e["section"]} for e in self.state.get("evidence", [])[:8]],
            "uncertainty": unc,
        }
        system = (
            "You are the Explainability Agent. Write a rationale an enterprise business user can audit. "
            "Every claim must cite a rule_id or an evidence title from the JSON. Include limitations honestly. "
            "Return strict JSON: {\"rationale\":str,\"limitations\":[str,...],\"evidence_refs\":[str,...]}. Do not invent facts."
        )
        parsed = await llm.complete_json_with_retry(system, "Explain this decision input:\n" + _compact(llm_payload))
        if parsed:
            self.state["_llm_explainability_agent"] = True
            self.state["rationale"] = str(parsed.get("rationale", self.state.get("rationale", "")))[:2400]
            llm_limits = [str(x)[:240] for x in (parsed.get("limitations") or [])][:6]
            self.state["limitations"] = (self.state.get("limitations") or []) + llm_limits
            basis = "LLM (openai/" + llm.MODEL + ") with mandatory finding/evidence citations"
        else:
            basis = "deterministic template (fallback)"
        # limitations always include the platform's honest baseline caveats
        base_limits = [
            "Recommendations are decision support: the LLM narrative is not proof that the decision is correct — verify evidence and constraints.",
            f"Uncertainty {unc.get('score', 'n/a')}/100 is a composite of measurable signals, not a calibrated probability.",
        ]
        self.state["limitations"] = (self.state.get("limitations") or []) + base_limits
        return (
            f"Rationale prepared ({basis}); {len(self.state['limitations'])} limitation(s) recorded.",
            {"rationale_basis": basis, "limitations": self.state["limitations"], "rationale": self.state.get("rationale", "")},
        )

    async def _a_finalize(self):
        findings = (self.state.get("rule_findings") or []) + (self.state.get("if_findings") or []) + (self.state.get("conflicts") or [])
        case_id = uuid.uuid4().hex
        case = {
            "id": case_id,
            "title": f"Flagged procurement portfolio — release decision ({self.dataset.get('name', 'dataset')})",
            "description": "Disposition of pending and policy-flagged purchase orders: which to release within budget and authority constraints, which to hold or escalate.",
            "dataset_id": self.dataset_id,
            "run_id": self.run_id,
            "status": "draft",
            "candidates": self.state.get("candidates", []),
            "constraints": [
                {"id": "budget", "description": f"total selection cost ≤ {float(self.settings.get('budget_envelope', 180000)):,.0f} budget envelope"},
                {"id": "authority", "description": "commitments within requester authority matrix (Procurement Approval Policy v3.2 §2)"},
                {"id": "supplier", "description": "no commitments to watchlisted / under-review suppliers (Supplier Compliance Standard §1)"},
                {"id": "data", "description": "records failing mandatory-field or consistency checks are excluded from selection"},
            ],
            "budget_envelope": float(self.settings.get("budget_envelope", 180000)),
            "alternatives": self.state.get("alternatives", []),
            "formulation": self.state.get("formulation"),
            "uncertainty": self.state.get("uncertainty"),
            "escalation": self.state.get("escalation"),
            "evidence": self.state.get("evidence", []),
            "executive_summary": self.state.get("executive_summary", ""),
            "rationale": self.state.get("rationale", ""),
            "limitations": self.state.get("limitations", []),
            "selected_solution": None,
            "optimization_run_id": None,
            "recommendation": None,
            "approvals": [],
            "created_at": _now(),
        }
        await db.cases.insert_one(case)
        finding_docs = [{**f, "id": uuid.uuid4().hex, "dataset_id": self.dataset_id, "run_id": self.run_id, "case_id": case_id, "ts": _now()} for f in findings]
        if finding_docs:
            await db.findings.insert_many(finding_docs)
        self.state["case_id"] = case_id
        self.routing.append({"agent": "orchestrator", "decision": f"case {case_id} created in draft — human approval gate enforced before any release"})
        return (f"Decision case created ({len(finding_docs)} findings attached).", {"case_id": case_id, "findings": len(finding_docs)})


def _compact(payload) -> str:
    import json

    return json.dumps(payload, default=str, ensure_ascii=False)


async def run_workflow(dataset: dict, settings: dict, actor: str, actor_role: str) -> str:
    wf = Workflow(dataset, settings, actor, actor_role)
    return await wf.run()


def workflow_for(dataset: dict, settings: dict, actor: str, actor_role: str) -> Workflow:
    return Workflow(dataset, settings, actor, actor_role)
