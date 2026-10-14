import { createContext, useContext, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, setActingUser } from "@/lib/api";
import type { DemoUser } from "@/lib/types";

interface RoleContextValue {
  users: DemoUser[];
  actor: DemoUser | null;
  actorId: string | null;
  setActorId: (id: string) => void;
  can: (permission: "run" | "approve" | "configure") => boolean;
}

const RoleContext = createContext<RoleContextValue>({
  users: [],
  actor: null,
  actorId: null,
  setActorId: () => {},
  can: () => false,
});

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const { data: users = [] } = useQuery({
    queryKey: ["identity-users"],
    queryFn: () => apiGet<DemoUser[]>("/identity/users"),
    retry: false,
    refetchInterval: 60_000,
  });
  const [actorId, setActorIdState] = useState<string | null>(() => localStorage.getItem("zayotm.actor"));

  // default to the executive identity; fall back to the first user returned
  useEffect(() => {
    if (!users.length) return;
    if (!actorId || !users.some((u) => u.id === actorId)) {
      const preferred = users.find((u) => u.role === "executive") ?? users[0];
      setActorIdState(preferred.id);
    }
  }, [users, actorId]);

  useEffect(() => {
    setActingUser(actorId);
    if (actorId) localStorage.setItem("zayotm.actor", actorId);
  }, [actorId]);

  const actor = users.find((u) => u.id === actorId) ?? null;
  const can = (permission: "run" | "approve" | "configure") => Boolean(actor?.permissions?.[permission]);

  return (
    <RoleContext.Provider value={{ users, actor, actorId, setActorId: setActorIdState, can }}>{children}</RoleContext.Provider>
  );
}

export function useRole() {
  return useContext(RoleContext);
}
