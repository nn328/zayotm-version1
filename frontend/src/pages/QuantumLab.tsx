import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiGet } from "@/lib/api";
import type { Case, CaseSummary, OptimizationRun } from "@/lib/types";
import { EmptyState, HashText, JsonViewer, SectionTitle, SimulationBadge } from "@/components/common/ui-bits";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function QuantumLab() {
  const { data: cases = [] } = useQuery({ queryKey: ["cases"], queryFn: () => apiGet<CaseSummary[]>("/cases"), retry: false, refetchInterval: 30_000 });
  const withOpt = cases.filter((c) => c.optimization_run_id);
  const [caseId, setCaseId] = useState<string | null>(null);
  const activeId = caseId ?? withOpt[0]?.id ?? null;

  const { data: kase } = useQuery({ queryKey: ["case", activeId], queryFn: () => apiGet<Case>(`/cases/${activeId}`), enabled: Boolean(activeId), retry: false });
  const { data: runs = [] } = useQuery({
    queryKey: ["optimizations", activeId],
    queryFn: () => apiGet<OptimizationRun[]>(`/cases/${activeId}/optimizations`),
    enabled: Boolean(activeId),
    retry: false,
  });
  const run = runs[0];

  const runtimeData = run
    ? [
        { name: "Classical (CP-SAT)", ms: Math.round(run.classical.runtime_ms), fill: "#d97706" },
        { name: `QAOA (${run.quantum.shots} shots)`, ms: Math.round(run.quantum.runtime_ms), fill: "#0284c7" },
      ]
    : [];
  const convergence = (run?.quantum.convergence ?? []).map((c) => ({ step: c.step, expectation: c.expectation }));
  const ratio = run && run.classical.objective > 0 && run.quantum.feasible ? run.quantum.objective / run.classical.objective : null;

  return (
    <div className="space-y-6" data-testid="quantum-lab-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <SectionTitle overline="Layer 4 · hybrid solver interface" title="Quantum Lab — classical vs quantum, measured honestly" testid="quantum-lab-title" />
        <div className="flex items-center gap-2">
          <SimulationBadge label="Simulator: Qiskit Aer" />
          <select
            data-testid="quantum-case-select"
            value={activeId ?? ""}
            onChange={(e) => setCaseId(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
          >
            {withOpt.length === 0 && <option value="">— no optimized cases —</option>}
            {withOpt.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title.slice(0, 56)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!run && (
        <EmptyState
          title="No optimization runs yet"
          hint="Open a decision case in the Decision Studio and run the optimization — then the classical/quantum benchmark appears here."
          testid="quantum-empty"
        />
      )}

      {run && kase && (
        <>
          {/* solver comparison */}
          <div className="grid gap-4 lg:grid-cols-2" data-testid="solver-comparison">
            <div className="rounded-lg border border-amber-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-900">Classical baseline</p>
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-800 ring-1 ring-amber-200">deterministic · exact</span>
                </div>
                <p className="font-mono text-xs text-slate-500">{run.classical.solver}</p>
              </div>
              <div className="grid grid-cols-2 gap-4 p-5">
                <Metric label="Objective" value={fmtNum(run.classical.objective)} tone="text-slate-900" testid="classical-objective" />
                <Metric label="Runtime" value={`${run.classical.runtime_ms.toFixed(1)} ms`} tone="text-slate-900" testid="classical-runtime" />
                <Metric label="Status" value={run.classical.solver_status ?? "—"} tone="text-emerald-600" testid="classical-status" />
                <Metric label="Feasible" value={String(run.classical_validation.feasible)} tone="text-emerald-600" testid="classical-feasible" />
              </div>
              <div className="border-t border-slate-100 px-5 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Selected POs</p>
                <p className="mt-1 font-mono text-xs text-slate-600">{run.classical.solution.join(", ") || "—"}</p>
                {(run.classical.notes ?? []).map((n) => <p key={n} className="mt-1 text-[11px] text-slate-400">{n}</p>)}
              </div>
            </div>

            <div className="rounded-lg border border-sky-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-900">Quantum experiment</p>
                  <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-sky-800 ring-1 ring-sky-200">simulator · heuristic</span>
                </div>
                <p className="font-mono text-xs text-slate-500">{run.quantum.engine} · {run.quantum.library} · sampling: {run.quantum.sampling_backend}</p>
              </div>
              <div className="grid grid-cols-2 gap-4 p-5">
                <Metric label="Objective" value={fmtNum(run.quantum.objective)} tone="text-sky-700" testid="quantum-objective" />
                <Metric label="Runtime" value={`${run.quantum.runtime_ms.toFixed(1)} ms`} tone="text-sky-700" testid="quantum-runtime" />
                <Metric label="Approx. ratio" value={ratio != null ? ratio.toFixed(2) : "—"} tone="text-slate-900" testid="quantum-approx-ratio" />
                <Metric label="Feasible" value={String(run.quantum_validation.feasible)} tone={run.quantum_validation.feasible ? "text-emerald-600" : "text-rose-600"} testid="quantum-feasible" />
              </div>
              <div className="border-t border-slate-100 px-5 py-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Selected POs (measured, may differ from classical)</p>
                <p className="mt-1 font-mono text-xs text-slate-600">{run.quantum.solution.join(", ") || "—"}</p>
                {(run.quantum.notes ?? []).map((n) => <p key={n} className="mt-1 text-[11px] text-slate-400">{n}</p>)}
              </div>
            </div>
          </div>

          {/* charts */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" data-testid="runtime-chart">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Runtime comparison (ms)</p>
              <div className="mt-3 h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={runtimeData} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(value: number) => [`${value} ms`, "Runtime"]} />
                    <Bar dataKey="ms" radius={[3, 3, 0, 0]} fill="#0284c7" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" data-testid="convergence-chart">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">QAOA convergence — ⟨E⟩ per optimizer step</p>
              <div className="mt-3 h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={convergence} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="step" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <Tooltip formatter={(value: number) => [value.toFixed(3), "⟨E⟩"]} labelFormatter={(label: string) => `step ${label}`} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line type="monotone" dataKey="expectation" stroke="#7c3aed" strokeWidth={2} dot={false} name="cost expectation" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* formulation */}
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm" data-testid="formulation-panel">
            <div className="border-b border-slate-200 px-5 py-3">
              <p className="text-sm font-bold text-slate-900">Problem formulation (QUBO)</p>
            </div>
            <div className="grid gap-4 p-5 md:grid-cols-3">
              <div className="md:col-span-2">
                <pre className="overflow-x-auto rounded-md bg-slate-900 p-4 font-mono text-[11px] leading-relaxed text-emerald-300" data-testid="qubo-formula">
{`E(x) = xᵀQx        x ∈ {0,1}ⁿ

Q = −diag(value) + λ · (costᵢ·costⱼ),  i ≠ j
λ  = ${run.quantum.penalty_lambda ?? "λ from settings"}

maximize  Σ valueᵢ·xᵢ   s.t.  Σ costᵢ·xᵢ ≤ ${run.budget?.toLocaleString?.() ?? run.budget}
encoded as quadratic penalty → E = −value·x + λ(Σ cost·x − B)²

ansatz: |γ,β⟩ = Πₗ e^(−iβₗΣX) e^(−iγₗE) |+⟩ⁿ   p = ${run.quantum.depth_p}`}
                </pre>
              </div>
              <div className="space-y-2 text-xs text-slate-600">
                <p><span className="font-bold">Variables:</span> {run.quantum.n_vars ?? run.candidate_pool.length} binary</p>
                <p><span className="font-bold">Shots:</span> {run.quantum.shots}</p>
                <p><span className="font-bold">Params (γ, β):</span> {JSON.stringify(run.quantum.params)}</p>
                <p><span className="font-bold">Min sampled energy:</span> {run.quantum.min_sampled_energy}</p>
                <p><span className="font-bold">Candidate pool:</span> <span className="font-mono">{run.candidate_pool.join(", ")}</span></p>
                <p><span className="font-bold">Constraint validation:</span> post-solver, deterministic (budget + binary checks)</p>
                <div className="pt-1"><JsonViewer data={{ formulation: run.formulation, quantum_validation: run.quantum_validation }} label="formulation + validation JSON" testid="formulation-json-toggle" /></div>
              </div>
            </div>
            <div className="border-t border-slate-100 px-5 py-3">
              <p className="text-[11px] leading-relaxed text-slate-500">
                Honest disclosure: the quantum experiment executes on the {run.quantum.engine} (a simulator). No quantum hardware was used and no
                quantum advantage is claimed — QAOA is a heuristic and may return a worse objective than the exact classical baseline, as the measured
                numbers above show. Selected result: <strong>{run.selected.solver}</strong> under the policy “{run.selected.policy}”.
              </p>
            </div>
          </div>

          {/* history */}
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm" data-testid="optimization-history">
            <div className="border-b border-slate-200 px-5 py-3">
              <p className="text-sm font-bold text-slate-900">Run history for this case ({runs.length})</p>
            </div>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400">
                  <th className="px-5 py-2 font-semibold">When</th>
                  <th className="px-3 py-2 font-semibold">Classical obj</th>
                  <th className="px-3 py-2 font-semibold">QAOA obj</th>
                  <th className="px-3 py-2 font-semibold">Classical ms</th>
                  <th className="px-3 py-2 font-semibold">QAOA ms</th>
                  <th className="px-5 py-2 font-semibold">Selected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-5 py-2 text-slate-500">{fmtDateTime(r.created_at)}</td>
                    <td className="px-3 py-2 font-mono">{fmtNum(r.classical.objective)}</td>
                    <td className="px-3 py-2 font-mono">{fmtNum(r.quantum.objective)}</td>
                    <td className="px-3 py-2 font-mono">{r.classical.runtime_ms.toFixed(1)}</td>
                    <td className="px-3 py-2 font-mono">{r.quantum.runtime_ms.toFixed(1)}</td>
                    <td className={cn("px-5 py-2 font-bold", r.selected.solver === "quantum" ? "text-sky-700" : "text-amber-700")}>{r.selected.solver}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, tone, testid }: { label: string; value: string; tone: string; testid?: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p data-testid={testid} className={cn("mt-0.5 text-lg font-extrabold tracking-tight", tone)}>{value}</p>
    </div>
  );
}

export { HashText };
