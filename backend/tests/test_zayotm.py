"""ZaYoTm core-workflow tests — run against the live backend (see conftest.py).

Covers: health/capabilities, actor requirement (negative), sample ingestion +
quality, multi-agent workflow + planted-anomaly detection, optimization
(classical feasibility + genuine quantum execution), recommendation, role-gated
approvals, decision-record hashing, tamper detection, ledger anchoring, and the
evaluation harness.
"""

import time

import httpx
import pytest

from tests.conftest import API_URL

H = {"x-acting-user-id": "u-analyst-1"}
H_APPROVER = {"x-acting-user-id": "u-approver-1"}


def wait_for_run(client, run_id: str, timeout: int = 240) -> dict:
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        res = client.get(f"/workflows/runs/{run_id}")
        if res.status_code == 200:
            last = res.json()
            if str(last.get("status", "")).startswith("completed"):
                return last
        time.sleep(2)
    raise TimeoutError(f"workflow {run_id} did not finish: {last}")


@pytest.fixture(scope="module")
def mclient():
    with httpx.Client(base_url=API_URL, timeout=60.0) as c:
        yield c


@pytest.fixture(scope="module")
def dataset(mclient):
    client = mclient
    res = client.post("/datasets/load-sample", headers=H)
    assert res.status_code == 200, res.text
    return res.json()


@pytest.fixture(scope="module")
def workflow(mclient, dataset):
    client = mclient
    res = client.post("/workflows/run", headers=H, json={"dataset_id": dataset["id"]})
    assert res.status_code == 200, res.text
    return wait_for_run(client, res.json()["run_id"])


@pytest.fixture(scope="module")
def case(mclient, workflow):
    client = mclient
    case_id = workflow.get("case_id")
    assert case_id, f"workflow produced no case: {workflow.get('status')}"
    res = client.get(f"/cases/{case_id}")
    assert res.status_code == 200, res.text
    return res.json()


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    caps = body["capabilities"]
    assert {"llm", "quantum", "ledger", "classical_solver"} <= set(caps)
    assert caps["ledger"]["mode"] == "dev-simulation"


def test_actor_required(client):
    res = client.post("/datasets/load-sample")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "no_actor"


def test_sample_dataset_ingestion(dataset):
    assert dataset["source"] == "sample"
    assert dataset["total_rows"] >= 40
    po = next(f for f in dataset["files"] if f["file"] == "purchase_orders")
    assert po["row_count"] == 24
    assert 0 <= po["quality"]["score"] <= 100
    assert po["quality"]["consistency"] < 1.0  # PO-1042 arithmetic mismatch


def test_workflow_detects_planted_violations(client, dataset, workflow):
    assert workflow["status"] == "completed"
    assert workflow["uncertainty"] and "score" in workflow["uncertainty"]
    res = client.get(f"/datasets/{dataset['id']}/findings")
    assert res.status_code == 200
    findings = res.json()
    rule_ids = {f["rule_id"] for f in findings}
    record_ids = {rid for f in findings for rid in f["record_ids"]}
    for expected in ("R1-approval-limit", "R2-supplier-watchlist", "R4-missing-mandatory", "R5-budget-exceeded", "X2-divergent-duplicate", "X3-late-delivery"):
        assert expected in rule_ids, f"missing {expected} in {rule_ids}"
    for planted in ("PO-1042", "PO-1051", "PO-1057", "PO-1059", "PO-1060", "PO-1063", "PO-1074"):
        assert planted in record_ids, f"planted violation {planted} not detected"
    engines = {f["engine"] for f in findings}
    assert "isolation_forest" in engines or "business_rule" in engines


def test_case_candidates_constraint_aware(case):
    assert case["candidates"], "case has no candidates"
    excluded = [c for c in case["candidates"] if c["excluded"]]
    assert excluded and all(c["exclusion_reason"] for c in excluded)
    assert any(c["po_id"] == "PO-1057" and "R1-approval-limit" in c["rule_hits"] for c in case["candidates"])
    assert case["alternatives"] and len(case["alternatives"]) >= 3


def test_optimization_runs_classical_and_quantum(client, case):
    res = client.post(f"/cases/{case['id']}/optimize", headers=H)
    assert res.status_code == 200, res.text
    run = res.json()
    assert run["classical"]["feasible"] is True
    assert run["classical"]["solver_status"] in ("OPTIMAL", "FEASIBLE")
    assert run["quantum"]["executed"] is True
    assert "qaoa" in run["quantum"]["method"].lower()
    assert "simulator" in run["quantum"]["engine"].lower() or "statevector" in run["quantum"]["engine"].lower()
    assert run["quantum"]["runtime_ms"] > 0 and run["classical"]["runtime_ms"] > 0
    assert run["quantum_validation"]["feasible"] in (True, False)  # measured, never assumed
    assert run["selected"]["solver"] in ("classical", "quantum")


def test_recommendation_and_role_gate(client, case):
    res = client.post(f"/cases/{case['id']}/recommendation", headers=H)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["recommendation"]["summary"]
    assert body["status"] == "in_review"

    # analyst cannot approve — server-side role gate
    denied = client.post(f"/cases/{case['id']}/approve", headers=H, json={"action": "approve", "reason": "analyst attempt"})
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "role_denied"

    # malformed body → 422
    bad = client.post(f"/cases/{case['id']}/approve", headers=H_APPROVER, json={})
    assert bad.status_code == 422

    ok = client.post(f"/cases/{case['id']}/approve", headers=H_APPROVER, json={"action": "approve", "reason": "Portfolio verified against policy; release approved."})
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "approved"
    assert ok.json()["approvals"][-1]["actor_role"] == "approver"


def test_decision_record_hash_verify_anchor_tamper(client, case):
    res = client.post("/trust/records", headers=H, json={"case_id": case["id"]})
    assert res.status_code == 200, res.text
    record = res.json()
    assert len(record["hash"]) == 64
    assert record["canonical"]["approval"]["action"] == "approve"

    ver = client.post(f"/trust/records/{record['id']}/verify", headers=H).json()
    assert ver["match"] is True

    anch = client.post(f"/trust/records/{record['id']}/anchor", headers=H)
    assert anch.status_code == 200, anch.text
    anchored = anch.json()
    assert anchored["anchored"]["simulated"] is True  # dev ledger is always labeled simulated
    assert anchored["anchored"]["tx_hash"].startswith("0x")

    tam = client.post(f"/trust/records/{record['id']}/tamper-test", headers=H).json()
    assert tam["detected"] is True and tam["match"] is False

    # original record still verifies after the tamper test (test ran on a copy)
    ver2 = client.post(f"/trust/records/{record['id']}/verify", headers=H).json()
    assert ver2["match"] is True


def test_evaluation_harness(client):
    res = client.post("/eval/run", headers=H)
    assert res.status_code == 200, res.text
    result = res.json()
    proposed = result["strategies"]["proposed_multi_agent"]
    single = result["strategies"]["single_model_isolation_forest"]
    assert proposed["recall"] >= 0.85, f"proposed recall {proposed['recall']}"
    assert proposed["true_positives"] >= len(result["planted_records"]) - 1
    assert "recall" in single  # baseline measured too


def test_settings_role_gate(client):
    denied = client.put("/settings", headers=H, json={"uncertainty_threshold": 70, "budget_envelope": 180000, "contamination": 0.12, "qaoa_layers": 1, "qaoa_shots": 1024})
    assert denied.status_code == 403
