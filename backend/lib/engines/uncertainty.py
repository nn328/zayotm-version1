"""Uncertainty estimation (Layer 3 + research hypothesis: uncertainty-aware escalation).

A transparent composite over measurable signals — deliberately NOT an LLM
self-report, which this platform refuses to use as an uncertainty measure:

  uncertainty = 100 * (0.35*data_quality_risk + 0.25*evidence_gap
                       + 0.20*conflict_density + 0.20*missing_rate)

When the composite crosses the configured threshold the orchestrator escalates
to mandatory human review and marks the recommendation accordingly.
"""

WEIGHTS = {"data_quality_risk": 0.35, "evidence_gap": 0.25, "conflict_density": 0.20, "missing_rate": 0.20}


def compute_uncertainty(
    quality_score: float,
    findings: list[dict],
    evidence_count: int,
    threshold: float,
) -> dict:
    quality_risk = (100.0 - quality_score) / 100.0

    n_evidenceable = len([f for f in findings if f.get("policy_ref")])
    evidence_gap = 0.0 if n_evidenceable == 0 else 1.0 - (min(evidence_count, n_evidenceable * 2) / (n_evidenceable * 2))

    conflictish = [f for f in findings if f.get("kind") in ("rule_violation", "conflict", "duplicate")]
    conflict_density = min(1.0, len(conflictish) / 8.0)

    missing_findings = [f for f in findings if f.get("rule_id") == "R4-missing-mandatory"]
    missing_rate = min(1.0, len(missing_findings) / 5.0)

    score = round(
        100
        * (
            WEIGHTS["data_quality_risk"] * quality_risk
            + WEIGHTS["evidence_gap"] * evidence_gap
            + WEIGHTS["conflict_density"] * conflict_density
            + WEIGHTS["missing_rate"] * missing_rate
        ),
        1,
    )
    band = "low" if score < 35 else ("medium" if score < threshold else "high")
    return {
        "score": score,
        "band": band,
        "components": {
            "data_quality_risk": round(quality_risk, 3),
            "evidence_gap": round(evidence_gap, 3),
            "conflict_density": round(conflict_density, 3),
            "missing_rate": round(missing_rate, 3),
        },
        "escalation_required": score >= threshold,
        "threshold": threshold,
        "method": (
            "composite of measurable signals: data-quality risk (0.35), evidence gap (0.25), "
            "conflict density (0.20), missing-value rate (0.20). Not an LLM self-report."
        ),
    }
