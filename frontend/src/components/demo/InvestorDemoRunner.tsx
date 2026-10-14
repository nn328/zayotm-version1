import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, CircleAlert, Loader2, Play, RotateCcw } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import type { AgentRun, Case, DecisionRecord, Dataset, Finding, OptimizationRun, TamperTest, VerifyResult } from "@/lib/types";
import { cn } from "@/lib/utils";

interface DemoCtx {
  datasetId?: string;
  runId?: string;
  caseId?: string;
  recordId?: string;
}
type StepStatus = "idle" | "running" | "done" | "failed";
interface StepState {
  status: StepStatus;
  result?: string;
}
type StepFn = (c: DemoCtx) => Promise<{ result: string; patch?: DemoCtx }>;

const PLANTED = ["PO-1042", "PO-1051", "PO-1057", "PO-1059", "PO-1060", "PO-1063", "PO-1074"];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function need<T>(v: T | undefined, msg: string): T {
  if (v === undefined || v === null || v === "") throw new Error(msg);
  return v;
}

async function pollRun(runId: string): Promise<AgentRun> {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const run = await apiGet<AgentRun>(`/workflows/runs/${runId}`);
    if (run.status.startsWith("completed")) return run;
    await wait(2500);
  }
  throw new Error("workflow did not finish within 4 minutes");
}

