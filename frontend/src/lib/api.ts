// Typed fetch layer over the FastAPI backend. Base is the relative "/api" prefix so the
// same code works in dev (Vite proxies /api → :8001) and behind a single origin in prod.
const BASE = "/api";

// Demo identity (role switcher) — sent as X-Acting-User-Id; the backend enforces roles.
let actingUserId: string | null = null;
export function setActingUser(id: string | null) {
  actingUserId = id;
}

// Fields are declared, not constructor parameter properties: tsconfig sets
// erasableSyntaxOnly, which rejects `constructor(readonly status: number)`.
export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`request failed with ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  get code(): string | undefined {
    const b = this.body as { error?: { code?: string } } | null;
    return b?.error?.code;
  }

  get message2(): string {
    const b = this.body as { error?: { message?: string } } | null;
    return b?.error?.message ?? this.message;
  }
}

type JsonBody = unknown;

function actorHeaders(actorOverride?: string): Record<string, string> {
  const id = actorOverride ?? actingUserId;
  return id ? { "x-acting-user-id": id } : {};
}

async function request<T>(method: string, path: string, body?: JsonBody, actorOverride?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...actorHeaders(actorOverride),
      ...(body === undefined ? undefined : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // FastAPI reports request-validation failures as 422 with a {detail: [...]} body.
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new ApiError(res.status, errBody);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// The response type is yours to declare: nothing infers across the Python boundary, so a
// TS interface here mirrors the endpoint's Pydantic model by hand — keep the two in sync.
export const apiGet = <T>(path: string, actorOverride?: string) => request<T>("GET", path, undefined, actorOverride);
export const apiPost = <T>(path: string, body?: JsonBody, actorOverride?: string) => request<T>("POST", path, body ?? null, actorOverride);
export const apiPut = <T>(path: string, body?: JsonBody, actorOverride?: string) => request<T>("PUT", path, body ?? null, actorOverride);
export const apiPatch = <T>(path: string, body?: JsonBody, actorOverride?: string) =>
  request<T>("PATCH", path, body ?? null, actorOverride);
export const apiDelete = <T>(path: string) => request<T>("DELETE", path);

export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: actorHeaders(), body: formData });
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new ApiError(res.status, errBody);
  }
  return (await res.json()) as T;
}
