import { GENESIS, auditHash, db, id, now, type AuditFields } from "./db";

/**
 * The audit ledger.
 *
 * Every entry is hash-chained to the one before it, so editing, deleting or
 * re-ordering any past entry breaks every link after it. `verifyChain` walks
 * the whole ledger and reports the first entry that no longer checks out.
 */

export interface AuditEntry {
  actor: string;
  kind: string;
  subject?: string;
  summary: string;
  detail?: unknown;
}

export interface AuditRow extends AuditFields {
  prev_hash: string | null;
  hash: string | null;
}

export function writeAudit(e: AuditEntry): string {
  const conn = db();
  const row: AuditFields = {
    id: id("aud"),
    ts: now(),
    actor: e.actor,
    kind: e.kind,
    subject: e.subject ?? "",
    summary: e.summary,
    detail_json: JSON.stringify(e.detail ?? {}),
  };
  conn.transaction(() => {
    const last = conn.prepare(`SELECT hash FROM audit_log ORDER BY rowid DESC LIMIT 1`)
      .get() as { hash: string | null } | undefined;
    const prev = last?.hash ?? GENESIS;
    conn.prepare(
      `INSERT INTO audit_log (id, ts, actor, kind, subject, summary, detail_json, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(row.id, row.ts, row.actor, row.kind, row.subject, row.summary, row.detail_json,
          prev, auditHash(prev, row));
  })();
  return row.id;
}

/* ---- reading -------------------------------------------------------------- */

export const AUDIT_GROUPS = {
  auth:    { label: "Access",      prefixes: ["auth."] },
  request: { label: "Requests",    prefixes: ["request.", "egress."] },
  policy:  { label: "Policy",      prefixes: ["policy."] },
  project: { label: "Projects",    prefixes: ["project."] },
  deploy:  { label: "Deployments", prefixes: ["artefact.", "deploy.", "diode."] },
  env:     { label: "Operations",  prefixes: ["env.", "demo."] },
} as const;
export type AuditGroup = keyof typeof AUDIT_GROUPS;

export function listAudit(opts: { group?: string; q?: string; limit?: number }): AuditRow[] {
  const where: string[] = [];
  const args: unknown[] = [];

  if (opts.group && opts.group in AUDIT_GROUPS) {
    const prefixes = AUDIT_GROUPS[opts.group as AuditGroup].prefixes;
    where.push(`(${prefixes.map(() => "kind LIKE ?").join(" OR ")})`);
    args.push(...prefixes.map((p) => `${p}%`));
  }
  if (opts.q?.trim()) {
    const q = `%${opts.q.trim()}%`;
    where.push(`(actor LIKE ? OR summary LIKE ? OR subject LIKE ? OR kind LIKE ?)`);
    args.push(q, q, q, q);
  }

  return db().prepare(
    `SELECT id, ts, actor, kind, subject, summary, detail_json, prev_hash, hash FROM audit_log
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY ts DESC, rowid DESC LIMIT ?`
  ).all(...args, opts.limit ?? 200) as AuditRow[];
}

export function chainHead(): { count: number; head: string } {
  const row = db().prepare(
    `SELECT (SELECT COUNT(*) FROM audit_log) AS count,
            (SELECT hash FROM audit_log ORDER BY rowid DESC LIMIT 1) AS head`
  ).get() as { count: number; head: string | null };
  return { count: row.count, head: row.head ?? GENESIS };
}

/* ---- verification --------------------------------------------------------- */

export interface ChainReport {
  ok: boolean;
  checked: number;
  total: number;
  head: string;
  brokenAt?: { id: string; ts: number; kind: string; summary: string; problem: string };
}

export function verifyChain(): ChainReport {
  const rows = db().prepare(
    `SELECT id, ts, actor, kind, subject, summary, detail_json, prev_hash, hash
       FROM audit_log ORDER BY rowid`
  ).all() as AuditRow[];

  let prev = GENESIS;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const broken = (problem: string): ChainReport => ({
      ok: false, checked: i, total: rows.length, head: prev,
      brokenAt: { id: r.id, ts: r.ts, kind: r.kind, summary: r.summary, problem },
    });
    if (r.prev_hash !== prev) {
      return broken("Link broken — an earlier entry was removed, inserted or re-ordered.");
    }
    if (auditHash(prev, r) !== r.hash) {
      return broken("Content altered after it was written.");
    }
    prev = r.hash!;
  }
  return { ok: true, checked: rows.length, total: rows.length, head: prev };
}
