"""Compliance Rule Engine (Layer 4-Rule + Layer 3-B deterministic checks).

Explicit, auditable business rules. Each finding cites the policy clause it
enforces so the Knowledge Agent can retrieve the exact evidence passage.
Rule outputs are *confirmed violations* — distinct from statistical anomalies.
"""

import logging

from lib.engines.data_understanding import parse_date

logger = logging.getLogger("zayotm.rules")

# Approval limit matrix (Procurement Approval Policy v3.2 §2)
APPROVAL_LIMITS = {"buyer": 10000, "manager": 50000, "director": 250000}
AMOUNT_MISMATCH_TOLERANCE = 0.02


def run_rules(po_rows: list[dict], suppliers_by_id: dict[str, dict], budgets: list[dict]) -> list[dict]:
    findings: list[dict] = []
    po_counts: dict[str, int] = {}
    for row in po_rows:
        po_counts[row.get("po_id", "")] = po_counts.get(row.get("po_id", ""), 0) + 1

    for row in po_rows:
        po_id = row.get("po_id", "?")
        amount = _num(row.get("total_amount"))

        # R1 — approval authority
        role = (row.get("requester_role") or "").strip().lower()
        limit = APPROVAL_LIMITS.get(role)
        if limit is not None and amount is not None and amount > limit:
            findings.append(
                _finding(
                    "R1-approval-limit",
                    f"PO {po_id} exceeds {role} approval authority",
                    f"PO {po_id} commits {row.get('currency', '')}{amount:,.0f} but the requester's role "
                    f"'{role}' authorizes at most {row.get('currency', '')}{limit:,}. Committed without the required higher authority.",
                    "critical",
                    [po_id],
                    ["total_amount", "requester_role"],
                    "Procurement Approval Policy v3.2 §2 (approval authority matrix)",
                    f"approval authority limit {role} purchase order commitment {po_id}",
                )
            )

        # R2 — watchlisted / non-compliant supplier
        supplier = suppliers_by_id.get(row.get("supplier_id", ""))
        on_watchlist = str((supplier or {}).get("on_watchlist", "")).strip().lower() in ("true", "1", "yes")
        if supplier and (on_watchlist or (supplier.get("compliance_status") or "").strip().lower() != "active"):
            findings.append(
                _finding(
                    "R2-supplier-watchlist",
                    f"PO {po_id} sources from a restricted supplier",
                    f"Supplier {supplier.get('name', row.get('supplier_id'))} is on the compliance watchlist "
                    f"(status: {supplier.get('compliance_status')}) but PO {po_id} is {'already approved' if row.get('status') == 'approved' else 'pending'}.",
                    "critical" if row.get("status") == "approved" else "high",
                    [po_id],
                    ["supplier_id"],
                    "Supplier Compliance Standard §1 (restricted suppliers)",
                    f"supplier compliance watchlist suspension purchase order {po_id}",
                )
            )

        # R3 — arithmetic consistency
        qty, unit = _num(row.get("quantity")), _num(row.get("unit_price"))
        if amount and qty and unit and abs(amount - qty * unit) / amount > AMOUNT_MISMATCH_TOLERANCE:
            findings.append(
                _finding(
                    "R3-amount-mismatch",
                    f"PO {po_id} total does not match quantity x unit price",
                    f"Recorded total {amount:,.0f} vs computed {qty * unit:,.0f} ({qty} x {unit:,.2f}) — "
                    f"deviation exceeds {AMOUNT_MISMATCH_TOLERANCE:.0%}. Likely data-entry error or unauthorized price change.",
                    "high",
                    [po_id],
                    ["total_amount", "quantity", "unit_price"],
                    "Data Quality Standard §5 (arithmetic consistency)",
                    f"data quality amount consistency purchase order total {po_id}",
                )
            )

        # R4 — mandatory fields
        missing = [c for c in ("po_id", "supplier_id", "total_amount", "needed_by", "department") if not (row.get(c) or "").strip()]
        if missing:
            findings.append(
                _finding(
                    "R4-missing-mandatory",
                    f"PO {po_id} is missing mandatory fields",
                    f"Missing mandatory field(s): {', '.join(missing)}. Under policy the record cannot be approved until corrected.",
                    "medium",
                    [po_id],
                    missing,
                    "Data Quality Standard §4 (mandatory fields)",
                    f"mandatory fields data quality approval blocked {po_id}",
                )
            )

        # R5 — budget availability (department + category)
        budget = next(
            (b for b in budgets if b.get("department") == row.get("department") and b.get("category") == row.get("category")),
            None,
        )
        if budget and amount is not None and amount > _num(budget.get("available_amount"), 0.0):
            findings.append(
                _finding(
                    "R5-budget-exceeded",
                    f"PO {po_id} exceeds available budget for {row.get('department')}/{row.get('category')}",
                    f"Commitment {amount:,.0f} exceeds the {row.get('department')}/{row.get('category')} available budget of "
                    f"{_num(budget.get('available_amount'), 0):,.0f} (annual {budget.get('annual_budget')}).",
                    "high",
                    [po_id],
                    ["total_amount", "department", "category"],
                    "Budget Control Policy §1 (availability check)",
                    f"budget availability control commitment {row.get('department')} {row.get('category')}",
                )
            )

    return findings


def _finding(rule_id, title, reason, severity, record_ids, fields, policy_ref, evidence_query) -> dict:
    return {
        "kind": "rule_violation",
        "engine": "business_rule",
        "rule_id": rule_id,
        "title": title,
        "reason": reason,
        "severity": severity,
        "record_ids": record_ids,
        "fields": fields,
        "policy_ref": policy_ref,
        "evidence_query": evidence_query,
    }


def _num(value, default=None):
    try:
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return default
