"""Trust router — decision records, hashing, verification, ledger anchoring, tamper test."""

import copy
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from lib import llm
from lib.audit import audit
from lib.blockchain import REGISTRY_CONTRACT_SOURCE, LedgerNotConfigured, besu_status, get_adapter
from lib.canonical import canonical_json, hash_record, sha256_hex
from lib.db import clean, db
from lib.deps import get_actor
from lib.errors import ApiError
from models.decision import RecordIn

router = APIRouter(prefix="/trust", tags=["trust"])


async def _record_or_404(record_id: str) -> dict:
    record = clean(await db.decision_records.find_one({"id": record_id}))
    if not record:
        raise ApiError(404, "not_found", "Decision record not found.")
    return record


def _algorithm_versions() -> dict:
    versions = {}
    try:
        import sklearn

        versions["anomaly_model"] = f"sklearn IsolationForest {sklearn.__version__}"
    except Exception:  # noqa: BLE001
        versions["anomaly_model"] = "sklearn IsolationForest"
    versions["rules_engine"] = "zayotm-rules-1.0"
    try:
        import ortools

        versions["classical_solver"] = f"ortools-cpsat {ortools.__version__}"
    except Exception:  # noqa: BLE001
        versions["classical_solver"] = "scipy-highs fallback"
    from lib.engines import quantum as q

    versions["quantum_engine"] = f"{q.engine_label()['engine']} ({q.engine_label()['library']})"
    versions["llm"] = llm.MODEL if llm.llm_available() else "deterministic-fallback"
    versions["hash"] = "SHA-256 (canonical JSON, sorted keys)"
    return versions


@router.post("/records")
async def create_record(body: RecordIn, actor: dict = Depends(get_actor)):
    case = clean(await db.cases.find_one({"id": body.case_id}))
    if not case:
        raise ApiError(404, "not_found", "Decision case not found.")
    if case.get("status") != "approved":
        raise ApiError(409, "not_approved", "Only approved decisions can be recorded. Route the case through the approval gate first.")
    approval = case.get("approvals", [])[-1] if case.get("approvals") else {}

    evidence_refs = [
        {"doc_id": e.get("doc_id"), "title": e.get("title"), "section": e.get("section"), "snippet_sha256": sha256_hex(e.get("snippet", ""))}
        for e in case.get("evidence", [])
    ]
    dataset = clean(await db.datasets.find_one({"id": case.get("dataset_id")})) or {}
    canonical = {
        "record_type": "zayotm.decision_record",
        "record_version": "1.0",
        "decision_id": f"ZYT-{uuid.uuid4().hex[:10].upper()}",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "case": {"id": case["id"], "title": case["title"], "status": case["status"]},
        "dataset": {"id": dataset.get("id"), "name": dataset.get("name"), "quality_score": dataset.get("quality_score")},
        "agent_run_id": case.get("run_id"),
        "data_references": {
            "selected": (case.get("selected_solution") or {}).get("solution_ids", []),
            "held_or_flagged": [c["po_id"] for c in case.get("candidates", []) if c.get("excluded")],
        },
        "evidence_references": evidence_refs,
        "algorithm_versions": _algorithm_versions(),
        "constraints": case.get("constraints", []),
        "recommendation": {
            "summary": (case.get("recommendation") or {}).get("summary", ""),
            "selected_solution": case.get("selected_solution"),
        },
        "alternatives_considered": [{"id": a["id"], "label": a["label"], "feasible": a.get("feasible")} for a in case.get("alternatives", [])],
        "approval": {
            "action": approval.get("action"),
            "actor": approval.get("actor"),
            "actor_role": approval.get("actor_role"),
            "ts": approval.get("ts").isoformat() if isinstance(approval.get("ts"), datetime) else approval.get("ts"),
            "reason": approval.get("reason"),
        },
        "optimization": {
            "selected_solver": (case.get("selected_solution") or {}).get("solver"),
            "budget_envelope": case.get("budget_envelope"),
        },
        "uncertainty": case.get("uncertainty"),
    }
    record_hash, canonical_text = hash_record(canonical)
    record = {
        "id": uuid.uuid4().hex,
        "decision_id": canonical["decision_id"],
        "case_id": case["id"],
        "hash": record_hash,
        "canonical_text": canonical_text,
        "canonical": canonical,
        "algorithm": "SHA-256 over canonical JSON (sorted keys, no whitespace)",
        "anchored": None,
        "tamper_tests": [],
        "last_verification": None,
        "created_at": datetime.now(timezone.utc),
        "created_by": actor["name"],
    }
    await db.decision_records.insert_one(record)
    await audit("record.created", actor["name"], actor["role"], "decision_record", record["id"], f"Decision record {canonical['decision_id']} created for case '{case['title']}' — SHA-256 {record_hash[:16]}…")
    return await _record_or_404(record["id"])


@router.get("/records")
async def list_records():
    out = []
    for r in await db.decision_records.find().sort("created_at", -1).to_list(100):
        r = clean(r)
        if r:
            out.append(r)
    return out


