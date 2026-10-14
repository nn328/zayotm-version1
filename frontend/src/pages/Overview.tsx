import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiGet } from "@/lib/api";
import type { Dashboard } from "@/lib/types";
import InvestorDemoRunner from "@/components/demo/InvestorDemoRunner";
import { EmptyState, MetricCard, SectionTitle, SimulationBadge, StatusPill } from "@/components/common/ui-bits";
import { fmtDateTime, fmtNum } from "@/lib/format";

const PIPELINE = [
  { key: "dataset_loaded", label: "Data" },
  { key: "workflow_ran", label: "AI Agents" },
  { key: "case_created", label: "Decision Case" },
  { key: "optimized", label: "Optimization" },
  { key: "approved", label: "Human Approval" },
  { key: "record_created", label: "SHA-256 Record" },
  { key: "anchored", label: "Ledger Anchor" },
  { key: "tamper_tested", label: "Tamper Proof" },
  { key: "evaluated", label: "Evaluation" },
];

const SEVERITY_COLORS: Record<string, string> = { critical: "#e11d48", high: "#ea580c", medium: "#d97706", low: "#94a3b8" };

export default function Overview() {
  const { data: dash } = useQuery({ queryKey: ["dashboard"], queryFn: () => apiGet<Dashboard>("/dashboard"), refetchInterval: 15_000, retry: false });

  const severityData = Object.entries(dash?.findings_by_severity ?? {}).map(([severity, count]) => ({ severity, count }));

  return (
    <div className="space-y-8" data-testid="overview-page">
      {/* hero */}
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-sky-700">Universal Intelligence Fabric · prototype</p>
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">
              ZaYoTm™ — enterprise decision intelligence with verifiable provenance
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Connects fragmented enterprise data, orchestrates specialized AI agents over evidence, optimizes decisions with
              classical and quantum methods, and anchors every approved decision to a tamper-evident record. This is a working
              investor demonstration on synthetic data — <strong>not</strong> a production-certified or quantum-advantaged system.
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <SimulationBadge label="Ledger: Dev Simulation" />
            <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-800">
              Quantum: {dash?.capabilities?.quantum?.engine ?? "…"}
            </span>
            <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-800">
              LLM: {dash?.capabilities?.llm?.available ? "Connected" : "Deterministic fallback"}
            </span>
          </div>
        </div>

        {/* pipeline ribbon */}
        <div className="mt-6 flex flex-wrap items-center gap-1.5" data-testid="pipeline-ribbon">
          {PIPELINE.map((p, i) => {
            const done = dash?.demo_state?.[p.key];
            return (
              <div key={p.key} className="flex items-center gap-1.5">
                <span
                  data-testid={`pipeline-stage-${p.key}`}
                  className={
                    done
                      ? "inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200"
                      : "inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200"
                  }
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${done ? "bg-emerald-500" : "bg-slate-300"}`} />
                  {p.label}
                </span>
                {i < PIPELINE.length - 1 && <span className="text-slate-300">→</span>}
              </div>
            );
          })}
        </div>
      </section>

      {/* KPI tiles — every number is a live DB count, nothing invented */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-5" data-testid="kpi-tiles">
        <MetricCard label="Datasets" value={dash?.datasets ?? "—"} sub={dash?.latest_quality_score != null ? `lowest file quality ${dash.latest_quality_score}/100` : "none loaded yet"} />
        <MetricCard label="Open findings" value={dash?.open_findings ?? "—"} sub="latest workflow run" tone="amber" />
        <MetricCard label="Pending decisions" value={dash?.pending_decisions ?? "—"} sub="awaiting human gate" tone="violet" />
        <MetricCard label="Decision records" value={dash?.records ?? "—"} sub={`${dash?.verified_ok ?? 0} verified OK`} tone="emerald" />
        <MetricCard label="Ledger height" value={dash ? `${dash.anchored_simulated} tx (sim)` : "—"} sub="dev simulation — not a real chain" tone="slate" />
      </section>

      {/* guided demo */}
      <section>
        <SectionTitle overline="For the evaluation" title="Repeatable investor demonstration" testid="demo-section-title" />
        <InvestorDemoRunner />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        {/* recent decisions */}
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-3">
            <h3 className="text-sm font-bold text-slate-900">Recent decisions</h3>
          </div>
          {dash?.recent_decisions?.length ? (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {dash.recent_decisions.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="max-w-[280px] truncate px-5 py-2.5">
                      <Link to={`/decision-studio/${d.id}`} className="font-medium text-slate-800 hover:text-sky-700" data-testid="recent-decision-link">
                        {d.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5"><StatusPill status={d.status} /></td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-slate-500">unc. {d.uncertainty ?? "—"}</td>
                    <td className="px-5 py-2.5 text-right text-xs text-slate-400">{fmtDateTime(d.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-5"><EmptyState title="No decisions yet" hint="Run the guided demo above — every decision appears here with its live status." testid="recent-decisions-empty" /></div>
          )}
        </div>

        {/* findings severity chart */}
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-3">
            <h3 className="text-sm font-bold text-slate-900">Findings by severity (latest run)</h3>
          </div>
          {severityData.length ? (
            <div className="h-52 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={severityData} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="severity" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value: number) => [`${value} findings`, "Count"]} labelFormatter={(label: string) => String(label)} />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {severityData.map((entry) => (
                      <Cell key={entry.severity} fill={SEVERITY_COLORS[entry.severity] ?? "#0284c7"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="p-5"><EmptyState title="No findings yet" hint="Run the intelligence workflow on a dataset to populate this chart." testid="severity-chart-empty" /></div>
          )}
        </div>
      </section>

      {/* honesty card */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" data-testid="capability-honesty-card">
        <SectionTitle overline="Transparency" title="What is implemented, simulated, and planned" />
        <div className="grid gap-6 md:grid-cols-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">Implemented</p>
            <ul className="mt-2 space-y-1 text-xs leading-relaxed text-slate-600">
              <li>· CSV ingestion, schema/type inference, quality scoring</li>
              <li>· IsolationForest anomalies + deterministic policy rules + cross-record conflicts</li>
              <li>· TF-IDF retrieval (RAG) over policy corpus with source citations</li>
              <li>· 10-agent orchestrated workflow with conditional routing + LLM (reasoning/explainability)</li>
              <li>· OR-Tools CP-SAT exact optimization; QAOA on Qiskit Aer simulator</li>
              <li>· SHA-256 canonical decision records + tamper detection</li>
              <li>· Role-gated approvals, audit trail, evaluation harness</li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Simulated (labeled)</p>
            <ul className="mt-2 space-y-1 text-xs leading-relaxed text-slate-600">
              <li>· Blockchain anchoring runs on a local dev-simulation ledger (EVM-shaped, Besu adapter ready)</li>
              <li>· Quantum execution is a simulator (Aer) — no quantum hardware, no quantum-advantage claim</li>
              <li>· Demo identities replace production SSO</li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Planned</p>
            <ul className="mt-2 space-y-1 text-xs leading-relaxed text-slate-600">
              <li>· Hyperledger Besu permissioned deployment + deployed registry contract</li>
              <li>· Zero-knowledge proofs (interface only — no ZKP implemented)</li>
              <li>· Live SAP/Salesforce/Oracle connectors (interfaces only)</li>
              <li>· Calibrated uncertainty on held-out validation data</li>
            </ul>
          </div>
        </div>
        <p className="mt-4 text-[11px] text-slate-400">
          All metrics on this page are live counts from the platform database ({fmtNum(dash?.audit_events ?? 0)} audit events recorded). The platform never presents an AI explanation as proof that a decision is correct.
        </p>
      </section>
    </div>
  );
}
