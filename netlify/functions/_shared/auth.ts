import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { query, type DbClient } from "./db";
import { HttpError } from "./http";

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = "gg_session";
const SESSION_SECONDS = 60 * 60 * 24 * 14;

export type AuthSession = {
  id: string;
  customer_id: number | null;
  is_admin: boolean;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_email?: string | null;
};

function tokenHash(token: string) {
  const secret = process.env.SESSION_SECRET || "";
  if (secret.length < 24) throw new Error("SESSION_SECRET precisa ter pelo menos 24 caracteres.");
  return createHash("sha256").update(`${secret}:${token}`).digest("hex");
}

export async function hashPassword(password: string) {
  if (password.length < 6 || password.length > 128) throw new HttpError(400, "A senha deve ter pelo menos 6 caracteres.");
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, salt, expectedHex] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function parseCookies(request: Request) {
  const cookies = new Map<string, string>();
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) cookies.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
  }
  return cookies;
}

export function sessionCookie(token: string, request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure}`;
}

export function clearSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export async function createSession(request: Request, options: { customerId?: number; admin?: boolean }, client?: DbClient) {
  const token = randomBytes(32).toString("base64url");
  const id = randomBytes(16).toString("hex");
  if (client) await client.query(
    `INSERT INTO auth_sessions (id, token_hash, customer_id, is_admin, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '14 days')`,
    [id, tokenHash(token), options.customerId || null, Boolean(options.admin)],
  );
  else await query(
    `INSERT INTO auth_sessions (id, token_hash, customer_id, is_admin, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '14 days')`,
    [id, tokenHash(token), options.customerId || null, Boolean(options.admin)],
  );
  return { token, cookie: sessionCookie(token, request) };
}

export async function getSession(request: Request): Promise<AuthSession | null> {
  const token = parseCookies(request).get(COOKIE_NAME);
  if (!token) return null;
  const { rows } = await query<AuthSession>(
    `SELECT s.id, s.customer_id, s.is_admin, c.name AS customer_name,
            c.phone AS customer_phone, c.email AS customer_email
       FROM auth_sessions s
       LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
    [tokenHash(token)],
  );
  return rows[0] || null;
}

export async function requireCustomer(request: Request) {
  const session = await getSession(request);
  if (!session?.customer_id) throw new HttpError(401, "Entre na sua conta para continuar.");
  return session;
}

export async function requireAdmin(request: Request) {
  const session = await getSession(request);
  if (!session?.is_admin) throw new HttpError(401, "Acesso administrativo necessário.");
  return session;
}

export async function deleteSession(request: Request) {
  const token = parseCookies(request).get(COOKIE_NAME);
  if (token) await query("DELETE FROM auth_sessions WHERE token_hash = $1", [tokenHash(token)]);
}
