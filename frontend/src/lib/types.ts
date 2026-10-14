// Hand-written mirrors of the backend's Pydantic models — keep in sync in the same edit
// (see TEMPLATE.md §4: nothing infers across the Python↔TypeScript boundary).

export interface Quality {
  completeness: number;
  validity: number;
  consistency: number;
  duplicates: number;
  score: number;
  issues: string[];
}
export interface ColumnProfile {
  name: string;
  inferred_type: string;
  non_null: number;
  missing: number;
  missing_pct: number;
  distinct: number;
  samples: string[];
}
export interface FileProfile {
  file: string;
  row_count: number;
  columns: ColumnProfile[];
  quality: Quality;
}
export interface Dataset {
  id: string;
  name: string;
  source: string;
  files: FileProfile[];
  total_rows: number;
  quality_score: number;
  created_at?: string;
  created_by?: string;
}
export interface DatasetRow {
  id: string;
  dataset_id: string;
  source_file: string;
  row_number: number;
  data: Record<string, string>;
}

export interface Finding {
  id: string;
  dataset_id: string;
  run_id?: string | null;
  case_id?: string | null;
  kind: string;
  engine: string;
  rule_id?: string | null;
  title: string;
  reason: string;
  severity: string;
  record_ids: string[];
  fields: string[];
  policy_ref?: string | null;
  score?: number | null;
  ts?: string;
}

export interface Uncertainty {
  score: number;
  band: string;
  components: Record<string, number>;
  escalation_required: boolean;
  threshold: number;
  method: string;
}
export interface EvidenceItem {
  doc_id: string;
  title: string;
  section: string;
  snippet: string;
  score: number;
  query: string;
  linked_finding?: string;
  record_ids?: string[];
}
export interface RoutingDecision {
  agent: string;
  decision: string;
}
export interface Escalation {
  triggered: boolean;
  reason: string;
  action: string;
}
export interface AgentTrace {
  agent: string;
  name: string;
  type: string;
  status: string;
  duration_ms: number;
  summary: string;
  output?: unknown;
  llm_used: boolean;
  error?: string | null;
  note?: string | null;
}
export interface AgentRun {
  id: string;
  dataset_id: string;
  dataset_name?: string | null;
  status: string;
  mode: string;
  started_at?: string | null;
  finished_at?: string | null;
  agents: AgentTrace[];
  routing_decisions: RoutingDecision[];
  uncertainty?: Uncertainty | null;
  escalation?: Escalation | null;
  evidence: EvidenceItem[];
  case_id?: string | null;
  llm: { available: boolean; model?: string | null; used_in: string[] };
  errors: string[];
}
export interface RunSummary {
  id: string;
  dataset_name?: string | null;
  status: string;
  started_at?: string | null;
  finished_at?: string | null;
  uncertainty?: Uncertainty | null;
  case_id?: string | null;
  agents_completed: number;
  agents_total: number;
}

export interface DemoUser {
  id: string;
  name: string;
  role: string;
  title: string;
  permissions: { run?: boolean; approve?: boolean; configure?: boolean };
}

export interface Candidate {
  po_id: string;
  supplier_id?: string | null;
  supplier_name?: string | null;
  department: string;
  category: string;
  item: string;
  amount: number;
  cost: number;
  priority: string;
  needed_by?: string | null;
  value_score: number;
  value_model?: string | null;
  excluded: boolean;
  exclusion_reason?: string | null;
  rule_hits: string[];
}
export interface Constraint {
  id: string;
  description: string;
}
export interface ConstraintCheck {
  id: string;
  description: string;
  passed: boolean;
  observed?: string;
}
export interface Alternative {
  id: string;
  label: string;
  description: string;
  constraint_checks: ConstraintCheck[];
  feasible: boolean;
}
export interface Approval {
  id: string;
  action: string;
  actor_id?: string;
  actor: string;
  actor_role: string;
  reason: string;
  from_status: string;
  to_status: string;
  ts: string;
}
export interface SelectedSolution {
  solver: string;
  solution_ids: string[];
  objective: number;
  total_cost: number;
  feasible: boolean;
}
export interface Formulation {
  problem: string;
  n_vars: number;
  variable_order: string[];
  budget: number;
  penalty_lambda: number;
  qubo_formulation: string;
  classical_solver: string;
  quantum: { engine: string; library: string; simulated: boolean; method: string; layers_p: number; shots: number };
}
export interface SolverResult {
  solver?: string;
  solver_status?: string;
  objective: number;
  runtime_ms: number;
  feasible: boolean;
  solution: string[];
  notes?: string[];
  engine?: string;
  library?: string;
  sampling_backend?: string;
  executed?: boolean;
  method?: string;
  depth_p?: number;
  shots?: number;
  params?: { gamma: number[]; beta: number[] };
  min_sampled_energy?: number;
  convergence?: { step: number; expectation: number }[];
  top_states?: [string, number][];
  total_cost?: number;
  variables?: string[];
  n_vars?: number;
  penalty_lambda?: number;
  budget?: number;
}
export interface Validation {
  feasible: boolean;
  total_cost: number;
  budget: number;
  within_budget: boolean;
  selected_count: number;
  checks: { id: string; description: string; passed: boolean; observed: string }[];
}
export interface Recommendation {
  id: string;
  case_id: string;
  summary: string;
  executive_summary: string;
  rationale: string;
  evidence: EvidenceItem[];
  constraints: Constraint[];
  uncertainty?: Uncertainty | null;
  limitations: string[];
  alternatives_considered: { id: string; label: string; feasible: boolean }[];
  optimization_run_id: string;
  created_by: string;
  created_by_role: string;
  created_at: string;
  note: string;
}
export interface Case {
  id: string;
  title: string;
  description: string;
  dataset_id: string;
  run_id?: string | null;
  status: string;
  candidates: Candidate[];
  constraints: Constraint[];
  budget_envelope: number;
  alternatives: Alternative[];
  formulation?: Formulation | null;
  uncertainty?: Uncertainty | null;
  escalation?: Escalation | null;
  evidence: EvidenceItem[];
  executive_summary: string;
  rationale: string;
  limitations: string[];
  selected_solution?: SelectedSolution | null;
  optimization_run_id?: string | null;
  recommendation?: Recommendation | null;
  approvals: Approval[];
  created_at?: string;
  latest_optimization?: OptimizationRun | null;
}
export interface CaseSummary {
  id: string;
  title: string;
  status: string;
  uncertainty?: Uncertainty | null;
  created_at?: string;
  has_recommendation: boolean;
  optimization_run_id?: string | null;
}

