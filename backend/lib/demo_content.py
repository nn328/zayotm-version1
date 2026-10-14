"""Demo content: users, policy corpus, ground-truth metadata, settings. Idempotent upserts."""

import uuid
from datetime import datetime, timezone

from lib.db import db, clean

USERS = [
    {"id": "u-exec-1", "name": "Amara Osei", "role": "executive", "title": "Chief Executive Officer"},
    {"id": "u-approver-1", "name": "Ingrid Solberg", "role": "approver", "title": "Chief Compliance Approver"},
    {"id": "u-analyst-1", "name": "Daniel Reyes", "role": "analyst", "title": "Senior Risk Analyst"},
]

POLICY_DOCS = [
    {
        "id": "pol-approval-32",
        "title": "Procurement Approval Policy v3.2",
        "body": """Procurement Approval Policy v3.2 — authority matrix and controls.

§2 Approval authority matrix
Purchase orders must be committed by a requester whose cumulative authority covers the full order value. Buyer authority: up to 10,000 EUR. Manager authority: up to 50,000 EUR. Director authority: up to 250,000 EUR. Any commitment above the requester's authority requires documented approval from the next authority level BEFORE release. Splitting an order into tranches to stay under an authority limit is prohibited unless each tranche is independently justified and approved.

§3 Dual approval
Any single order above 100,000 EUR requires dual approval: the requesting director and the Chief Compliance Approver, regardless of tranche structure.

§7 Audit duty
Every approval, rejection, or revision request must record the acting user, their role, a reason, and a timestamp. Silent overrides are prohibited.""",
    },
    {
        "id": "pol-supplier-compliance",
        "title": "Supplier Compliance Standard",
        "body": """Supplier Compliance Standard — restricted and watchlisted suppliers.

§1 Restricted suppliers
Suppliers under compliance review, or flagged on the watchlist, must be suspended from receiving new purchase orders. Existing approved orders with such suppliers must be escalated to the Chief Compliance Officer within 2 business days. New orders referencing a watchlisted supplier are invalid and must not be released.

§2 Delivery reliability
Suppliers delivering later than the contractual needed-by date by more than 14 days enter mandatory performance review. Repeated breaches move the supplier to the watchlist automatically.

§4 Evidence retention
Compliance decisions must reference the specific clause and supplier record relied upon.""",
    },
    {
        "id": "pol-data-quality",
        "title": "Data Quality Standard",
        "body": """Data Quality Standard — record integrity requirements for procurement data.

§4 Mandatory fields
A purchase order record missing any mandatory field (po_id, supplier_id, total_amount, needed_by, department) is incomplete. Incomplete records cannot be approved; they must be corrected at source and re-validated.

§5 Consistency and single source of truth
The recorded total_amount must equal quantity x unit_price within 2%. Each purchase order must exist exactly once in the purchase-order system of record; duplicated identifiers with divergent values constitute a data incident requiring investigation before any financial commitment. Anomalies detected by statistical models are suspicions, not violations: only confirmed rule breaches may block a commitment.""",
    },
    {
        "id": "pol-budget-control",
        "title": "Budget Control Policy",
        "body": """Budget Control Policy — commitment limits by department and category.

§1 Availability check
A commitment may only be released when the department/category budget line has sufficient available budget (annual budget minus committed amount). Releasing a commitment that exceeds available budget requires a documented budget reallocation approved by Finance.

§3 Release envelope
Bulk release of multiple purchase orders must fit within the configured release envelope for the planning period. Portfolio-level selection should maximize business value subject to the envelope.""",
    },
]

PLANTED = {
    "key": "planted_anomalies",
    "record_ids": ["PO-1042", "PO-1051", "PO-1057", "PO-1059", "PO-1060", "PO-1063", "PO-1074"],
    "description": (
        "Ground truth for the evaluation harness: PO-1042 price/total mismatch, PO-1051 duplicate with divergent totals, "
        "PO-1057 approval-limit breach, PO-1059 watchlisted supplier, PO-1060 missing mandatory fields, "
        "PO-1063 late delivery conflict, PO-1074 budget-exceeded."
    ),
}

DEFAULT_SETTINGS = {
    "key": "global",
    "uncertainty_threshold": 65,
    "budget_envelope": 180000,
    "contamination": 0.12,
    "qaoa_layers": 1,
    "qaoa_shots": 1024,
    "objective_weights": {"priority": 0.4, "reliability": 0.3, "urgency": 0.3},
    "updated_at": None,
}


async def ensure_demo_content() -> None:
    """Idempotent: seeds users, policy documents, ground truth, and settings if absent."""
    for user in USERS:
        await db.users.update_one({"id": user["id"]}, {"$set": {**user, "updated_at": datetime.now(timezone.utc)}}, upsert=True)
    for doc in POLICY_DOCS:
        await db.documents.update_one({"id": doc["id"]}, {"$set": doc}, upsert=True)
    await db.demo_metadata.update_one({"key": PLANTED["key"]}, {"$set": PLANTED}, upsert=True)
    if not await db.settings.find_one({"key": "global"}):
        await db.settings.insert_one({**DEFAULT_SETTINGS})


async def get_settings() -> dict:
    settings = clean(await db.settings.find_one({"key": "global"}))
    return settings or dict(DEFAULT_SETTINGS)
