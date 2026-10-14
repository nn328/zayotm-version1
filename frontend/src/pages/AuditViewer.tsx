import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { apiGet } from "@/lib/api";
import type { AuditEvent } from "@/lib/types";
import { EmptyState, SectionTitle } from "@/components/common/ui-bits";
import { fmtDateTime, titleize } from "@/lib/format";

const ACTION_STYLES: Record<string, string> = {
  "approval.approve": "bg-emerald-100 text-emerald-800",
  "approval.reject": "bg-rose-100 text-rose-800",
  "approval.revise": "bg-amber-100 text-amber-800",
  "record.verification_failed": "bg-rose-100 text-rose-800",
  "record.verified": "bg-emerald-100 text-emerald-800",
  "record.tamper_test": "bg-rose-100 text-rose-800",
};

export default function AuditViewer() {
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [q, setQ] = useState("");

  const { data: events = [] } = useQuery({
    queryKey: ["audit", action, actor, q],
    queryFn: () => apiGet<AuditEvent[]>(`/audit?action=${encodeURIComponent(action)}&actor=${encodeURIComponent(actor)}&q=${encodeURIComponent(q)}`),
    refetchInterval: 15_000,
    retry: false,
  });

  function exportJson() {
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `zayotm-audit-${new Date().toISOString().slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4" data-testid="audit-page">
      <SectionTitle
        overline="Layer 5 · audit trail"
        title="Chronological workflow events — every consequential action is recorded"
        testid="audit-title"
        right={
          <button data-testid="audit-export-button" onClick={exportJson} className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            <Download className="h-3.5 w-3.5" /> Export JSON
          </button>
        }
      />

      <div className="flex flex-wrap gap-3" data-testid="audit-filters">
        <input data-testid="audit-filter-action" value={action} onChange={(e) => setAction(e.target.value)} placeholder="Filter by action (e.g. approval, record)" className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <input data-testid="audit-filter-actor" value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Filter by actor" className="w-48 rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <input data-testid="audit-filter-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search summaries…" className="w-72 rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </div>

      {events.length === 0 ? (
        <EmptyState title="No audit events match" hint="Events appear as workflows run, decisions are approved, records are hashed, and ledger anchors are written." testid="audit-empty" />
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm" data-testid="audit-table">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
                <th className="px-5 py-2.5 font-semibold">Timestamp</th>
                <th className="px-3 py-2.5 font-semibold">Actor</th>
                <th className="px-3 py-2.5 font-semibold">Action</th>
                <th className="px-3 py-2.5 font-semibold">Entity</th>
                <th className="px-5 py-2.5 font-semibold">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {events.map((e) => (
                <tr key={e.id} className="align-top hover:bg-slate-50">
                  <td className="whitespace-nowrap px-5 py-2.5 font-mono text-[11px] text-slate-500">{fmtDateTime(e.ts)}</td>
                  <td className="px-3 py-2.5 text-xs">
                    <p className="font-semibold text-slate-700">{e.actor}</p>
                    <p className="text-[10px] uppercase tracking-wider text-slate-400">{titleize(e.actor_role)}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${ACTION_STYLES[e.action] ?? "bg-slate-100 text-slate-600"}`} data-testid={`audit-action-${e.action}`}>
                      {e.action}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-slate-500">
                    {e.entity_type}
                    <br />
                    <span className="text-slate-400">{e.entity_id.slice(0, 10)}</span>
                  </td>
                  <td className="px-5 py-2.5 text-xs leading-relaxed text-slate-600">{e.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