export interface OptimizationRun {
  id: string;
  case_id: string;
  created_at: string;
  formulation: Formulation | Record<string, unknown>;
  classical: SolverResult;
  classical_validation: Validation;
  quantum: SolverResult;
  quantum_validation: Validation;
  selected: { solver: string; solution: string[]; objective: number; feasible: boolean; policy: string };
  candidate_pool: string[];
  budget: number;
}

export interface TamperTest {
  at: string;
  mutated_field: string;
  original_hash: string;
  tampered_hash: string;
  match: boolean;
  detected: boolean;
  note: string;
}
export interface VerifyResult {
  record_id: string;
  decision_id: string;
  stored_hash: string;
  recomputed_hash: string;
  match: boolean;
  anchored_verification?: {
    on_ledger: boolean | null;
    simulated?: boolean;
    network?: string;
    tx_hash?: string | null;
    block_number?: number | null;
    error?: string;
  } | null;
  verified_at: string;
}
export interface AnchoredTx {
  tx_hash: string;
  block_number: number;
  network: string;
  simulated: boolean;
  decision_id: string;
  record_hash: string;
  contract_address: string;
  gas_used: string;
  confirmations: number;
  anchored_at: string;
  event: string;
  mode: string;
}
export interface DecisionRecord {
  id: string;
  decision_id: string;
  case_id: string;
  hash: string;
  canonical_text: string;
  canonical: Record<string, unknown>;
  algorithm: string;
  anchored?: AnchoredTx | null;
  tamper_tests: TamperTest[];
  last_verification?: VerifyResult | null;
  created_at?: string;
  created_by?: string;
}
export interface LedgerTx {
  tx_hash: string;
  block_number: number;
  network: string;
  simulated: boolean;
  decision_id: string;
  record_hash: string;
  anchored_at: string;
}
export interface BesuStatus {
  adapter: string;
  configured: boolean;
  rpc_url?: string | null;
  chain_id?: string | null;
  contract_address?: string | null;
  note: string;
}
export interface LedgerState {
  mode: string;
  adapter: string;
  simulated: boolean;
  height: number;
  transactions: LedgerTx[];
  besu: BesuStatus;
  note: string;
}

export interface Capabilities {
  llm: { available: boolean; detail: string };
  quantum: { engine: string; library: string; simulated: boolean; note: string };
  ledger: { mode: string; simulated: boolean; besu: BesuStatus };
  classical_solver?: string | null;
  versions: Record<string, string | null>;
}
export interface Health {
  status: string;
  version: string;
  time: string;
  capabilities: Capabilities;
}
export interface Dashboard {
  datasets: number;
  latest_quality_score?: number | null;
  open_findings: number;
  findings_by_severity: Record<string, number>;
  cases_by_status: Record<string, number>;
  pending_decisions: number;
  records: number;
  verified_ok: number;
  anchored_real: number;
  anchored_simulated: number;
  audit_events: number;
  recent_decisions: { id: string; title: string; status: string; uncertainty?: number | null; created_at?: string }[];
  demo_state: Record<string, boolean>;
  capabilities: Capabilities;
  latest_run_id?: string | null;
  latest_case_id?: string | null;
}

export interface SettingsModel {
  key: string;
  uncertainty_threshold: number;
  budget_envelope: number;
  contamination: number;
  qaoa_layers: number;
  qaoa_shots: number;
  objective_weights: Record<string, number>;
  updated_at?: string | null;
}

export interface StrategyMetrics {
  flagged: number;
  true_positives: number;
  recall?: number | null;
  false_positives: number;
  evidence_coverage: number;
  uses_ml: boolean;
  uses_rules: boolean;
  uses_evidence: boolean;
}
export interface EvalResult {
  id: string;
  created_at: string;
  dataset_id: string;
  planted_records: string[];
  strategies: Record<string, StrategyMetrics>;
  uncertainty?: Uncertainty | null;
  notes: string[];
  status?: string;
}

export interface AuditEvent {
  id: string;
  ts: string;
  actor: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  summary: string;
  metadata: Record<string, unknown>;
}
