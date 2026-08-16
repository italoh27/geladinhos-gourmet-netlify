export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

export function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...securityHeaders, ...(init.headers || {}) },
  });
}

export function noContent(headers: HeadersInit = {}) {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function body<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) throw new HttpError(415, "Envie os dados em JSON.");
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "Os dados enviados são inválidos.");
  }
}

export function only(request: Request, ...methods: string[]) {
  if (!methods.includes(request.method)) throw new HttpError(405, "Método não permitido.");
}

export function safeError(error: unknown) {
  if (error instanceof HttpError) return json({ error: error.message, details: error.details }, { status: error.status });
  console.error(error);
  return json({ error: "Não foi possível concluir agora. Tente novamente." }, { status: 500 });
}

export function cleanText(value: unknown, max = 200) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

export function normalizePhone(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) throw new HttpError(400, "Informe um telefone válido.");
  return digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
}

export function normalizeEmail(value: unknown) {
  const email = cleanText(value, 180).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, "Informe um e-mail válido.");
  return email;
}

export function positiveInt(value: unknown, field = "quantidade") {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0 || number > 999) throw new HttpError(400, `${field} inválida.`);
  return number;
}

export function money(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new HttpError(400, "Valor inválido.");
  return Math.round(number * 100) / 100;
}

