import { db } from "./db";
import { LEVELS, type EnvKey, type Level } from "./domain";

/** Aggregates for the admin overview. Cheap enough to compute on every refresh. */

export interface EnvStats {
  routed: number;
  tokens: number;
  cost: number;
  avgLatency: number;
}

export interface Decision {
  ts: number;
  actor: string;
  level: Level | null;
  verdict: "ALLOW" | "REFUSE";
  envKey: EnvKey | null;
  rule: string;
  reason: string;
}

export interface OverviewStats {
  requests: number;
  last24h: number;
  refused: number;
  failed: number;
  spend: number;
  tokens: number;
  inspector: { count: number; avgMs: number };
  byLevel: Record<Level, number>;
  byEnv: Record<EnvKey, EnvStats>;
  refusals: Array<{ name: string; count: number }>;
  signals: Array<{ code: string; label: string; level: Level; count: number }>;
  recent: Decision[];
}

/** Engine guards (pin checks) are not rows in `policies`; their name is on the trace. */
export function guardName(traceJson: string): string | null {
  try {
    const trace = JSON.parse(traceJson) as Array<{ matched: boolean; action: string; name: string }>;
    return trace.find((t) => t.matched && t.action === "REFUSE")?.name ?? null;
  } catch {
    return null;
  }
}

export function overviewStats(): OverviewStats {
  const conn = db();
  const count = (sql: string, ...args: unknown[]) => (conn.prepare(sql).get(...args) as { n: number }).n;

  const requests = count(`SELECT COUNT(*) AS n FROM routing_decisions`);
  const last24h = count(`SELECT COUNT(*) AS n FROM routing_decisions WHERE created_at > ?`, Date.now() - 86_400_000);
  const refused = count(`SELECT COUNT(*) AS n FROM routing_decisions WHERE verdict = 'REFUSE'`);
  const failed = count(`SELECT COUNT(*) AS n FROM messages WHERE role = 'assistant' AND status = 'error'`);

  const byLevel = Object.fromEntries(LEVELS.map((l) => [l, 0])) as Record<Level, number>;
  for (const r of conn.prepare(`SELECT level, COUNT(*) AS n FROM classifications GROUP BY level`)
    .all() as Array<{ level: Level; n: number }>) {
    byLevel[r.level] = r.n;
  }

  const zero = (): EnvStats => ({ routed: 0, tokens: 0, cost: 0, avgLatency: 0 });
  const byEnv: Record<EnvKey, EnvStats> = { cloud: zero(), onprem: zero(), airgap: zero() };
  for (const r of conn.prepare(
    `SELECT env_key, COUNT(*) AS n, SUM(tokens) AS tokens, SUM(cost_usd) AS cost, AVG(latency_ms) AS lat
       FROM messages WHERE role = 'assistant' AND status = 'ok' AND env_key IS NOT NULL
      GROUP BY env_key`
  ).all() as Array<{ env_key: EnvKey; n: number; tokens: number; cost: number; lat: number }>) {
    if (byEnv[r.env_key]) {
      byEnv[r.env_key] = { routed: r.n, tokens: r.tokens ?? 0, cost: r.cost ?? 0, avgLatency: r.lat ?? 0 };
    }
  }
  const spend = Object.values(byEnv).reduce((a, e) => a + e.cost, 0);
  const tokens = Object.values(byEnv).reduce((a, e) => a + e.tokens, 0);

  const insp = conn.prepare(`SELECT COUNT(*) AS n, AVG(latency_ms) AS avg FROM classifications`)
    .get() as { n: number; avg: number | null };

  const refusalCounts = new Map<string, number>();
  for (const r of conn.prepare(
    `SELECT p.name AS policy, r.trace_json FROM routing_decisions r
       LEFT JOIN policies p ON p.id = r.matched_policy_id WHERE r.verdict = 'REFUSE'`
  ).all() as Array<{ policy: string | null; trace_json: string }>) {
    const name = r.policy ?? guardName(r.trace_json) ?? "Default deny";
    refusalCounts.set(name, (refusalCounts.get(name) ?? 0) + 1);
  }

  const signalCounts = new Map<string, { code: string; label: string; level: Level; count: number }>();
  for (const r of conn.prepare(`SELECT signals_json FROM classifications`).all() as Array<{ signals_json: string }>) {
    try {
      for (const s of JSON.parse(r.signals_json) as Array<{ code: string; label: string; level: Level }>) {
        const hit = signalCounts.get(s.code) ?? { code: s.code, label: s.label, level: s.level, count: 0 };
        hit.count += 1;
        signalCounts.set(s.code, hit);
      }
    } catch { /* malformed row — skip */ }
  }

  const recent = (conn.prepare(
    `SELECT r.created_at AS ts, r.verdict, r.env_key AS envKey, r.reason, r.trace_json,
            p.name AS policy, c.level, u.email AS actor
       FROM routing_decisions r
       JOIN messages m ON m.id = r.message_id
       JOIN conversations cv ON cv.id = m.conversation_id
       JOIN users u ON u.id = cv.user_id
       LEFT JOIN classifications c ON c.id = r.classification_id
       LEFT JOIN policies p ON p.id = r.matched_policy_id
      ORDER BY r.created_at DESC LIMIT 12`
  ).all() as Array<{
    ts: number; verdict: "ALLOW" | "REFUSE"; envKey: EnvKey | null; reason: string;
    trace_json: string; policy: string | null; level: Level | null; actor: string;
  }>).map((r) => ({
    ts: r.ts, actor: r.actor, level: r.level, verdict: r.verdict, envKey: r.envKey, reason: r.reason,
    rule: r.policy ?? guardName(r.trace_json) ?? "Default deny",
  }));

  return {
    requests, last24h, refused, failed, spend, tokens,
    inspector: { count: insp.n, avgMs: insp.avg ?? 0 },
    byLevel, byEnv,
    refusals: [...refusalCounts].map(([name, c]) => ({ name, count: c })).sort((a, b) => b.count - a.count),
    signals: [...signalCounts.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    recent,
  };
}
