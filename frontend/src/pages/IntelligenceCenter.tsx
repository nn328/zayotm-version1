import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import type { AgentRun, EvalResult, RunSummary } from "@/lib/types";
import { EmptyState, EvidenceList, JsonViewer, SectionTitle, StatusPill, UncertaintyGauge } from "@/components/common/ui-bits";
import { fmtDateTime, titleize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, FlaskConical } from "lucide-react";

const STATUS_ICON: Record<string, string> = { completed: "✓", failed: "✕", running: "…" };

export default function IntelligenceCenter() {
  const qc = useQueryClient();
  const { data: runs = [] } = useQuery({ queryKey: ["runs"], queryFn: () => apiGet<RunSummary[]>("/workflows/runs"), refetchInterval: 20_000, retry: false });
  const [runId, setRunId] = useState<string | null>(null);
  const activeId = runId ?? runs[0]?.id ?? null;

  const { data: run } = useQuery({
    queryKey: ["run", activeId],
    queryFn: () => apiGet<AgentRun>(`/workflows/runs/${activeId}`),
    enabled: Boolean(activeId),
    refetchInterval: (query) => (query.state.data?.status === "running" ? 2500 : false),
    retry: false,
  });

  const { data: evalr, refetch: refetchEval } = useQuery({ queryKey: ["eval-latest"], queryFn: () => apiGet<EvalResult>("/eval/latest"), retry: false });

  const runEval = useMutation({
    mutationFn: () => apiPost<EvalResult>("/eval/run"),
    onSuccess: () => {
      toast.success("Evaluation harness finished — measured against planted ground truth.");
      void refetchEval();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message2 : "Evaluation failed"),
  });

  const [expanded, setExpanded] = useState<string | null>(null);
  const completed = run?.agents.filter((a) => a.status === "completed") ?? [];
  const running = run?.status === "running";

  return (
    <div className="space-y-6" data-testid="intelligence-page">
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* run list */}
        <div className="space-y-2" data-testid="run-list">
          <button
            data-testid="run-eval-button"
            onClick={() => runEval.mutate()}
            disabled={runEval.isPending}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-violet-300 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-50"
          >
            <FlaskConical className="h-4 w-4" /> {runEval.isPending ? "Evaluating…" : "Run evaluation harness"}
          </button>
          {runs.length === 0 && <EmptyState title="No workflow runs yet" hint="Start from the Executive Overview demo or run a workflow after loading data." testid="runs-empty" />}
          {runs.map((r) => (
            <button
              key={r.id}
              data-testid={`run-item-${r.id}`}
              onClick={() => setRunId(r.id)}
              className={cn(
                "w-full rounded-lg border p-3 text-left transition-colors",
                activeId === r.id ? "border-sky-300 bg-sky-50 ring-1 ring-sky-200" : "border-slate-200 bg-white hover:border-slate-300",
              )}
            >
              <div className="flex items-center justify-between">
                <StatusPill status={r.status} />
                <span className="font-mono text-[10px] text-slate-400">{fmtDateTime(r.started_at)}</span>
              </div>
              <p className="mt-1 truncate text-xs font-medium text-slate-700">{r.dataset_name ?? "dataset"}</p>
              <p className="text-[11px] text-slate-500">
                {r.agents_completed}/{r.agents_total || 10} agents · {r.uncertainty ? `uncertainty ${r.uncertainty.score}` : "uncertainty pending"}
              </p>
            </button>
          ))}
        </div>

        {/* run detail */}
        <div className="space-y-6">
          {running && (
            <div className="flex items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3" data-testid="run-in-progress-banner">
              <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500" />
              <p className="text-sm font-medium text-sky-900">Workflow executing — agent traces stream in as each completes. LLM calls may take up to a minute.</p>
            </div>
          )}

          {run && (
            <>
              {run.escalation?.triggered && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3" data-testid="escalation-banner">
                  <p className="text-sm font-bold text-amber-900">Uncertainty-aware escalation triggered</p>
                  <p className="text-xs text-amber-800">{run.escalation.reason} → {run.escalation.action}</p>
                </div>
              )}

              <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
                <div className="space-y-3" data-testid="agent-trace-grid">
                  <SectionTitle overline="Layer 6 · orchestration" title="Agent execution traces" testid="agent-traces-title" />
                  <div className="grid gap-2 md:grid-cols-2">
                    {run.agents.map((a) => (
                      <div key={`${a.agent}-${a.summary.slice(0, 12)}`} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm" data-testid={`agent-trace-${a.agent}`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-bold text-slate-800">{a.name}</p>
                          <div className="flex items-center gap-1.5">
                            {a.llm_used && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-violet-800">LLM</span>}
                            <span
                              className={cn(
                                "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                                a.status === "completed" && "bg-emerald-100 text-emerald-700",
                                a.status === "failed" && "bg-rose-100 text-rose-700",
                                a.status === "running" && "bg-sky-100 text-sky-700",
                              )}
                            >
                              {STATUS_ICON[a.status] ?? "·"}
                            </span>
                          </div>
                        </div>
                        <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{a.type} · {a.duration_ms.toFixed(0)}ms{a.note ? ` · ${a.note}` : ""}</p>
                        <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{a.summary}</p>
                        {a.output != null && (
                          <div className="mt-2">
                            <button
                              data-testid={`agent-output-toggle-${a.agent}`}
                              onClick={() => setExpanded(expanded === a.agent ? null : a.agent)}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 hover:text-sky-900"
                            >
                              {expanded === a.agent ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} Output details
                            </button>
                            {expanded === a.agent && (
                              <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-slate-900 p-3 font-mono text-[10px] leading-relaxed text-slate-100" data-testid={`agent-output-${a.agent}`}>
                                {JSON.stringify(a.output, null, 2).slice(0, 4000)}
                              </pre>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {run.routing_decisions.length > 0 && (
                    <div className="rounded-lg border border-slate-200 bg-white p-4" data-testid="routing-decisions">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Orchestrator routing decisions (adaptive, logged)</p>
                      <ul className="mt-2 space-y-1 text-xs text-slate-600">
                        {run.routing_decisions.map((r, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="font-mono text-[10px] font-bold text-violet-700">{r.agent}</span>
                            <span>{r.decision}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  {run.uncertainty && <UncertaintyGauge unc={run.uncertainty} testid="run-uncertainty-gauge" />}
                  <div className="rounded-lg border border-slate-200 bg-white p-4" data-testid="run-llm-info">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">AI usage</p>
                    <p className="mt-1 text-xs text-slate-600">
                      LLM {run.llm.available ? `connected (${run.llm.model})` : "unavailable — deterministic fallback in effect"}.
                      {run.llm.used_in.length ? ` Used by: ${run.llm.used_in.join(", ")}.` : " No agent required it this run."}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-400">LLM output is narrative support, never treated as evidence or proof of correctness.</p>
                  </div>
                  <div data-testid="run-evidence">
                    <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Evidence (retrieved, cited)</p>
                    <EvidenceList evidence={run.evidence} />
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-4" data-testid="run-mode">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Workflow mode</p>
                    <p className="mt-1 text-xs text-slate-600">{titleize(run.mode)} — deterministic agents run first; LLM calls are routed only where they add value.</p>
                    {run.case_id && (
                      <a href={`/decision-studio/${run.case_id}`} className="mt-2 inline-block text-xs font-semibold text-sky-700 hover:text-sky-900" data-testid="run-case-link">
                        Open decision case →
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
          {!run && !runs.length && <EmptyState title="Nothing to inspect yet" hint="Run the intelligence workflow from the Executive Overview." testid="run-detail-empty" />}
        </div>
      </div>

      {/* evaluation harness */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm" data-testid="eval-harness-panel">
        <div className="border-b border-slate-200 px-5 py-3">
          <SectionTitle
            overline="Research hypotheses, measured"
            title="Evaluation harness — proposed workflow vs baselines"
            right={
              <button
                data-testid="eval-run-again-button"
                onClick={() => runEval.mutate()}
                disabled={runEval.isPending}
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              >
                {runEval.isPending ? "Running…" : "Run again"}
              </button>
            }
          />
        </div>
        <div className="p-5">
          {evalr && evalr.strategies ? (
            <>
              <table className="w-full text-left text-sm" data-testid="eval-results-table">
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400">
                    <th className="py-2 pr-4 font-semibold">Strategy</th>
                    <th className="py-2 pr-4 font-semibold">Flagged</th>
                    <th className="py-2 pr-4 font-semibold">True positives</th>
                    <th className="py-2 pr-4 font-semibold">Recall</th>
                    <th className="py-2 pr-4 font-semibold">False positives</th>
                    <th className="py-2 font-semibold">Evidence cited</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {Object.entries(evalr.strategies).map(([name, m]) => (
                    <tr key={name}>
                      <td className="py-2 pr-4 font-medium text-slate-800">{titleize(name)}</td>
                      <td className="py-2 pr-4 font-mono text-slate-600">{m.flagged}</td>
                      <td className="py-2 pr-4 font-mono text-emerald-700">{m.true_positives}</td>
                      <td className="py-2 pr-4 font-mono font-bold text-slate-800">{m.recall != null ? `${(m.recall * 100).toFixed(0)}%` : "—"}</td>
                      <td className="py-2 pr-4 font-mono text-rose-600">{m.false_positives}</td>
                      <td className="py-2 font-mono text-slate-600">{m.evidence_coverage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-slate-500">Planted ground truth: {evalr.planted_records.join(", ")}.</p>
              {evalr.notes?.map((n) => (
                <p key={n.slice(0, 24)} className="mt-1 text-[11px] text-slate-400">{n}</p>
              ))}
            </>
          ) : (
            <EmptyState title="Evaluation never run" hint="Runs the proposed multi-agent detection against a single-model (IsolationForest-only) and a fixed-agent (rules-only) baseline on the synthetic dataset's known ground truth." testid="eval-empty" />
          )}
        </div>
      </div>
    </div>
  );
}
