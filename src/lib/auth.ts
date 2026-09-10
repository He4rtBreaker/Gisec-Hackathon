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

export async function createSession(userId: string): Promise<void> {
  const raw = randomBytes(24).toString("hex");
  const expires = now() + SESSION_TTL_MS;
  db().prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`)
    .run(raw, userId, expires);
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
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const raw = verifyToken(token);
    if (raw) db().prepare(`DELETE FROM sessions WHERE token = ?`).run(raw);
  }
  jar.delete(SESSION_COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const raw = verifyToken(token);
  if (!raw) return null;
  const row = db().prepare(
    `SELECT u.id, u.email, u.name, u.role, u.org, u.clearance, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`
  ).get(raw) as (User & { expires_at: number }) | undefined;
  if (!row) return null;
  if (row.expires_at < now()) {
    db().prepare(`DELETE FROM sessions WHERE token = ?`).run(raw);
    return null;
  }
  const { expires_at: _drop, ...user } = row;
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
