import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { apiGet, apiPost, ApiError } from "@/lib/api";
import type { CaseSummary, DecisionRecord, LedgerState, TamperTest, VerifyResult } from "@/lib/types";
import { EmptyState, HashText, JsonViewer, SectionTitle, SimulationBadge } from "@/components/common/ui-bits";
import { fmtDateTime, shortHash } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function TrustCenter() {
  const qc = useQueryClient();
  const { data: records = [] } = useQuery({ queryKey: ["trust-records"], queryFn: () => apiGet<DecisionRecord[]>("/trust/records"), refetchInterval: 20_000, retry: false });
  const { data: ledger } = useQuery({ queryKey: ["ledger"], queryFn: () => apiGet<LedgerState>("/trust/ledger"), refetchInterval: 20_000, retry: false });
  const { data: contract } = useQuery({ queryKey: ["contract-source"], queryFn: () => apiGet<{ source: string; note: string }>("/trust/contract-source"), retry: false });
  const { data: cases = [] } = useQuery({ queryKey: ["cases"], queryFn: () => apiGet<CaseSummary[]>("/cases"), retry: false });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const recordId = selectedId ?? records[0]?.id ?? null;
  const record = records.find((r) => r.id === recordId) ?? null;
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [tamperResult, setTamperResult] = useState<TamperTest | null>(null);
  const [contractOpen, setContractOpen] = useState(false);

  const approvedCases = cases.filter((c) => c.status === "approved");

  const verify = useMutation({
    mutationFn: () => apiPost<VerifyResult>(`/trust/records/${recordId}/verify`),
    onSuccess: (r) => {
      setVerifyResult(r);
      setTamperResult(null);
      toast[r.match ? "success" : "error"](r.match ? `Integrity verified — ${r.decision_id} unchanged.` : `VERIFICATION FAILED — ${r.decision_id} does not match its hash!`);
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message2 : "Verification failed to run"),
  });

  const anchor = useMutation({
    mutationFn: () => apiPost<DecisionRecord>(`/trust/records/${recordId}/anchor`),
    onSuccess: (r) => {
      toast.success(`Anchored — tx ${shortHash(r.anchored?.tx_hash ?? "", 10)} (block #${r.anchored?.block_number})`);
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message2 : "Anchoring failed"),
  });

  const tamper = useMutation({
    mutationFn: () => apiPost<TamperTest>(`/trust/records/${recordId}/tamper-test`),
    onSuccess: (r) => {
      setTamperResult(r);
      setVerifyResult(null);
      toast.error("Tamper test: altered copy produced a DIFFERENT hash — tampering detected.");
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message2 : "Tamper test failed to run"),
  });

  return (
    <div className="space-y-6" data-testid="trust-page">
      {/* ledger explorer */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 shadow-sm" data-testid="ledger-explorer">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <SectionTitle overline="Layer 5 · trust" title="Ledger anchoring" testid="ledger-title" />
            <p className="text-xs text-slate-600">
              Mode: <strong>{ledger?.mode ?? "…"}</strong> · adapter <span className="font-mono">{ledger?.adapter}</span> · height <span className="font-mono font-bold">{ledger?.height ?? 0}</span>
            </p>
            <p className="mt-1 max-w-2xl text-[11px] text-slate-500">{ledger?.note}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <SimulationBadge label={ledger?.simulated ? "Dev simulation — NOT a real chain" : "Real chain"} />
            <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", ledger?.besu?.configured ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-slate-100 text-slate-600 ring-1 ring-slate-200")} data-testid="besu-status">
              Besu adapter: {ledger?.besu?.configured ? "configured" : "not configured (env vars)"}
            </span>
          </div>
        </div>
        {ledger?.transactions?.length ? (
          <table className="mt-4 w-full text-left text-xs" data-testid="ledger-tx-table">
            <thead>
              <tr className="border-b border-slate-300 text-[10px] uppercase tracking-wider text-slate-400">
                <th className="py-2 pr-4 font-semibold">Block</th>
                <th className="py-2 pr-4 font-semibold">Tx hash</th>
                <th className="py-2 pr-4 font-semibold">Decision</th>
                <th className="py-2 pr-4 font-semibold">Record hash</th>
                <th className="py-2 font-semibold">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {ledger.transactions.map((t) => (
                <tr key={t.tx_hash}>
                  <td className="py-1.5 pr-4 font-mono font-bold">#{t.block_number}</td>
                  <td className="py-1.5 pr-4"><HashText hash={t.tx_hash} keep={16} /></td>
                  <td className="py-1.5 pr-4 font-mono text-slate-600">{t.decision_id}</td>
                  <td className="py-1.5 pr-4"><HashText hash={t.record_hash} keep={12} /></td>
                  <td className="py-2 text-slate-400">{fmtDateTime(t.anchored_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-3 text-xs text-slate-500" data-testid="ledger-no-tx">No transactions yet — anchor a verified decision record.</p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* records list */}
        <div className="space-y-2" data-testid="record-list">
          {approvedCases.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-testid="create-record-panel">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">New record from an approved case</p>
              <div className="mt-2 space-y-2">
                {approvedCases.slice(0, 3).map((c) => (
                  <button
                    key={c.id}
                    data-testid={`create-record-${c.id}`}
                    onClick={async () => {
                      try {
                        const r = await apiPost<DecisionRecord>("/trust/records", { case_id: c.id });
                        toast.success(`Decision record ${r.decision_id} created`);
                        void qc.invalidateQueries();
                        setSelectedId(r.id);
                      } catch (e) {
                        toast.error(e instanceof ApiError ? e.message2 : "Failed to create record");
                      }
                    }}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {c.title.slice(0, 44)}… → hash &amp; record
                  </button>
                ))}
              </div>
            </div>
          )}
          {records.length === 0 && <EmptyState title="No decision records" hint="Approve a case in the Decision Studio, then create its cryptographic record here." testid="records-empty" />}
          {records.map((r) => (
            <button
              key={r.id}
              data-testid={`record-item-${r.id}`}
              onClick={() => {
                setSelectedId(r.id);
                setVerifyResult(null);
                setTamperResult(null);
              }}
              className={cn(
                "w-full rounded-lg border p-3 text-left transition-colors",
                recordId === r.id ? "border-sky-300 bg-sky-50 ring-1 ring-sky-200" : "border-slate-200 bg-white hover:border-slate-300",
              )}
            >
              <div className="flex items-center justify-between">
                <p className="font-mono text-xs font-bold text-slate-800">{r.decision_id}</p>
                {r.last_verification && (r.last_verification.match ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : <ShieldAlert className="h-4 w-4 text-rose-600" />)}
              </div>
              <p className="mt-1 font-mono text-[11px] text-slate-500">{shortHash(r.hash, 20)}</p>
              <p className="mt-1 text-[11px] text-slate-400">
                {r.anchored ? (r.anchored.simulated ? "anchored (simulated ledger)" : "anchored (real chain)") : "not anchored"} · {fmtDateTime(r.created_at)}
              </p>
            </button>
          ))}
        </div>

        {/* record detail */}
        {record && (
          <div className="space-y-4" data-testid="record-detail">
            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
                <div>
                  <p className="font-mono text-sm font-extrabold text-slate-900">{record.decision_id}</p>
                  <p className="text-[11px] text-slate-500">{record.algorithm}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button data-testid="verify-record-button" onClick={() => verify.mutate()} disabled={verify.isPending} className="rounded-md bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-50">
                    {verify.isPending ? "Verifying…" : "Verify integrity"}
                  </button>
                  <button data-testid="anchor-record-button" onClick={() => anchor.mutate()} disabled={anchor.isPending || Boolean(record.anchored)} className="rounded-md bg-sky-700 px-3 py-2 text-xs font-bold text-white hover:bg-sky-800 disabled:opacity-50">
                    {record.anchored ? "Anchored ✓" : anchor.isPending ? "Anchoring…" : "Anchor to ledger"}
                  </button>
                  <button data-testid="tamper-test-trigger" onClick={() => tamper.mutate()} disabled={tamper.isPending} className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50">
                    {tamper.isPending ? "Tampering…" : "Tamper test"}
                  </button>
                </div>
              </div>

              <div className="space-y-4 p-5">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">SHA-256 record hash</p>
                  <div className="mt-1"><HashText hash={record.hash} keep={64} className="text-[13px]" /></div>
                </div>

                {verifyResult && (
                  <div data-testid="verify-result" className={cn("rounded-lg border p-4", verifyResult.match ? "border-emerald-300 bg-emerald-50" : "border-rose-300 bg-rose-50")}>
                    <p className={cn("text-sm font-extrabold", verifyResult.match ? "text-emerald-800" : "text-rose-800")}>
                      {verifyResult.match ? "PASS — recomputed hash matches the stored record. No alteration detected." : "FAIL — recomputed hash differs. The record was modified after hashing."}
                    </p>
                    <div className="mt-2 space-y-1 font-mono text-[11px] text-slate-600">
                      <p>stored:     {verifyResult.stored_hash}</p>
                      <p>recomputed: {verifyResult.recomputed_hash}</p>
                    </div>
                  </div>
                )}

                {tamperResult && (
                  <div data-testid="tamper-result" className="rounded-lg border border-rose-300 bg-rose-50 p-4">
                    <p className="text-sm font-extrabold text-rose-800">Tamper test: {tamperResult.detected ? "TAMPERING DETECTED" : "not detected (unexpected)"}</p>
                    <p className="mt-1 text-xs text-rose-700">
                      Field mutated on a copy: <span className="font-mono">{tamperResult.mutated_field}</span>. Recomputed hash {shortHash(tamperResult.tampered_hash, 12)} ≠ stored {shortHash(tamperResult.original_hash, 12)}.
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">{tamperResult.note}</p>
                  </div>
                )}

                {record.anchored && (
                  <div className="rounded-lg border border-amber-300 bg-yellow-50 p-4" data-testid="anchor-result">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-extrabold text-amber-900">Anchored → {record.anchored.mode}</p>
                      <SimulationBadge label={record.anchored.simulated ? "SIMULATED tx" : "REAL tx"} />
                    </div>
                    <div className="mt-2 grid gap-1 font-mono text-[11px] text-slate-700 sm:grid-cols-2">
                      <p>tx_hash: {shortHash(record.anchored.tx_hash, 22)}</p>
                      <p>block: #{record.anchored.block_number}</p>
                      <p>network: {record.anchored.network}</p>
                      <p>contract: {shortHash(record.anchored.contract_address, 14)}</p>
                      <p>event: {record.anchored.event.slice(0, 46)}…</p>
                      <p>confirmations: {record.anchored.confirmations}</p>
                    </div>
                    <p className="mt-2 text-[11px] text-amber-800">
                      Only the decision ID and record hash are anchored — never business records, PII, or documents. A simulated transaction is never presented as a real one.
                    </p>
                  </div>
                )}

                {record.tamper_tests.length > 0 && (
                  <p className="text-[11px] text-slate-500" data-testid="tamper-history-note">
                    {record.tamper_tests.length} tamper test(s) recorded — all ran on in-memory copies; the stored record was never modified.
                  </p>
                )}

                <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Canonical record (exact hash input)</p>
                  <div className="mt-2"><JsonViewer data={record.canonical} label="canonical JSON" testid="canonical-json-toggle" /></div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] font-semibold text-sky-700">Show raw canonical bytes</summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded bg-slate-900 p-3 font-mono text-[10px] text-slate-100" data-testid="canonical-raw">{record.canonical_text}</pre>
                  </details>
                </div>

                <div className="rounded-lg border border-slate-200 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Trust boundary</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Blockchain establishes tamper-evident provenance for anchored records. It does <strong>not</strong> prove the source data was truthful
                    or that the AI recommendation was correct. Zero-knowledge proofs are a future extension (interface only — no ZKP implemented).
                  </p>
                  <Link to="/audit-viewer" className="mt-2 inline-block text-xs font-semibold text-sky-700 hover:text-sky-900" data-testid="trust-audit-link">
                    Inspect full audit history →
                  </Link>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <button data-testid="contract-source-toggle" onClick={() => setContractOpen(!contractOpen)} className="flex w-full items-center justify-between px-5 py-3 text-left">
                <div>
                  <p className="text-sm font-bold text-slate-900">Reference smart contract (Solidity)</p>
                  <p className="text-xs text-slate-500">{contract?.note}</p>
                </div>
                <span className="text-xs font-semibold text-sky-700">{contractOpen ? "Hide" : "Show"} source</span>
              </button>
              {contractOpen && (
                <pre className="mx-5 mb-5 max-h-80 overflow-auto rounded-md bg-slate-900 p-4 font-mono text-[10px] leading-relaxed text-sky-200" data-testid="contract-source">{contract?.source}</pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
