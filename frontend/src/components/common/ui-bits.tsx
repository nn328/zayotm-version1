import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { shortHash, titleize } from "@/lib/format";
import type { EvidenceItem, Uncertainty } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  verified: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
  failed: "bg-rose-50 text-rose-700 border-rose-200",
  "verification_failed": "bg-rose-50 text-rose-700 border-rose-200",
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  in_review: "bg-amber-50 text-amber-700 border-amber-200",
  running: "bg-sky-50 text-sky-700 border-sky-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  "pending_approval": "bg-amber-50 text-amber-700 border-amber-200",
  revision_requested: "bg-orange-50 text-orange-700 border-orange-200",
  "completed_with_errors": "bg-orange-50 text-orange-700 border-orange-200",
  simulated: "bg-yellow-50 text-yellow-800 border-yellow-300",
};

export function StatusPill({ status, className }: { status: string; className?: string }) {
  return (
    <span
      data-testid={`status-pill-${status}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold tracking-wide",
        STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600 border-slate-200",
        className,
      )}
    >
      {titleize(status)}
    </span>
  );
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-rose-100 text-rose-800",
  high: "bg-orange-100 text-orange-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-slate-100 text-slate-600",
};

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", SEVERITY_STYLES[severity] ?? "bg-slate-100 text-slate-600")}>
      {severity}
    </span>
  );
}

export function SimulationBadge({ label = "Simulated" }: { label?: string }) {
  return (
    <span data-testid="simulation-badge" className="inline-flex items-center gap-1 rounded-full border border-yellow-300 bg-yellow-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-yellow-800">
      {label}
    </span>
  );
}

export function MetricCard({ label, value, sub, tone = "slate" }: { label: string; value: string | number; sub?: string; tone?: "slate" | "emerald" | "amber" | "sky" | "violet" | "rose" }) {
  const tones: Record<string, string> = {
    slate: "text-slate-900",
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    sky: "text-sky-600",
    violet: "text-violet-600",
    rose: "text-rose-600",
  };
  return (
    <Card size="sm" className="shadow-none" data-testid={`metric-card-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <CardContent className="pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
        <p className={cn("mt-1 text-2xl font-bold tracking-tight", tones[tone])}>{value}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export function HashText({ hash, keep = 18, className }: { hash: string; keep?: number; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      data-testid="hash-text-copy"
      className={cn("group inline-flex items-center gap-1.5 rounded bg-slate-50 px-1.5 py-0.5 font-mono text-xs text-slate-800 ring-1 ring-slate-200 transition-colors hover:bg-slate-100", className)}
      onClick={() => {
        navigator.clipboard?.writeText(hash);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      title={hash}
    >
      <span className="break-all">{shortHash(hash, keep)}</span>
      {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3 text-slate-400 group-hover:text-slate-600" />}
    </button>
  );
}

export function SectionTitle({ overline, title, right, testid }: { overline?: string; title: string; right?: React.ReactNode; testid?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        {overline && <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-sky-700">{overline}</p>}
        <h2 data-testid={testid} className="text-lg font-bold tracking-tight text-slate-900">
          {title}
        </h2>
      </div>
      {right}
    </div>
  );
}

export function EmptyState({ title, hint, testid }: { title: string; hint?: string; testid?: string }) {
  return (
    <div data-testid={testid} className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center">
      <p className="text-sm font-semibold text-slate-600">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function UncertaintyGauge({ unc, testid }: { unc: Uncertainty; testid?: string }) {
  const bandColor = unc.band === "high" ? "bg-rose-500" : unc.band === "medium" ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div data-testid={testid} className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Uncertainty (composite of measurable signals)</p>
        <Badge variant={unc.band === "high" ? "destructive" : "secondary"} data-testid={`uncertainty-band-${unc.band}`}>
          {unc.band} · {unc.score}/100
        </Badge>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={cn("h-full rounded-full transition-all", bandColor)} style={{ width: `${Math.min(100, unc.score)}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
        {Object.entries(unc.components).map(([k, v]) => (
          <div key={k} className="text-xs text-slate-600">
            <span className="font-medium">{titleize(k)}</span> <span className="font-mono text-slate-500">{Math.round(v * 100)}%</span>
          </div>
        ))}
      </div>
      {unc.escalation_required && (
        <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
          Escalation: human approval mandatory (score ≥ threshold {unc.threshold}).
        </p>
      )}
    </div>
  );
}

export function EvidenceList({ evidence, emptyHint }: { evidence: EvidenceItem[]; emptyHint?: string }) {
  if (!evidence.length) return <EmptyState title="No evidence retrieved" hint={emptyHint ?? "The engine does not invent evidence when retrieval returns nothing."} testid="evidence-empty" />;
  return (
    <ul className="space-y-2" data-testid="evidence-list">
      {evidence.map((e, i) => (
        <li key={`${e.doc_id}-${e.section}-${i}`} className="rounded-md border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold text-slate-800">
              {e.title} <span className="font-normal text-slate-500">· {e.section}</span>
            </p>
            <Badge variant="outline" className="font-mono text-[10px]">
              score {e.score.toFixed(2)}
            </Badge>
          </div>
          <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-slate-600">{e.snippet}</p>
          {e.linked_finding && <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-violet-700">linked: {e.linked_finding}</p>}
        </li>
      ))}
    </ul>
  );
}

export function JsonViewer({ data, label = "JSON", testid }: { data: unknown; label?: string; testid?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={testid}>
      <button
        data-testid="json-viewer-toggle"
        onClick={() => setOpen(!open)}
        className="text-xs font-semibold text-sky-700 underline decoration-dotted underline-offset-2 hover:text-sky-900"
      >
        {open ? "Hide" : "Show"} {label}
      </button>
      {open && (
        <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-100" data-testid="json-viewer-content">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

export { Card, CardContent, CardHeader, CardTitle };
