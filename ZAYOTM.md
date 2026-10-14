# ZaYoTm™ — Universal Enterprise Intelligence & Trust Platform (prototype)

Investor-demonstration prototype. Runs end-to-end on synthetic procurement data. **Not production-ready,
not enterprise-certified, no quantum-advantage claim.** Implemented / simulated / planned is labeled in the UI.

## Architecture (7 layers)
| Layer | Where |
|---|---|
| 1 Enterprise users | 8 screens: Overview (12-step demo), Data Workspace, AI Intelligence, Decision Studio, Quantum Lab, Trust & Blockchain, Audit Trail, Settings |
| 2 API gateway | FastAPI `/api` (OpenAPI at `/api/docs`), Pydantic validation, structured errors (`lib/errors.py`), per-IP rate limit (`lib/ratelimit.py`), server-side RBAC (`lib/deps.py`) |
| 3 AI intelligence | `lib/engines/`: data_understanding, knowledge (RAG), anomaly, uncertainty, evaluation |
| 4 Decision intelligence | rules, classical (OR-Tools CP-SAT), quantum (QAOA/Qiskit Aer), recommendation + constraint validation (`routers/cases.py`) |
| 5 Trust | canonical SHA-256 (`lib/canonical.py`), ledger adapters + Solidity registry (`lib/blockchain.py`), audit (`lib/audit.py`) |
| 6 Orchestration | stateful workflow engine with conditional routing, retry-once, escalation gates (`lib/engines/orchestrator.py`) |
| 7 Integrations | CSV upload + bundled synthetic SAP/ERP-like CSVs (`backend/sample_data`); live connectors = interfaces only |

## Algorithms and why
- **pandas schema/type inference + quality score** (0.4 completeness, 0.3 validity, 0.3 arithmetic consistency): transparent, lineage-preserving.
- **IsolationForest** (sklearn, contamination 0.12, seed 42): unsupervised multivariate tabular anomalies without labels. Output is a *suspicion*.
- **Deterministic rules R1–R5 + cross-record checks X1–X3**: confirmed business violations, each citing a policy clause. Kept separate from statistical anomalies.
- **TF-IDF retrieval** over policy passages: enough for a small corpus with no embedding service. Records an evidence gap rather than inventing anything.
- **Uncertainty**: composite of data-quality risk, evidence gap, conflict density and missing rate, compared against a configurable escalation threshold. It is never the LLM's self-reported confidence.
- **LLM (gpt-5.4 via Emergent key)**: used only by the Reasoning and Explainability agents, with JSON output, a retry, and a deterministic fallback.
- **OR-Tools CP-SAT**: exact and deterministic (one worker) baseline for the binary selection (knapsack) problem.
- **QAOA**: the QUBO is E(x)=xᵀQx with the budget handled as a quadratic penalty λ(Σcx−B)². The p-layer ansatz is tuned with COBYLA on exact statevector expectations, then the circuit is sampled on **Qiskit Aer** (2.5.2 / Aer 0.17.2). The result is validated against constraints and compared using measured numbers.
- Predictive models: no labeled outcome data ships with the sample set, so no forecasts are produced, by design.

## Blockchain status
`DevSimulationLedger` is active. It produces EVM-shaped transactions, and every one carries `simulated: true`.
`BesuLedgerAdapter` activates when BESU_RPC_URL, BESU_CHAIN_ID, LEDGER_CONTRACT_ADDRESS and LEDGER_SIGNER_KEY are all set. In this build the web3 runtime is not bundled, so the adapter refuses to fake a transaction rather than send one.
Only the decision ID and record hash are anchored. Blockchain shows that a record has not been tampered with; it does not show that the decision was correct.

## Setup
```
cd backend && pip install -r requirements.txt && cp .env.example .env && python seed.py
uvicorn server:app --port 8001 --reload        # backend
cd frontend && yarn && yarn dev                 # http://localhost:3000 (proxies /api)
cd backend && pytest tests/test_zayotm.py -n 0  # tests hit the live backend
```
Docker/Compose and PostgreSQL migrations are **not included**: this build environment provides MongoDB under supervisor.

## Investor demo (repeatable)
Open Executive Overview and click **Run full demo**. You can also run each step individually:
1 load data, 2 profile, 3 run the agents, 4 detected inconsistencies (7/7 planted), 5 evidence and uncertainty, 6 constraint-checked alternatives,
7 classical vs QAOA, 8 recommendation, 9 approval as the Approver, 10 SHA-256 record and verify, 11 simulated anchor, 12 tamper test (FAIL is detected).
Then open the Audit Trail. To show the role gate, switch to the Analyst identity in Decision Studio: the Approve button is disabled and the API returns 403.

## Limitations / remaining work
Real Besu deployment and web3, ZKP (interface only), live connectors, SSO, Postgres + migrations, Docker,
calibrated uncertainty on held-out data, an in-memory rate limiter (single pod), and a supervised anomaly model (needs labels).
