import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Atom, Database, LayoutDashboard, Scale, ScrollText, Settings, ShieldCheck, Sparkles } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiGet } from "@/lib/api";
import { useRole } from "@/components/RoleContext";
import type { Dashboard, Health } from "@/lib/types";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Executive Overview", icon: LayoutDashboard, badge: null as string | null },
  { to: "/data", label: "Data Workspace", icon: Database, badge: null },
  { to: "/ai-intelligence", label: "AI Intelligence", icon: Sparkles, badge: "open_findings" },
  { to: "/decision-studio", label: "Decision Studio", icon: Scale, badge: "pending_decisions" },
  { to: "/quantum-lab", label: "Quantum Lab", icon: Atom, badge: null },
  { to: "/trust-blockchain", label: "Trust & Blockchain", icon: ShieldCheck, badge: null },
  { to: "/audit-viewer", label: "Audit Trail", icon: ScrollText, badge: null },
  { to: "/settings", label: "Settings", icon: Settings, badge: null },
];

const PAGE_TITLES: Record<string, string> = {
  "/": "Executive Overview",
  "/data": "Data Workspace",
  "/ai-intelligence": "AI Intelligence Center",
  "/decision-studio": "Decision Studio",
  "/quantum-lab": "Quantum Lab",
  "/trust-blockchain": "Trust & Blockchain Center",
  "/audit-viewer": "Audit Trail & Compliance",
  "/settings": "Settings & Capability Matrix",
};

export default function AppShell() {
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: () => apiGet<Health>("/health"), refetchInterval: 30_000, retry: false });
  const { data: dashboard } = useQuery({ queryKey: ["dashboard"], queryFn: () => apiGet<Dashboard>("/dashboard"), refetchInterval: 15_000, retry: false });
  const { users, actor, setActorId } = useRole();
  const location = useLocation();

  const caps = health?.capabilities;
  const badgeValue = (key: string | null) => (key && dashboard ? dashboard[key as keyof Dashboard] as number : undefined);

  return (
    <div className="min-h-svh bg-slate-50">
      {/* Layer 1 — persistent dark telemetry sidebar */}
      <aside data-testid="app-sidebar" className="fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-slate-900 text-slate-100">
        <div className="border-b border-slate-800 px-5 py-5">
          <p className="text-lg font-extrabold tracking-tight text-white">
            ZaYoTm<span className="text-sky-400">™</span>
          </p>
          <p className="mt-0.5 text-[11px] font-medium tracking-wide text-slate-400">Universal Enterprise Intelligence &amp; Trust Platform</p>
          <p className="mt-2 inline-flex rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">prototype v{health?.version.replace("-prototype", "") ?? "0.9"}</p>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              data-testid={`nav-${item.label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
              className={({ isActive }) =>
                cn(
                  "flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive ? "bg-slate-800 text-sky-400" : "text-slate-300 hover:bg-slate-800/60 hover:text-white",
                )
              }
            >
              <span className="flex items-center gap-2.5">
                <item.icon className="h-4 w-4" />
                {item.label}
              </span>
              {item.badge && Number(badgeValue(item.badge)) > 0 && (
                <span className="rounded-full bg-slate-700 px-1.5 py-0.5 font-mono text-[10px] text-slate-200">{badgeValue(item.badge)}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-800 px-5 py-3 text-[10px] leading-relaxed text-slate-500">
          Demo prototype — implemented, simulated and planned capabilities are labeled throughout. No production certification.
        </div>
      </aside>

      {/* Top bar — capability badges + demo identity switcher */}
      <div className="ml-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white px-8">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-bold tracking-tight text-slate-900">{PAGE_TITLES[location.pathname] ?? "ZaYoTm™"}</h1>
          </div>
          <div className="flex items-center gap-2">
            <span data-testid="capability-badge-quantum" className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-800">
              Quantum: {caps ? (caps.quantum.engine.includes("qiskit") ? "Qiskit Aer Simulator" : caps.quantum.engine) : "…"}
            </span>
            <span data-testid="capability-badge-llm" className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-semibold text-violet-800">
              LLM: {caps ? (caps.llm.available ? "Connected" : "Fallback") : "…"}
            </span>
            <span data-testid="capability-badge-ledger" className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
              Ledger: Dev Simulation
            </span>
            <div className="ml-2 w-56" data-testid="role-switcher">
              <Select value={actor?.id ?? ""} onValueChange={setActorId}>
                <SelectTrigger className="h-9 w-full" data-testid="role-switcher-trigger">
                  <SelectValue>{actor ? `${actor.name} · ${actor.title}` : "Select identity"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id} data-testid={`role-option-${u.role}`}>
                      {u.name} — {u.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1440px] px-8 py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
