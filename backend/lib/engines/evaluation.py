"""Evaluation harness (research-hypothesis testing — honest, deterministic).

Compares three detection strategies against the KNOWN ground truth of the
synthetic dataset (the seed script records exactly which records were planted):

  proposed   — full multi-agent workflow: rules + IsolationForest + conflicts + evidence retrieval
  single_model — IsolationForest only, no rules, no evidence
  fixed_agents — deterministic agents only (rules + conflicts), no ML, no evidence weighting

Metrics: recall on planted records, false positives, evidence coverage,
uncertainty escalation. Results are measured, never asserted.
"""

import uuid
from datetime import datetime, timezone

from lib.db import db
from lib.engines import anomaly as anomaly_engine
from lib.engines import knowledge as knowledge_engine
from lib.engines import rules as rules_engine


async def run_evaluation(settings: dict) -> dict:
    dataset = await db.datasets.find_one({"source": "sample"}, sort=[("created_at", -1)])
    if not dataset:
        return {"status": "no_dataset", "detail": "Load a dataset first."}

    dataset_id = dataset["id"]
    po_rows = [r["data"] for r in await db.dataset_rows.find({"dataset_id": dataset_id, "source_file": "purchase_orders"}).to_list(5000)]
    suppliers = {r["data"]["supplier_id"]: r["data"] for r in await db.dataset_rows.find({"dataset_id": dataset_id, "source_file": "suppliers"}).to_list(5000)}
    budgets = [r["data"] for r in await db.dataset_rows.find({"dataset_id": dataset_id, "source_file": "budgets"}).to_list(5000)]
    deliveries = [r["data"] for r in await db.dataset_rows.find({"dataset_id": dataset_id, "source_file": "deliveries"}).to_list(5000)]
    docs = [d async for d in db.documents.find({})]
    ground = await db.demo_metadata.find_one({"key": "planted_anomalies"})
    planted = set(ground.get("record_ids", []) if ground else [])

    # strategy: proposed (rules + IF + conflicts)
    rule_findings = rules_engine.run_rules(po_rows, suppliers, budgets)
    scores, _ = anomaly_engine.isolation_forest_scores(po_rows)
    conflicts = anomaly_engine.conflict_findings(dataset_id, po_rows, deliveries)
    proposed_flagged = {rid for f in rule_findings + conflicts for rid in f["record_ids"]}
    proposed_flagged |= {po for po, s in scores.items() if s >= 0.55}

    # strategy: single model (IF only)
    k = max(len(planted), 1)
    single_flagged = {po for po, _ in sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[:k]}

    # strategy: fixed agents (rules + conflicts only, no ML, no evidence)
    fixed_flagged = {rid for f in rule_findings + conflicts for rid in f["record_ids"]}

    evidence_covered = 0
    for f in rule_findings + conflicts:
        items, gap = knowledge_engine.retrieve(f.get("evidence_query") or f.get("title", ""), docs, k=1)
        if not gap:
            evidence_covered += 1

    def metrics(flagged: set) -> dict:
        tp = len(flagged & planted)
        return {
            "flagged": len(flagged),
            "true_positives": tp,
            "recall": round(tp / len(planted), 3) if planted else None,
            "false_positives": len(flagged - planted),
        }

    quality = min((f["quality"]["score"] for f in dataset.get("files", [])), default=100.0)
    from lib.engines.uncertainty import compute_uncertainty

    unc = compute_uncertainty(quality, rule_findings + conflicts + [f for f in [] ], evidence_covered, float(settings.get("uncertainty_threshold", 65)))

    result = {
        "id": uuid.uuid4().hex,
        "created_at": datetime.now(timezone.utc),
        "dataset_id": dataset_id,
        "planted_records": sorted(planted),
        "strategies": {
            "proposed_multi_agent": {**metrics(proposed_flagged), "evidence_coverage": evidence_covered, "uses_ml": True, "uses_rules": True, "uses_evidence": True},
            "single_model_isolation_forest": {**metrics(single_flagged), "evidence_coverage": 0, "uses_ml": True, "uses_rules": False, "uses_evidence": False},
            "fixed_agents_rules_only": {**metrics(fixed_flagged), "evidence_coverage": 0, "uses_ml": False, "uses_rules": True, "uses_evidence": False},
        },
        "uncertainty": unc,
        "notes": [
            "Measured on the synthetic dataset with known planted anomalies — a controlled benchmark, not a production claim.",
            "Adaptive agent selection, uncertainty-aware escalation and evidence-weighted conflict resolution are research hypotheses; these numbers are one data point, not proof of superiority.",
        ],
    }
    await db.eval_results.insert_one(dict(result))  # copy: insert_one injects a non-JSON _id
    return {**result, "status": "ok"}