const STEPS: { label: string; testid: string; fn: StepFn }[] = [
  {
    label: "Load the synthetic procurement dataset (POs, suppliers, budgets, deliveries)",
    testid: "demo-step-load-data",
    fn: async () => {
      const ds = await apiPost<Dataset>("/datasets/load-sample");
      return { result: `"${ds.name}" ingested — ${ds.total_rows} rows across ${ds.files.length} files.`, patch: { datasetId: ds.id } };
    },
  },
  {
    label: "Validate & profile data (schema inference, missing values, quality score)",
    testid: "demo-step-profile",
    fn: async (c) => {
      const ds = await apiGet<Dataset>(`/datasets/${need(c.datasetId, "run step 1 first")}`);
      const issues = ds.files.flatMap((f) => f.quality.issues.map((i) => `${f.file}: ${i}`));
      return { result: `Lowest file quality ${ds.quality_score}/100. ${issues.slice(0, 3).join("; ") || "No issues."}` };
    },
  },
  {
    label: "Run the multi-agent intelligence workflow (10 agents, conditional routing)",
    testid: "demo-step-run-agents",
    fn: async (c) => {
      const start = await apiPost<{ run_id: string }>("/workflows/run", { dataset_id: need(c.datasetId, "run step 1 first") });
      const run = await pollRun(start.run_id);
      const ok = run.agents.filter((a) => a.status === "completed").length;
      return {
        result: `${ok}/${run.agents.length} agent steps completed · LLM used by: ${run.llm.used_in.join(", ") || "none (deterministic fallback)"}.`,
        patch: { runId: run.id, caseId: run.case_id ?? undefined },
      };
    },
  },
  {
    label: "Find the known inconsistencies (rules, IsolationForest, cross-record conflicts)",
    testid: "demo-step-findings",
    fn: async (c) => {
      const findings = await apiGet<Finding[]>(`/datasets/${need(c.datasetId, "run step 1 first")}/findings`);
      const scoped = c.runId ? findings.filter((f) => f.run_id === c.runId) : findings;
      const found = new Set(scoped.flatMap((f) => f.record_ids));
      const missed = PLANTED.filter((p) => !found.has(p));
      return { result: `${scoped.length} findings · planted violations detected ${PLANTED.length - missed.length}/${PLANTED.length}${missed.length ? ` (missed ${missed.join(", ")})` : ""}.` };
    },
  },
  {
    label: "Retrieve policy evidence (RAG) and compute uncertainty",
    testid: "demo-step-evidence",
    fn: async (c) => {
      const run = await apiGet<AgentRun>(`/workflows/runs/${need(c.runId, "run step 3 first")}`);
      return {
        result: `${run.evidence.length} cited policy passages · uncertainty ${run.uncertainty?.score ?? "—"}/100 (${run.uncertainty?.band ?? "—"}) · escalation ${run.uncertainty?.escalation_required ? "required" : "not required"}.`,
      };
    },
  },
  {
    label: "Inspect agent outputs & constraint-checked decision alternatives",
    testid: "demo-step-case",
    fn: async (c) => {
      const k = await apiGet<Case>(`/cases/${need(c.caseId, "run step 3 first")}`);
      const excl = k.candidates.filter((x) => x.excluded).length;
      return { result: `${k.candidates.length} candidates (${excl} excluded by constraints) · ${k.alternatives.filter((a) => a.feasible).length}/${k.alternatives.length} alternatives feasible.` };
    },
  },
  {
    label: "Compare classical (OR-Tools CP-SAT) vs quantum (QAOA on Qiskit Aer)",
    testid: "demo-step-optimize",
    fn: async (c) => {
      const r = await apiPost<OptimizationRun>(`/cases/${need(c.caseId, "run step 3 first")}/optimize`);
      const ratio = r.classical.objective > 0 && r.quantum.feasible ? (r.quantum.objective / r.classical.objective).toFixed(2) : "n/a";
      return {
        result: `Classical ${r.classical.objective.toFixed(3)} in ${r.classical.runtime_ms.toFixed(0)}ms · QAOA ${r.quantum.objective.toFixed(3)} in ${r.quantum.runtime_ms.toFixed(0)}ms (feasible ${String(r.quantum.feasible)}) · ratio ${ratio} · selected ${r.selected.solver}.`,
      };
    },
  },
  {
    label: "Generate the reasoned recommendation (evidence, uncertainty, limitations)",
    testid: "demo-step-recommend",
    fn: async (c) => {
      const k = await apiPost<Case>(`/cases/${need(c.caseId, "run step 3 first")}/recommendation`);
      return { result: (k.recommendation?.summary ?? "").slice(0, 180) };
    },
  },
  {
    label: "Record human approval (as Chief Compliance Approver — role-gated server-side)",
    testid: "demo-step-approve",
    fn: async (c) => {
      const id = need(c.caseId, "run step 3 first");
      try {
        const k = await apiPost<Case>(`/cases/${id}/approve`, { action: "approve", reason: "Investor demo: selection verified against policy and budget." }, "u-approver-1");
        const a = k.approvals.at(-1);
        return { result: `Status ${k.status} — by ${a?.actor} (${a?.actor_role}) with recorded reason.` };
      } catch (e) {
        if (e instanceof ApiError && e.code === "already_final") return { result: "Case already final — approval is immutable." };
        throw e;
      }
    },
  },
  {
    label: "Create the cryptographic decision record (SHA-256 over canonical JSON)",
    testid: "demo-step-record",
    fn: async (c) => {
      const r = await apiPost<DecisionRecord>("/trust/records", { case_id: need(c.caseId, "run step 3 first") });
      const v = await apiPost<VerifyResult>(`/trust/records/${r.id}/verify`);
      return { result: `${r.decision_id} · SHA-256 ${r.hash.slice(0, 20)}… · verification ${v.match ? "PASS" : "FAIL"}.`, patch: { recordId: r.id } };
    },
  },
  {
    label: "Anchor the hash to the ledger (dev simulation — clearly labeled, not a real chain)",
    testid: "demo-step-anchor",
    fn: async (c) => {
      const r = await apiPost<DecisionRecord>(`/trust/records/${need(c.recordId, "run step 10 first")}/anchor`);
      return { result: `tx ${r.anchored?.tx_hash.slice(0, 20)}… · block #${r.anchored?.block_number} · SIMULATED dev ledger.` };
    },
  },
  {
    label: "Alter a test copy → failed integrity verification; then review the audit trail",
    testid: "demo-step-tamper",
    fn: async (c) => {
      const t = await apiPost<TamperTest>(`/trust/records/${need(c.recordId, "run step 10 first")}/tamper-test`);
      return { result: `Altered ${t.mutated_field}: hash ${t.tampered_hash.slice(0, 14)}… ≠ ${t.original_hash.slice(0, 14)}… → tampering ${t.detected ? "DETECTED" : "NOT detected"}. See Audit Trail.` };
    },
  },
];

