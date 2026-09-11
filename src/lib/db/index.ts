import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

let _db: Database.Database | null = null;
const g = globalThis as unknown as { __mizanBooted?: boolean };

/**
 * Vercel's serverless functions run on a read-only filesystem outside /tmp,
 * and /tmp itself is wiped between cold starts and never shared across
 * concurrent instances — a poor fit for a single-writer SQLite file, but the
 * closest thing available without a real migration to a hosted database.
 *
 * The fix: "vercel-build" (package.json) seeds mizan.db into the deployment
 * bundle at build time, read-only from then on. At runtime, each cold
 * instance copies that seeded file into /tmp once, then treats /tmp as home.
 * Writes made after that point live only as long as that instance — a
 * reasonable trade for a demo, not a substitute for real persistence.
 */
function resolveDbPath(): string {
  if (process.env.MIZAN_DB) return process.env.MIZAN_DB;
  if (!process.env.VERCEL) return join(process.cwd(), "mizan.db");

  const runtime = "/tmp/mizan.db";
  if (!existsSync(runtime)) {
    const seeded = join(process.cwd(), "mizan.db");
    if (existsSync(seeded)) copyFileSync(seeded, runtime);
  }
  return runtime;
}

export function db(): Database.Database {
  if (_db) return _db;
  const file = resolveDbPath();
  const conn = new Database(file);
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  conn.exec(readFileSync(join(process.cwd(), "src/lib/db/schema.sql"), "utf8"));
  migrate(conn);
  sealAuditChain(conn);
  // In-flight counters describe work inside this process. Anything left over
  // from a previous run is stale — reset once per process, not per module load.
  if (!g.__mizanBooted) {
    conn.prepare(`UPDATE environments SET in_flight = 0`).run();
    g.__mizanBooted = true;
  }
  _db = conn;
  return conn;
}

/** Additive column migrations for databases created before a column existed. */
function migrate(conn: Database.Database) {
  const add = (table: string, column: string, ddl: string): boolean => {
    const cols = conn.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (cols.some((c) => c.name === column)) return false;
    conn.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    return true;
  };
  add("artefact_deployments", "detail_json", `detail_json TEXT NOT NULL DEFAULT '{}'`);
  add("routing_decisions", "artefact_ref", `artefact_ref TEXT`);
  add("environments", "sim_load", `sim_load INTEGER NOT NULL DEFAULT 0`);
  if (add("environments", "net_ms", `net_ms INTEGER NOT NULL DEFAULT 0`)) {
    conn.exec(`UPDATE environments SET net_ms =
                 CASE key WHEN 'cloud' THEN 240 WHEN 'onprem' THEN 35 WHEN 'airgap' THEN 12 ELSE 0 END`);
  }
  add("conversations", "project_id", `project_id TEXT`);
  add("classifications", "context_json", `context_json TEXT`);
  add("audit_log", "prev_hash", `prev_hash TEXT`);
  add("audit_log", "hash", `hash TEXT`);
}

export const now = () => Date.now();

export function id(prefix: string): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${t}${r}`;
}

/** Short human-facing job reference, e.g. JOB-4F21 */
export function jobRef(): string {
  return `JOB-${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
}

/* ---- tamper-evident audit chain ---------------------------------------- */

export const GENESIS = "0".repeat(64);

export interface AuditFields {
  id: string;
  ts: number;
  actor: string;
  kind: string;
  subject: string;
  summary: string;
  detail_json: string;
}

/** Each entry commits to its own content and to the hash of the entry before it. */
export function auditHash(prev: string, r: AuditFields): string {
  return createHash("sha256")
    .update([prev, r.id, r.ts, r.actor, r.kind, r.subject, r.summary, r.detail_json].join("\x1e"))
    .digest("hex");
}

/** Hash any entries written without one — legacy rows and bulk seed inserts. */
export function sealAuditChain(conn: Database.Database): void {
  const pending = conn.prepare(
    `SELECT rowid, id, ts, actor, kind, subject, summary, detail_json
       FROM audit_log WHERE hash IS NULL ORDER BY rowid`
  ).all() as Array<AuditFields & { rowid: number }>;
  if (!pending.length) return;

  const prevOf = conn.prepare(
    `SELECT hash FROM audit_log WHERE rowid < ? AND hash IS NOT NULL ORDER BY rowid DESC LIMIT 1`
  );
  const upd = conn.prepare(`UPDATE audit_log SET prev_hash = ?, hash = ? WHERE rowid = ?`);
  conn.transaction(() => {
    for (const r of pending) {
      const prev = (prevOf.get(r.rowid) as { hash: string } | undefined)?.hash ?? GENESIS;
      upd.run(prev, auditHash(prev, r), r.rowid);
    }
  })();
}
