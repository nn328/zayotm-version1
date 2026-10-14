import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Database, FileUp } from "lucide-react";
import { apiGet, apiPost, apiUpload, ApiError } from "@/lib/api";
import type { Dataset, DatasetRow, Finding } from "@/lib/types";
import { EmptyState, SeverityBadge, SectionTitle, StatusPill } from "@/components/common/ui-bits";
import { fmtDateTime, titleize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const KIND_STYLES: Record<string, string> = {
  anomaly: "bg-violet-100 text-violet-800",
  rule_violation: "bg-rose-100 text-rose-800",
  conflict: "bg-amber-100 text-amber-800",
  duplicate: "bg-orange-100 text-orange-800",
};

export default function DataWorkspace() {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const { data: datasets = [] } = useQuery({ queryKey: ["datasets"], queryFn: () => apiGet<Dataset[]>("/datasets"), refetchInterval: 20_000, retry: false });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const datasetId = selectedId ?? datasets[0]?.id ?? null;

  const { data: detail } = useQuery({
    queryKey: ["dataset", datasetId],
    queryFn: () => apiGet<Dataset & { sample_rows: DatasetRow[] }>(`/datasets/${datasetId}`),
    enabled: Boolean(datasetId),
    retry: false,
  });
  const { data: findings = [] } = useQuery({
    queryKey: ["dataset-findings", datasetId],
    queryFn: () => apiGet<Finding[]>(`/datasets/${datasetId}/findings`),
    enabled: Boolean(datasetId),
    retry: false,
  });

  const loadSample = useMutation({
    mutationFn: () => apiPost<Dataset>("/datasets/load-sample"),
    onSuccess: (ds) => {
      toast.success(`Sample dataset loaded — ${ds.total_rows} rows, quality ${ds.quality_score}/100`);
      void qc.invalidateQueries({ queryKey: ["datasets"] });
      setSelectedId(ds.id);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message2 : "Failed to load sample dataset"),
  });

  const upload = useMutation({
    mutationFn: (files: FileList) => {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("files", f));
      return apiUpload<Dataset & { notes?: string[] }>("/datasets/upload", fd);
    },
    onSuccess: (ds) => {
      toast.success(`Uploaded "${ds.name}" — ${ds.total_rows} rows ingested`);
      if (ds.notes?.length) toast.info(ds.notes.join(" · "));
      void qc.invalidateQueries({ queryKey: ["datasets"] });
      setSelectedId(ds.id);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message2 : "Upload failed"),
  });

  return (
    <div className="space-y-6" data-testid="data-workspace-page">
      <div className="flex flex-wrap items-center gap-3">
        <button
          data-testid="load-sample-dataset-button"
          onClick={() => loadSample.mutate()}
          disabled={loadSample.isPending}
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          <Database className="h-4 w-4" /> {loadSample.isPending ? "Loading…" : "Load sample dataset"}
        </button>
        <button
          data-testid="upload-csv-button"
          onClick={() => fileInput.current?.click()}
          disabled={upload.isPending}
          className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <FileUp className="h-4 w-4" /> {upload.isPending ? "Uploading…" : "Upload CSV"}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv"
          multiple
          hidden
          data-testid="upload-csv-input"
          onChange={(e) => {
            if (e.target.files?.length) upload.mutate(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="text-xs text-slate-500">Sample data is synthetic. Uploads stay under 5 MB / 5,000 rows per file in this prototype.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* dataset list */}
        <div className="space-y-2" data-testid="dataset-list">
          {datasets.length === 0 && <EmptyState title="No datasets yet" hint="Load the bundled sample or upload a CSV." testid="datasets-empty" />}
          {datasets.map((d) => (
            <button
              key={d.id}
              data-testid={`dataset-item-${d.id}`}
              onClick={() => setSelectedId(d.id)}
              className={cn(
                "w-full rounded-lg border p-3 text-left transition-colors",
                datasetId === d.id ? "border-sky-300 bg-sky-50 ring-1 ring-sky-200" : "border-slate-200 bg-white hover:border-slate-300",
              )}
            >
              <p className="truncate text-sm font-semibold text-slate-800">{d.name}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {d.source === "sample" ? "Bundled sample" : "Uploaded"} · {d.total_rows} rows · quality {d.quality_score}/100
              </p>
              {d.created_at && <p className="mt-0.5 text-[11px] text-slate-400">{fmtDateTime(d.created_at)}</p>}
            </button>
          ))}
        </div>

        {/* dataset detail */}
        <div className="space-y-6">
          {detail && (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-testid="quality-cards">
                {detail.files.map((f) => (
                  <div key={f.file} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <p className="font-mono text-xs font-bold text-slate-800">{f.file}.csv</p>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{f.row_count} rows</span>
                    </div>
                    <div className="mt-2 flex items-end gap-1">
                      <span className="text-3xl font-extrabold tracking-tight text-slate-900">{f.quality.score}</span>
                      <span className="pb-1 text-xs text-slate-400">/100 quality</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${f.quality.score >= 90 ? "bg-emerald-500" : f.quality.score >= 70 ? "bg-amber-500" : "bg-rose-500"}`}
                        style={{ width: `${f.quality.score}%` }}
                      />
                    </div>
                    <ul className="mt-2 space-y-0.5 text-[11px] leading-relaxed text-slate-500">
                      {f.quality.issues.length ? f.quality.issues.map((i) => <li key={i}>· {i}</li>) : <li>· no issues detected</li>}
                    </ul>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white shadow-sm" data-testid="schema-preview">
                <div className="border-b border-slate-200 px-5 py-3">
                  <h3 className="text-sm font-bold text-slate-900">Schema &amp; data-quality profile</h3>
                  <p className="text-xs text-slate-500">Types inferred by the Data Understanding Engine; lineage preserved per row.</p>
                </div>
                <Tabs defaultValue={detail.files[0]?.file}>
                  <TabsList className="mx-5 mt-3">
                    {detail.files.map((f) => (
                      <TabsTrigger key={f.file} value={f.file} data-testid={`schema-tab-${f.file}`}>
                        {f.file}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {detail.files.map((f) => (
                    <TabsContent key={f.file} value={f.file} className="px-5 pb-5">
                      <table className="w-full text-left text-xs" data-testid={`schema-table-${f.file}`}>
                        <thead>
                          <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400">
                            <th className="py-2 pr-4 font-semibold">Column</th>
                            <th className="py-2 pr-4 font-semibold">Inferred type</th>
                            <th className="py-2 pr-4 font-semibold">Missing</th>
                            <th className="py-2 pr-4 font-semibold">Distinct</th>
                            <th className="py-2 font-semibold">Samples</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {f.columns.map((c) => (
                            <tr key={c.name}>
                              <td className="py-1.5 pr-4 font-mono font-semibold text-slate-700">{c.name}</td>
                              <td className="py-1.5 pr-4 text-slate-500">{c.inferred_type}</td>
                              <td className="py-1.5 pr-4">
                                <span className={c.missing > 0 ? "font-semibold text-rose-600" : "text-slate-500"}>
                                  {c.missing} ({c.missing_pct}%)
                                </span>
                              </td>
                              <td className="py-1.5 pr-4 text-slate-500">{c.distinct}</td>
                              <td className="py-1.5 max-w-[240px] truncate font-mono text-slate-400">{c.samples.join(", ")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TabsContent>
                  ))}
                </Tabs>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white shadow-sm" data-testid="sample-rows">
                <div className="border-b border-slate-200 px-5 py-3">
                  <h3 className="text-sm font-bold text-slate-900">Row inspector</h3>
                  <p className="text-xs text-slate-500">First rows exactly as ingested (raw strings — source fidelity).</p>
                </div>
                <Tabs defaultValue={detail.files[0]?.file}>
                  <TabsList className="mx-5 mt-3">
                    {detail.files.map((f) => (
                      <TabsTrigger key={f.file} value={f.file} data-testid={`rows-tab-${f.file}`}>
                        {f.file} ({f.row_count})
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {detail.files.map((f) => {
                    const rows = detail.sample_rows.filter((r) => r.source_file === f.file).slice(0, 10);
                    const cols = f.columns.slice(0, 9).map((c) => c.name);
                    return (
                      <TabsContent key={f.file} value={f.file} className="px-5 pb-5">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs" data-testid={`rows-table-${f.file}`}>
                            <thead>
                              <tr className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400">
                                <th className="py-2 pr-3 font-semibold">#</th>
                                {cols.map((c) => (
                                  <th key={c} className="py-2 pr-3 font-mono font-semibold">{c}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {rows.map((r) => (
                                <tr key={r.id} className="hover:bg-slate-50">
                                  <td className="py-1.5 pr-3 text-slate-400">{r.row_number}</td>
                                  {cols.map((c) => (
                                    <td key={c} className="py-1.5 pr-3 font-mono text-slate-600">
                                      {(r.data[c] ?? "").toString().slice(0, 28) || <span className="text-rose-400">∅</span>}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </TabsContent>
                    );
                  })}
                </Tabs>
              </div>
            </>
          )}

          {/* findings */}
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm" data-testid="dataset-findings">
            <div className="border-b border-slate-200 px-5 py-3">
              <SectionTitle overline="Validation output" title="Data-quality findings & violations" testid="findings-title" />
            </div>
            {findings.length ? (
              <ul className="divide-y divide-slate-100">
                {findings.slice(0, 20).map((f) => (
                  <li key={f.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", KIND_STYLES[f.kind] ?? "bg-slate-100 text-slate-600")}>
                        {titleize(f.kind)}
                      </span>
                      <SeverityBadge severity={f.severity} />
                      {f.rule_id && <span className="font-mono text-[11px] font-bold text-slate-700">{f.rule_id}</span>}
                      {f.engine === "isolation_forest" && f.score != null && (
                        <span className="font-mono text-[10px] text-violet-700">IF score {f.score.toFixed(2)}</span>
                      )}
                      {f.policy_ref && <span className="text-[10px] font-medium text-sky-700">policy: {f.policy_ref}</span>}
                    </div>
                    <p className="mt-1 text-sm font-semibold text-slate-800">{f.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{f.reason}</p>
                    <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">
                      records: {f.record_ids.join(", ")} · fields: {f.fields.join(", ")}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-5">
                <EmptyState title="No findings yet" hint="Findings appear after the intelligence workflow runs on this dataset." testid="findings-empty" />
                <div className="mt-3 text-center">
                  <StatusPill status="pending" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
