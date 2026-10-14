# ZaYoTm™ — living spec (prototype v0.9)

Universal Enterprise Intelligence & Trust Platform. VC-demo prototype on synthetic procurement data.
Stack: FastAPI + MongoDB (motor) backend under /api; Vite + React 19 + TS + Tailwind v4 + shadcn frontend.

## Identity / roles (demo, no passwords)
Frontend sends `X-Acting-User-Id` header; backend enforces roles server-side (lib/deps.py).
- u-exec-1 Amara Osei — executive: run, approve, configure (default identity)
- u-approver-1 Ingrid Solberg — approver: run, approve
- u-analyst-1 Daniel Reyes — analyst: run only (approve → 403 role_denied; settings → 403)
Missing header on mutating routes → 401 no_actor.

## Seed / sample data (backend/sample_data/*.csv, seeded via `python seed.py` or POST /api/datasets/load-sample)
purchase_orders (24 rows), suppliers (10), budgets (6), deliveries (6). Policy corpus: 4 docs (lib/demo_content.py).
Planted ground truth (7): PO-1042 total≠qty×price (R3), PO-1051 duplicate w/ divergent totals (X2), PO-1057 approval-limit breach (R1),
PO-1059 watchlisted supplier SUP-007 (R2), PO-1060 missing mandatory fields (R4), PO-1063 late delivery (X3), PO-1074 budget exceeded (R5).

## Flow (12-step demo on Executive Overview, "Run full demo")
load sample → profile → POST /workflows/run (async, poll /workflows/runs/{id}) → findings → evidence + uncertainty → case
→ POST /cases/{id}/optimize (OR-Tools CP-SAT exact + QAOA on Qiskit Aer simulator, same QUBO) → POST /cases/{id}/recommendation
→ POST /cases/{id}/approve {action: approve|reject|revise, reason} (approver/executive only; final statuses immutable, 409)
→ POST /trust/records {case_id} (approved only) → /verify → /anchor (dev-simulation ledger, simulated=true always; 409 if already anchored)
→ /tamper-test (mutates a COPY; detected=true; stored record still verifies) → GET /audit.
Other: GET /health, /dashboard, /settings (PUT executive-only), POST /eval/run + GET /eval/latest, /trust/ledger, /trust/contract-source.

## Agents (lib/engines/orchestrator.py)
Data, Document, Anomaly (IsolationForest + cross-record conflicts), Compliance (rules R1–R5), Knowledge (TF-IDF RAG, no invented evidence),
Reasoning (LLM gpt-5.4 + deterministic fallback), Optimization (QUBO formulation), Explainability (LLM + fallback), Trust (records), Orchestrator
(routing, uncertainty escalation at threshold, retry-once). LLM run takes ~20–30s.

## Collections
users, datasets, dataset_rows, findings, documents, agent_runs, cases, optimization_runs, recommendations, decision_records,
ledger_state, ledger_txs, audit_events, settings, demo_metadata, eval_results.

## Honest scope
Simulated: ledger (Besu adapter config via BESU_RPC_URL/BESU_CHAIN_ID/LEDGER_CONTRACT_ADDRESS/LEDGER_SIGNER_KEY, unconfigured), quantum = Aer simulator.
Planned: real Besu deploy, ZKP (interface only), live ERP/CRM connectors, SSO, calibrated uncertainty. Mongo used instead of PostgreSQL (pod has Mongo).