function loadCtx(): DemoCtx {
  try {
    return JSON.parse(sessionStorage.getItem("zayotm.demoCtx") ?? "{}") as DemoCtx;
  } catch {
    return {};
  }
}

export default function InvestorDemoRunner() {
  const qc = useQueryClient();
  const [ctx, setCtx] = useState<DemoCtx>(loadCtx);
  const [states, setStates] = useState<StepState[]>(() => STEPS.map(() => ({ status: "idle" })));
  const [runningAll, setRunningAll] = useState(false);

  const setState = (i: number, s: StepState) => setStates((prev) => prev.map((x, j) => (j === i ? s : x)));
  const saveCtx = (next: DemoCtx) => {
    setCtx(next);
    sessionStorage.setItem("zayotm.demoCtx", JSON.stringify(next));
  };

  async function execute(i: number, current: DemoCtx): Promise<DemoCtx | null> {
    setState(i, { status: "running" });
    try {
      const { result, patch } = await STEPS[i].fn(current);
      const next = { ...current, ...(patch ?? {}) };
      saveCtx(next);
      setState(i, { status: "done", result });
      void qc.invalidateQueries();
      return next;
    } catch (e) {
      const msg = e instanceof ApiError ? e.message2 : e instanceof Error ? e.message : "unknown error";
      setState(i, { status: "failed", result: msg });
      toast.error(`Step ${i + 1} failed: ${msg}`);
      return null;
    }
  }

  async function runAll() {
    setRunningAll(true);
    setStates(STEPS.map(() => ({ status: "idle" })));
    let working: DemoCtx = {};
    for (let i = 0; i < STEPS.length; i++) {
      const next = await execute(i, working);
      if (!next) break;
      working = next;
      await wait(250);
    }
    setRunningAll(false);
    toast.success("Demo run finished — every result shown is live API output.");
  }

  function reset() {
    setStates(STEPS.map(() => ({ status: "idle" })));
    saveCtx({});
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm" data-testid="investor-demo-runner">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-sky-700">Guided demonstration</p>
          <h3 className="text-base font-bold text-slate-900">12-step investor walkthrough</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            data-testid="demo-run-all-button"
            onClick={runAll}
            disabled={runningAll}
            className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
          >
            {runningAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {runningAll ? "Running…" : "Run full demo"}
          </button>
          <button data-testid="demo-reset-button" onClick={reset} disabled={runningAll} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
        </div>
      </div>
      <ol className="divide-y divide-slate-100">
        {STEPS.map((step, i) => {
          const st = states[i];
          return (
            <li key={step.testid} className="flex items-start gap-3 px-5 py-2.5" data-testid={`demo-step-row-${i + 1}`}>
              <span
                className={cn(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold",
                  st.status === "done" && "bg-emerald-100 text-emerald-700",
                  st.status === "running" && "bg-sky-100 text-sky-700",
                  st.status === "failed" && "bg-rose-100 text-rose-700",
                  st.status === "idle" && "bg-slate-100 text-slate-500",
                )}
              >
                {st.status === "done" ? <Check className="h-3.5 w-3.5" /> : st.status === "failed" ? <CircleAlert className="h-3.5 w-3.5" /> : st.status === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">{step.label}</p>
                {st.result && (
                  <p className={cn("mt-0.5 text-xs leading-relaxed", st.status === "failed" ? "text-rose-600" : "text-slate-500")} data-testid={`demo-step-result-${i + 1}`}>
                    {st.result}
                  </p>
                )}
              </div>
              <button
                data-testid={step.testid}
                onClick={() => void execute(i, ctx)}
                disabled={runningAll || st.status === "running"}
                className="shrink-0 rounded border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                {st.status === "done" ? "Re-run" : "Run step"}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
