import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { apiGet, apiPost, apiPut, ApiError } from "@/lib/api";
import type { EvalResult, Health, SettingsModel as SettingsType } from "@/lib/types";
import { useRole } from "@/components/RoleContext";
import { EmptyState, SectionTitle, SimulationBadge } from "@/components/common/ui-bits";

export default function SettingsPage() {
  const qc = useQueryClient();
  const { can } = useRole();
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: () => apiGet<Health>("/health"), retry: false, refetchInterval: 30_000 });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: () => apiGet<SettingsType>("/settings"), retry: false });
  const { data: evalr, refetch: refetchEval } = useQuery({ queryKey: ["eval-latest"], queryFn: () => apiGet<EvalResult>("/eval/latest"), retry: false });
  const [form, setForm] = useState<SettingsType | null>(null);

  useEffect(() => {
    if (settings && !form) setForm(settings);
  }, [settings, form]);

  const save = useMutation({
    mutationFn: (f: SettingsType) => apiPut<SettingsType>("/settings", { ...f, key: "global", objective_weights: f.objective_weights ?? {} }),
    onSuccess: () => {
      toast.success("Configuration saved — future runs use the new parameters.");
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message2 : "Failed to save settings"),
  });

  const runEval = useMutation({
    mutationFn: () => apiPost<EvalResult>("/eval/run"),
    onSuccess: () => {
      toast.success("Evaluation harness finished.");
      void refetchEval();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message2 : "Evaluation failed"),
  });

  const canConfigure = can("configure");
  const caps = health?.capabilities;

  function num(key: keyof SettingsType, label: string, hint: string, step = 1, testid?: string) {
    if (!form) return null;
    return (
      <label className="block">
        <span className="text-xs font-bold text-slate-700">{label}</span>
        <input
          data-testid={testid ?? `settings-${key}`}
          type="number"
          step={step}
          value={String(form[key])}
          disabled={!canConfigure}
          onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-500"
        />
        <span className="mt-0.5 block text-[11px] text-slate-400">{hint}</span>
      </label>
    );
  }

  return (
    <div className="space-y-6" data-testid="settings-page">
      {/* capability matrix */}
      <div>
        <SectionTitle overline="System configuration" title="Capability matrix — exactly what is available right now" testid="capability-matrix-title" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-testid="capability-cards">
          <div className="rounded-lg border border-violet-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-violet-800">LLM (Reasoning + Explainability)</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{caps?.llm?.available ? "Connected" : "Not configured"}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{caps?.llm?.detail}</p>
            <p className="mt-1 text-[10px] text-slate-400">Fallback: deterministic templates (never fabricates content).</p>
          </div>
          <div className="rounded-lg border border-sky-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-sky-800">Quantum execution</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{caps?.quantum?.engine ?? "…"}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{caps?.quantum?.library}</p>
            <p className="mt-1 text-[10px] text-slate-400">{caps?.quantum?.note}</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-800">Ledger</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{caps?.ledger?.mode ?? "…"}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">Besu adapter: {caps?.ledger?.besu?.configured ? "configured" : "not configured"}</p>
            <p className="mt-1 text-[10px] text-slate-400">{caps?.ledger?.besu?.note}</p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">Classical solver</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{caps?.classical_solver ?? "…"}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">Exact, deterministic baseline for the QAOA comparison.</p>
            <div className="mt-2 space-y-0.5">
              {Object.entries(caps?.versions ?? {}).map(([k, v]) => (
                <p key={k} className="font-mono text-[10px] text-slate-400">{k}: {v ?? "n/a"}</p>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* optimization parameters */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm" data-testid="settings-form-panel">
        <div className="border-b border-slate-200 px-5 py-3">
          <SectionTitle overline="Persisted in MongoDB" title="Optimization & uncertainty parameters" testid="settings-form-title" />
        </div>
        <div className="grid gap-5 p-5 md:grid-cols-3 xl:grid-cols-5">
          {num("uncertainty_threshold", "Uncertainty threshold", "Composite score (0–100) at which the orchestrator escalates to mandatory human review.", 1, "settings-uncertainty-threshold")}
          {num("budget_envelope", "Budget envelope", "Release envelope for the portfolio selection problem (EUR).", 1000, "settings-budget-envelope")}
          {num("contamination", "IsolationForest contamination", "Expected proportion of anomalies (0.01–0.5).", 0.01, "settings-contamination")}
          {num("qaoa_layers", "QAOA depth (p)", "Number of QAOA layers in the ansatz.", 1, "settings-qaoa-layers")}
          {num("qaoa_shots", "QAOA shots", "Shot count for the Aer sampling run.", 128, "settings-qaoa-shots")}
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
          <p className="text-[11px] text-slate-500">
            {canConfigure ? "Your identity (Executive) may change system configuration." : "Your identity cannot change configuration — switch to the Executive in the top bar."}
          </p>
          <button
            data-testid="settings-save-button"
            onClick={() => form && save.mutate(form)}
            disabled={!canConfigure || save.isPending || !form}
            className="rounded-md bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Save configuration"}
          </button>
        </div>
      </div>

      {/* integrations status */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" data-testid="integration-status">
          <SectionTitle overline="Cross-cutting" title="Integration & API status" />
          <ul className="space-y-2 text-xs leading-relaxed text-slate-600">
            <li>· REST API under <span className="font-mono">/api</span> with OpenAPI docs at <a className="font-semibold text-sky-700" href="/api/docs" target="_blank" rel="noreferrer">/api/docs</a></li>
            <li>· Request validation (Pydantic), structured errors, per-IP rate limiting, health checks</li>
            <li>· Role-based authorization enforced server-side (demo identities; production SSO planned)</li>
            <li>· Secrets via environment variables only — never exposed to the frontend</li>
            <li>· MongoDB persistence with deterministic seed data and audit collection</li>
          </ul>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" data-testid="future-capabilities">
          <SectionTitle overline="Honest scope" title="Simulated & planned capabilities" />
          <div className="space-y-2 text-xs leading-relaxed text-slate-600">
            <SimulationBadge label="Simulated in this prototype" />
            <p>Ledger anchoring (dev-simulation ledger, Besu adapter config-ready) · quantum execution on the Aer simulator.</p>
            <p className="font-bold text-slate-700">Planned (not implemented)</p>
            <p>
              Live Besu deployment + contract bytecode, zero-knowledge proofs (interface only), live SAP/Salesforce/Oracle/IoT connectors
              (connector interfaces only), production SSO, calibrated uncertainty on held-out validation data.
            </p>
            <Link to="/trust-blockchain" className="inline-block font-semibold text-sky-700 hover:text-sky-900" data-testid="settings-trust-link">
              Ledger &amp; contract details →
            </Link>
          </div>
        </div>
      </div>

      {/* evaluation */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm" data-testid="settings-eval-panel">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <SectionTitle overline="Evaluation harness" title="Workflow vs baselines (measured, not asserted)" testid="settings-eval-title" />
          <button data-testid="settings-eval-run-button" onClick={() => runEval.mutate()} disabled={runEval.isPending} className="rounded-md border border-violet-300 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-800 hover:bg-violet-100 disabled:opacity-50">
            {runEval.isPending ? "Running…" : "Run evaluation"}
          </button>
        </div>
        <div className="p-5">
          {evalr && evalr.strategies ? (
            <div className="grid gap-3 md:grid-cols-3" data-testid="settings-eval-results">
              {Object.entries(evalr.strategies).map(([name, m]) => (
                <div key={name} className="rounded-lg border border-slate-200 p-4">
                  <p className="text-xs font-bold text-slate-800">{name.replace(/_/g, " ")}</p>
                  <p className="mt-1 font-mono text-2xl font-extrabold text-slate-900">{m.recall != null ? `${(m.recall * 100).toFixed(0)}%` : "—"}</p>
                  <p className="text-[11px] text-slate-500">recall · {m.true_positives}/{evalr.planted_records.length} planted · {m.false_positives} FP</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="Evaluation never run" hint="Compares the proposed multi-agent workflow against single-model and fixed-agent baselines on the planted ground truth." testid="settings-eval-empty" />
          )}
        </div>
      </div>
    </div>
  );
}
