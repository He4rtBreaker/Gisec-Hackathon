import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db, now } from "./db";

export type Role = "user" | "admin";
export type Level = "PUBLIC" | "OFFICIAL" | "CONFIDENTIAL" | "SECRET";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  org: string;
  clearance: Level;
}

const SESSION_COOKIE = "mizan_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;

const secret = () => process.env.MIZAN_SECRET ?? "dev-secret-change-me";

/** Demo-grade password hashing. Salted SHA-256 — not for production use. */
export function hashPassword(password: string, salt?: string): string {
  const s = salt ?? randomBytes(12).toString("hex");
  const h = createHash("sha256").update(`${s}:${password}`).digest("hex");
  return `${s}$${h}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expected] = stored.split("$");
  if (!salt || !expected) return false;
  const actual = createHash("sha256").update(`${salt}:${password}`).digest("hex");
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function signToken(raw: string): string {
  const sig = createHmac("sha256", secret()).update(raw).digest("hex").slice(0, 32);
  return `${raw}.${sig}`;
}

function verifyToken(token: string): string | null {
  const idx = token.lastIndexOf(".");
  if (idx < 0) return null;
  const raw = token.slice(0, idx);
  return signToken(raw) === token ? raw : null;
}

/**
 * Sessions are a self-contained signed cookie, not a database row.
 *
 * They used to be a random token looked up against a `sessions` table. That
 * broke on Vercel: requests for one visitor land on independent serverless
 * instances, each with its own copy of the database, so a session created on
 * instance A was invisible to instance B and a normal page navigation could
 * bounce a signed-in user back to /login. Encoding the user's claims
 * directly in the (HMAC-signed, httpOnly) cookie removes the database from
 * the read path entirely — verifying a session is now pure cryptography, so
 * it is consistent no matter which instance handles the request.
 *
 * Trade-off, stated plainly: there is no server-side revocation list, so
 * "log out" only clears the cookie client-side — a captured cookie remains
 * valid until it naturally expires (SESSION_TTL_MS). Acceptable for a
 * demo-grade app (see hashPassword's own doc comment above); a real
 * deployment would want a shared session/token-revocation store instead.
 */
interface SessionPayload {
  id: string;
  email: string;
  name: string;
  role: Role;
  org: string;
  clearance: Level;
  exp: number;
}

function encodePayload(p: SessionPayload): string {
  return Buffer.from(JSON.stringify(p)).toString("base64url");
}

function decodePayload(raw: string): SessionPayload | null {
  try {
    const p = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (typeof p.id !== "string" || typeof p.exp !== "number") return null;
    return p as SessionPayload;
  } catch {
    return null;
  }
}

export async function createSession(user: User): Promise<void> {
  const expires = now() + SESSION_TTL_MS;
  const raw = encodePayload({ ...user, exp: expires });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, signToken(raw), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: new Date(expires),
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const raw = verifyToken(token);
  if (!raw) return null;
  const payload = decodePayload(raw);
  if (!payload) return null;
  if (payload.exp < now()) return null;
  const { exp: _drop, ...user } = payload;
  return user;
}

export function authenticate(email: string, password: string): User | null {
  const row = db().prepare(
    `SELECT id, email, name, role, org, clearance, password_hash FROM users WHERE email = ?`
  ).get(email.trim().toLowerCase()) as (User & { password_hash: string }) | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  const { password_hash: _drop, ...user } = row;
  return user;
}
