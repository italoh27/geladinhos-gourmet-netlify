export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path.startsWith("/api/") ? path : `/api${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  if (response.status === 204) return undefined as T;
  const isJson = response.headers.get("content-type")?.includes("application/json");
  if (!isJson) throw new ApiError("A API da loja não respondeu corretamente.", response.status);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error || "Não foi possível concluir.", response.status, data.details);
  return data as T;
}

export function post<T>(path: string, data?: unknown) {
  return api<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data) });
}

export function patch<T>(path: string, data: unknown) {
  return api<T>(path, { method: "PATCH", body: JSON.stringify(data) });
}

export function remove(path: string) {
  return api<void>(path, { method: "DELETE" });
}

export function currency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}

export function dateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
