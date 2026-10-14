"""Anomaly Detection Engine (Layer 3-B).

Two distinct detectors whose outputs are never conflated:
  1. IsolationForest (scikit-learn) — unsupervised multivariate statistical
     anomalies over numeric PO features. Output is a *suspicion score*, not a verdict.
  2. Cross-record conflict checks — deterministic comparisons across files
     (duplicate PO ids with divergent amounts; deliveries late vs contractual date).
Confirmed business violations live in the rule engine (engines/rules.py).
"""

import logging

import numpy as np

from lib.engines.data_understanding import numeric_view, parse_date

logger = logging.getLogger("zayotm.anomaly")

try:
    from sklearn.ensemble import IsolationForest

    _SKLEARN = True
except Exception:  # noqa: BLE001
    _SKLEARN = False

IF_FEATURES = ["quantity", "unit_price", "total_amount"]


def isolation_forest_scores(po_rows: list[dict], contamination: float = 0.12) -> tuple[dict[str, float], dict | None]:
    """Per-record anomaly score in [0,1] (higher = more anomalous) + engine metadata."""
    meta = {"algorithm": "isolation_forest", "available": _SKLEARN, "features": IF_FEATURES, "n_rows": len(po_rows)}
    if not _SKLEARN or len(po_rows) < 8:
        meta["note"] = "IsolationForest unavailable or too few rows — statistical detection skipped" if not _SKLEARN else "too few rows"
        return {}, meta

    df = numeric_view(po_rows, IF_FEATURES)
    df = df.dropna()
    if df.empty:
        meta["note"] = "no parseable numeric rows"
        return {}, meta

    model = IsolationForest(contamination=contamination, random_state=42)
    raw = -model.fit(df[IF_FEATURES].values).decision_function(X=df[IF_FEATURES].values)  # higher = more anomalous
    span = raw.max() - raw.min()
    normalized = (raw - raw.min()) / span if span > 0 else np.zeros_like(raw)

    scores = {str(po_rows[idx]["po_id"]): round(float(score), 3) for idx, score in zip(df.index, normalized)}
    meta.update({"contamination": contamination, "random_state": 42, "scored_rows": int(len(df))})
    return scores, meta


def conflict_findings(dataset_id: str, po_rows: list[dict], delivery_rows: list[dict]) -> list[dict]:
    """Deterministic cross-record conflicts (kind='conflict')."""
    findings = []
    by_po: dict[str, list[dict]] = {}
    for row in po_rows:
        by_po.setdefault(row.get("po_id", ""), []).append(row)

    # duplicate PO ids with divergent committed values
    for po_id, rows in by_po.items():
        if len(rows) > 1:
            amounts = {r.get("total_amount", "") for r in rows}
            kind = "conflict" if len(amounts) > 1 else "duplicate"
            findings.append(
                {
                    "kind": kind,
                    "engine": "cross_record_conflict",
                    "rule_id": "X1-duplicate-po" if kind == "duplicate" else "X2-divergent-duplicate",
                    "title": f"Purchase order {po_id} appears {len(rows)} times",
                    "reason": (
                        f"PO {po_id} is recorded {len(rows)} times with divergent totals "
                        f"({', '.join(sorted(amounts))}) — conflicting system of record."
                        if len(amounts) > 1
                        else f"PO {po_id} is recorded {len(rows)} times with identical values (duplicate entry)."
                    ),
                    "severity": "high",
                    "record_ids": [po_id],
                    "fields": ["total_amount"],
                    "policy_ref": "Data Quality Standard §5 (single source of truth)",
                    "evidence_query": f"data quality duplicate purchase order single source of truth {po_id}",
                }
            )

    # deliveries late vs contractual needed_by
    po_by_id = {r.get("po_id", ""): r for r in po_rows}
    for d in delivery_rows:
        po = po_by_id.get(d.get("po_id", ""))
        if not po:
            continue
        needed = parse_date(po.get("needed_by", ""))
        actual = parse_date(d.get("actual_date", ""))
        promised = parse_date(d.get("promised_date", ""))
        if needed and actual and actual > needed:
            days_late = (actual - needed).days
            findings.append(
                {
                    "kind": "conflict",
                    "engine": "cross_record_conflict",
                    "rule_id": "X3-late-delivery",
                    "title": f"Delivery for PO {d['po_id']} breached the needed-by date",
                    "reason": (
                        f"Delivery record shows actual arrival {d.get('actual_date')} — {days_late} days after the "
                        f"contractual needed-by date {po.get('needed_by')} (promised {d.get('promised_date')})."
                    ),
                    "severity": "high" if days_late > 14 else "medium",
                    "record_ids": [d["po_id"]],
                    "fields": ["actual_date", "needed_by"],
                    "policy_ref": "Supplier Performance Standard §2 (delivery reliability)",
                    "evidence_query": f"supplier delivery performance late penalty {d['po_id']}",
                }
            )
    return findings