@router.get("/records/{record_id}")
async def get_record(record_id: str):
    return await _record_or_404(record_id)


@router.post("/records/{record_id}/verify")
async def verify_record(record_id: str, actor: dict = Depends(get_actor)):
    record = await _record_or_404(record_id)
    recomputed, _ = hash_record(record["canonical"])
    match = recomputed == record["hash"]

    anchored_verification = None
    if record.get("anchored"):
        adapter, _mode = get_adapter()
        try:
            anchored_verification = await adapter.verify(record["decision_id"], record["hash"])
        except LedgerNotConfigured as exc:
            anchored_verification = {"on_ledger": None, "error": str(exc), "simulated": False}

    result = {
        "record_id": record_id,
        "decision_id": record["decision_id"],
        "stored_hash": record["hash"],
        "recomputed_hash": recomputed,
        "match": match,
        "anchored_verification": anchored_verification,
        "verified_at": datetime.now(timezone.utc),
    }
    await db.decision_records.update_one({"id": record_id}, {"$set": {"last_verification": result}})
    await audit(
        "record.verified" if match else "record.verification_failed",
        actor["name"],
        actor["role"],
        "decision_record",
        record_id,
        f"Integrity verification of {record['decision_id']}: {'PASS — record unchanged' if match else 'FAIL — recomputed hash differs'}.",
        {"match": match},
    )
    return result


@router.post("/records/{record_id}/anchor")
async def anchor_record(record_id: str, actor: dict = Depends(get_actor)):
    record = await _record_or_404(record_id)
    if record.get("anchored"):
        raise ApiError(409, "already_anchored", f"Record {record['decision_id']} is already anchored ({record['anchored'].get('mode')}).")
    adapter, mode = get_adapter()
    try:
        tx = await adapter.anchor(record["decision_id"], record["hash"])
    except LedgerNotConfigured as exc:
        raise ApiError(503, "ledger_unavailable", str(exc)) from exc

    anchored = {**tx, "mode": mode}
    await db.decision_records.update_one({"id": record_id}, {"$set": {"anchored": anchored}})
    await audit(
        "record.anchored",
        actor["name"],
        actor["role"],
        "decision_record",
        record_id,
        (
            f"Anchored {record['decision_id']} → {mode}; tx {tx['tx_hash'][:18]}… block {tx['block_number']}. "
            + ("SIMULATED dev ledger — not a real blockchain transaction." if tx.get("simulated") else "Real permissioned-ledger transaction.")
        ),
        {"simulated": tx.get("simulated", False)},
    )
    return await _record_or_404(record_id)


@router.post("/records/{record_id}/tamper-test")
async def tamper_test(record_id: str, actor: dict = Depends(get_actor)):
    """Safety: operates on an in-memory copy — the stored record is never modified."""
    record = await _record_or_404(record_id)
    tampered = copy.deepcopy(record["canonical"])
    original_summary = tampered.get("recommendation", {}).get("summary", "")
    tampered["recommendation"]["summary"] = (original_summary + " [modified: total released amount altered]") if original_summary else "[modified: payload altered]"

    tampered_hash, _ = hash_record(tampered)
    match = tampered_hash == record["hash"]
    test = {
        "at": datetime.now(timezone.utc),
        "mutated_field": "recommendation.summary",
        "original_hash": record["hash"],
        "tampered_hash": tampered_hash,
        "match": match,
        "detected": not match,
        "note": "Tamper test ran on a copy — the stored record remains intact (hash unchanged).",
    }
    await db.decision_records.update_one({"id": record_id}, {"$push": {"tamper_tests": test}})
    await audit(
        "record.tamper_test",
        actor["name"],
        actor["role"],
        "decision_record",
        record_id,
        f"TAMPER TEST on {record['decision_id']}: one field altered on a copy → recomputed hash {tampered_hash[:16]}… ≠ anchored {record['hash'][:16]}… → tampering {'DETECTED' if not match else 'NOT detected (unexpected)'}",
        {"detected": not match, "simulated": True},
    )
    return test


@router.get("/ledger")
async def ledger_state():
    state = clean(await db.ledger_state.find_one({"key": "dev"})) or {"height": 0}
    txs = [clean(t) for t in await db.ledger_txs.find().sort("block_number", -1).to_list(25)]
    adapter, mode = get_adapter()
    return {
        "mode": mode,
        "adapter": adapter.name,
        "simulated": getattr(adapter, "simulated", True),
        "height": state.get("height", 0),
        "transactions": [t for t in txs if t],
        "besu": besu_status(),
        "note": "Only decision IDs + record hashes are anchored. No business records or PII ever leave the platform database.",
    }


@router.get("/contract-source")
async def contract_source():
    return {
        "source": REGISTRY_CONTRACT_SOURCE,
        "note": "Reference Solidity registry compiled/deployed only when a Besu node is configured. Kept as the adapter's deployment target.",
    }
