import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import type { Case, CaseSummary, OptimizationRun } from "@/lib/types";
import { useRole } from "@/components/RoleContext";
import { EmptyState, EvidenceList, SectionTitle, SeverityBadge, StatusPill, UncertaintyGauge } from "@/components/common/ui-bits";
import { fmtDateTime, fmtMoney, fmtNum, shortHash, titleize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";

export default function DecisionStudio() {
  const { caseId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can, actor } = useRole();
  const [reason, setReason] = useState("");
  const { data: cases = [] } = useQuery({ queryKey: ["cases"], queryFn: () => apiGet<CaseSummary[]>("/cases"), refetchInterval: 20_000, retry: false });

  const { data: kase } = useQuery({
    queryKey: ["case", caseId],
    queryFn: () => apiGet<Case>(`/cases/${caseId}`),
    enabled: Boolean(caseId),
    refetchInterval: (q) => (q.state.data?.status === "running" ? 3000 : false),
    retry: false,
  });

  const optimize = useMutation({
    mutationFn: () => apiPost<OptimizationRun>(`/cases/${caseId}/optimize`),
    onSuccess: (run) => {
      toast.success(`Optimization finished — selected ${run.selected.solver} (objective ${fmtNum(run.selected.objective)})`);
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message2 : "Optimization failed"),
  });

  const recommend = useMutation({
    mutationFn: () => apiPost<Case>(`/cases/${caseId}/recommendation`),
    onSuccess: () => {
      toast.success("Recommendation generated with evidence, uncertainty and limitations.");
      void qc.invalidateQueries({ queryKey: ["case", caseId] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message2 : "Failed to generate recommendation"),
  });

  const approve = useMutation({
    mutationFn: (action: "approve" | "reject" | "revise") => apiPost<Case>(`/cases/${caseId}/approve`, { action, reason: reason || `${action} via Decision Studio` }),
    onSuccess: (_d, action) => {
      toast.success(`Decision recorded: ${action}`);
      setReason("");
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message2 : "Approval failed"),
  });

  const createRecord = useMutation({
    mutationFn: () => apiPost<{ id: string; decision_id: string }>("/trust/records", { case_id: caseId }),
    onSuccess: (r) => {
      toast.success(`Decision record ${r.decision_id} created — open the Trust Center.`);
      void qc.invalidateQueries();
      navigate("/trust-blockchain");
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message2 : "Record creation failed"),
  });

  /* ---------- list view ---------- */
  if (!caseId) {
    return (
      <div className="space-y-4" data-testid="decision-studio-list">
        <SectionTitle overline="Layer 4 · decision intelligence" title="Decision cases" testid="cases-title" />
        {cases.length === 0 && <EmptyState title="No decision cases yet" hint="Run the intelligence workflow (Executive Overview → guided demo) to create the first case." testid="cases-empty" />}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {cases.map((c) => (
            <Link key={c.id} to={`/decision-studio/${c.id}`} data-testid={`case-card-${c.id}`} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-px hover:border-slate-300 hover:shadow-md">
              <div className="flex items-center justify-between gap-2">
                <StatusPill status={c.status} />
                {c.uncertainty && (
                  <span className={cn("font-mono text-xs font-bold", c.uncertainty.band === "high" ? "text-rose-600" : c.uncertainty.band === "medium" ? "text-amber-600" : "text-emerald-600")}>
                    unc. {c.uncertainty.score}
                  </span>
                )}
              </div>
              <p className="mt-2 line-clamp-2 text-sm font-bold text-slate-800">{c.title}</p>
              <p className="mt-1 text-xs text-slate-500">
                {c.has_recommendation ? "recommendation ready" : "awaiting optimization/recommendation"} · {fmtDateTime(c.created_at)}
              </p>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  /* ---------- detail view ---------- */
  const opt = kase?.latest_optimization;
  const canApprove = can("approve");

  return (
    <div className="space-y-6" data-testid="decision-detail-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button onClick={() => navigate("/decision-studio")} className="text-xs font-semibold text-sky-700 hover:text-sky-900" data-testid="back-to-cases-link">
            ← All cases
          </button>
          <h2 className="mt-1 text-xl font-extrabold tracking-tight text-slate-900" data-testid="case-title">{kase?.title ?? "…"}</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">{kase?.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={kase?.status ?? "draft"} />
        </div>
      </div>

      {kase && (
        <>
          <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
            <div className="space-y-6">
              {/* candidates */}
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm" data-testid="candidates-panel">
                <div className="border-b border-slate-200 px-5 py-3">
                  <h3 className="text-sm font-bold text-slate-900">Candidate purchase orders ({kase.candidates.length})</h3>
                  <p className="text-xs text-slate-500">Value model: {kase.candidates[0]?.value_model ?? "—"}. Constraint-aware: infeasible records are excluded, never presented as valid options.</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs" data-testid="candidates-table">
                    <thead>
                      <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400">
                        <th className="px-5 py-2 font-semibold">PO</th>
                        <th className="px-3 py-2 font-semibold">Supplier</th>
                        <th className="px-3 py-2 font-semibold">Department</th>
                        <th className="px-3 py-2 font-semibold">Amount</th>
                        <th className="px-3 py-2 font-semibold">Priority</th>
                        <th className="px-3 py-2 font-semibold">Value</th>
                        <th className="px-5 py-2 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {kase.candidates.map((c) => (
                        <tr key={`${c.po_id}-${c.amount}`} className={cn(c.excluded && "bg-rose-50/40")}>
                          <td className="px-5 py-2 font-mono font-bold text-slate-800">{c.po_id}</td>
                          <td className="px-3 py-2 text-slate-600">{c.supplier_name}</td>
                          <td className="px-3 py-2 text-slate-600">{c.department}</td>
                          <td className="px-3 py-2 font-mono text-slate-700">{fmtMoney(c.amount)}</td>
                          <td className="px-3 py-2"><SeverityBadge severity={c.priority} /></td>
                          <td className="px-3 py-2 font-mono text-slate-700">{fmtNum(c.value_score, 2)}</td>
                          <td className="px-5 py-2">
                            {c.excluded ? (
                              <span className="text-[11px] font-semibold text-rose-700" data-testid={`candidate-excluded-${c.po_id}`}>excluded · {c.exclusion_reason}</span>
                            ) : (
                              <span className="text-[11px] font-semibold text-emerald-700">eligible</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* optimization */}
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm" data-testid="optimization-panel">
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Optimization (classical baseline + quantum experiment)</h3>
                    <p className="text-xs text-slate-500">{kase.formulation?.qubo_formulation ?? "Formulated during the workflow."}</p>
                  </div>
                  <button
                    data-testid="run-optimization-button"
                    onClick={() => optimize.mutate()}
                    disabled={optimize.isPending}
                    className="rounded-md bg-sky-700 px-3.5 py-2 text-xs font-bold text-white hover:bg-sky-800 disabled:opacity-50"
                  >
                    {optimize.isPending ? "Optimizing…" : opt ? "Run again" : "Run optimization"}
                  </button>
                </div>
                {opt ? (
                  <div className="p-5" data-testid="optimization-results">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4" data-testid="classical-result-card">
                        <p className="text-xs font-bold uppercase tracking-wider text-amber-800">Classical · {opt.classical.solver}</p>
                        <p className="mt-1 text-2xl font-extrabold text-slate-900">{fmtNum(opt.classical.objective)}</p>
                        <p className="text-xs text-slate-600">status {opt.classical.solver_status} · {opt.classical.runtime_ms.toFixed(1)} ms · {opt.classical.solution.length} selected</p>
                        <p className="mt-1 font-mono text-[11px] text-slate-500">{opt.classical.solution.join(", ")}</p>
                      </div>
                      <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-4" data-testid="quantum-result-card">
                        <p className="text-xs font-bold uppercase tracking-wider text-sky-800">Quantum · {opt.quantum.engine}</p>
                        <p className="mt-1 text-2xl font-extrabold text-slate-900">{fmtNum(opt.quantum.objective)}</p>
                        <p className="text-xs text-slate-600">
                          QAOA p={opt.quantum.depth_p} · {opt.quantum.shots} shots · {opt.quantum.runtime_ms.toFixed(1)} ms · feasible {String(opt.quantum.feasible)}
                        </p>
                        <p className="mt-1 font-mono text-[11px] text-slate-500">{opt.quantum.solution.join(", ")}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600" data-testid="optimization-selected">
                      <span className="rounded-full bg-slate-900 px-2.5 py-1 font-semibold text-white">selected: {opt.selected.solver}</span>
                      <span>{opt.selected.policy}</span>
                      {opt.classical.objective > 0 && opt.quantum.feasible && (
                        <span className="font-mono">approx. ratio {(opt.quantum.objective / opt.classical.objective).toFixed(2)}</span>
                      )}
                      <Link to="/quantum-lab" className="font-semibold text-sky-700 hover:text-sky-900">Open Quantum Lab →</Link>
                    </div>
                  </div>
                ) : (
                  <div className="p-5"><EmptyState title="Not optimized yet" hint="Runs OR-Tools CP-SAT (exact) and QAOA on the Qiskit Aer simulator on the same QUBO — measured numbers, honestly compared." testid="optimization-empty" /></div>
                )}
              </div>

              {/* alternatives */}
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm" data-testid="alternatives-panel">
                <div className="border-b border-slate-200 px-5 py-3">
                  <h3 className="text-sm font-bold text-slate-900">Decision alternatives ({kase.alternatives.length})</h3>
                </div>
                <div className="grid gap-3 p-5 md:grid-cols-3">
                  {kase.alternatives.map((a) => (
                    <div key={a.id} className={cn("rounded-lg border p-4", a.feasible ? "border-emerald-200 bg-emerald-50/40" : "border-rose-200 bg-rose-50/40")} data-testid={`alternative-${a.id}`}>
                      <div className="flex items-center justify-between">
                        <p className="font-mono text-[10px] font-bold uppercase text-slate-500">{a.id}</p>
                        <span className={cn("text-[10px] font-bold uppercase", a.feasible ? "text-emerald-700" : "text-rose-700")}>{a.feasible ? "feasible" : "infeasible"}</span>
                      </div>
                      <p className="mt-1 text-sm font-bold text-slate-800">{a.label}</p>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">{a.description}</p>
                      <ul className="mt-2 space-y-1">
                        {a.constraint_checks.map((cc) => (
                          <li key={cc.id} className="flex items-start gap-1.5 text-[11px] text-slate-600">
                            {cc.passed ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-rose-500" />}
                            {cc.description}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>

              {/* recommendation */}
              <div className="rounded-lg border border-slate-200 bg-white shadow-sm" data-testid="recommendation-panel">
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
                  <h3 className="text-sm font-bold text-slate-900">Recommendation</h3>
                  <button
                    data-testid="generate-recommendation-button"
                    onClick={() => recommend.mutate()}
                    disabled={recommend.isPending || !kase.optimization_run_id}
                    className="rounded-md bg-slate-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-50"
                    title={!kase.optimization_run_id ? "Run the optimization first" : undefined}
                  >
                    {recommend.isPending ? "Generating…" : kase.recommendation ? "Regenerate" : "Generate recommendation"}
                  </button>
                </div>
                {kase.recommendation ? (
                  <div className="space-y-4 p-5">
                    <p className="rounded-md bg-slate-50 p-3 text-sm font-semibold leading-relaxed text-slate-800 ring-1 ring-slate-200" data-testid="recommendation-summary">{kase.recommendation.summary}</p>
                    {kase.executive_summary && <p className="text-sm leading-relaxed text-slate-700" data-testid="executive-summary">{kase.executive_summary}</p>}
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Rationale (evidence-linked)</p>
                      <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-slate-600" data-testid="recommendation-rationale">{kase.recommendation.rationale}</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Constraints honored</p>
                      <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                        {kase.recommendation.constraints.map((c) => <li key={c.id}>· <span className="font-semibold">{c.id}</span> — {c.description}</li>)}
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Known limitations</p>
                      <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                        {kase.recommendation.limitations.map((l, i) => <li key={i} data-testid="recommendation-limitations">· {l}</li>)}
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Evidence</p>
                      <div className="mt-1"><EvidenceList evidence={kase.recommendation.evidence} /></div>
                    </div>
                    <p className="text-[11px] font-medium text-rose-800 ring-1 ring-rose-200 rounded bg-rose-50 px-3 py-2">{kase.recommendation.note}</p>
                  </div>
                ) : (
                  <div className="p-5"><EmptyState title="No recommendation yet" hint="Requires a completed optimization run. The recommendation is generated from measured optimization results, retrieved evidence, and computed uncertainty." testid="recommendation-empty" /></div>
                )}
              </div>
            </div>

            {/* right rail: uncertainty + approval */}
            <div className="space-y-4">
              {kase.uncertainty && <UncertaintyGauge unc={kase.uncertainty} testid="case-uncertainty-gauge" />}

              <div className="rounded-lg border border-slate-200 bg-white shadow-sm" data-testid="approval-panel">
                <div className="border-b border-slate-200 px-5 py-3">
                  <h3 className="text-sm font-bold text-slate-900">Human approval gate</h3>
                  <p className="text-xs text-slate-500">Consequential actions require an authorized human. Analysts draft; the Approver or Executive decides.</p>
                </div>
                <div className="space-y-3 p-5">
                  <Textarea
                    data-testid="approval-reason-input"
                    placeholder="Reason (recorded with the decision)…"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="min-h-[72px] text-sm"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <button data-testid="approve-decision-button" onClick={() => approve.mutate("approve")} disabled={!canApprove || approve.isPending || kase.status === "approved" || kase.status === "rejected"} className="rounded-md bg-emerald-700 px-2 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-40">Approve</button>
                    <button data-testid="reject-decision-button" onClick={() => approve.mutate("reject")} disabled={!canApprove || approve.isPending || kase.status === "approved" || kase.status === "rejected"} className="rounded-md bg-rose-700 px-2 py-2 text-xs font-bold text-white hover:bg-rose-800 disabled:opacity-40">Reject</button>
                    <button data-testid="revise-decision-button" onClick={() => approve.mutate("revise")} disabled={!canApprove || approve.isPending || kase.status === "approved" || kase.status === "rejected"} className="rounded-md border border-amber-400 bg-amber-50 px-2 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-40">Revise</button>
                  </div>
                  {!canApprove && (
                    <p className="rounded bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200" data-testid="approval-role-note">
                      Your current identity ({titleize(actor?.role ?? "")}) cannot approve. Switch to “Ingrid Solberg — Chief Compliance Approver” or the Executive in the top bar.
                    </p>
                  )}
                  {kase.status === "approved" && !kase.recommendation && null}
                  {kase.status === "approved" && (
                    <button
                      data-testid="create-decision-record-button"
                      onClick={() => createRecord.mutate()}
                      disabled={createRecord.isPending}
                      className="w-full rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-50"
                    >
                      {createRecord.isPending ? "Hashing…" : "Create cryptographic decision record →"}
                    </button>
                  )}
                  {kase.approvals.length > 0 && (
                    <div className="border-t border-slate-100 pt-3" data-testid="approval-history">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Approval history</p>
                      <ul className="mt-1 space-y-1.5">
                        {kase.approvals.map((a) => (
                          <li key={a.id} className="text-[11px] leading-relaxed text-slate-600">
                            <span className="font-bold">{titleize(a.action)}</span> · {a.actor} ({titleize(a.actor_role)}) · {fmtDateTime(a.ts)}
                            <br />
                            <span className="text-slate-400">“{a.reason}” — {a.from_status} → {a.to_status}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {kase.evidence.length > 0 && (
                <div data-testid="case-evidence-rail">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Case evidence</p>
                  <EvidenceList evidence={kase.evidence.slice(0, 4)} />
                </div>
              )}
            </div>
          </div>
        </>
      )}
      {!kase && <EmptyState title="Case not found" hint="It may still be creating — check the AI Intelligence Center." testid="case-not-found" />}
    </div>
  );
}

export { shortHash };
