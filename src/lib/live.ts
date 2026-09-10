import { db } from "./db";
import { guardName } from "./analytics";
import { listEnvRuntime, type EnvRuntime } from "./environments";
import type { EnvKey, Level } from "./domain";

/** Live state for the animated topology: environment load plus decisions since a moment. */

export interface LiveDecision {
  id: string;
  ts: number;
  verdict: "ALLOW" | "REFUSE";
  envKey: EnvKey | null;
  level: Level | null;
  actor: string;
  rule: string;
  reason: string;
}

export interface LivePayload {
  now: number;
  envs: EnvRuntime[];
  decisions: LiveDecision[];
  counts: { requests: number; refused: number; last24h: number; routed: Record<EnvKey, number> };
  /** Requests received in the last two minutes that have no routing decision yet. */
  inspecting: number;
}

const DECISIONS = `
  SELECT r.id, r.created_at AS ts, r.verdict, r.env_key AS envKey, r.reason, r.trace_json,
         p.name AS policy, c.level, u.email AS actor
    FROM routing_decisions r
    JOIN messages m ON m.id = r.message_id
    JOIN conversations cv ON cv.id = m.conversation_id
    JOIN users u ON u.id = cv.user_id
    LEFT JOIN classifications c ON c.id = r.classification_id
    LEFT JOIN policies p ON p.id = r.matched_policy_id`;

type Row = Omit<LiveDecision, "rule"> & { trace_json: string; policy: string | null };

const toDecision = ({ trace_json, policy, ...r }: Row): LiveDecision => ({
  ...r, rule: policy ?? guardName(trace_json) ?? "Default deny",
});

export function recentDecisions(limit = 6): LiveDecision[] {
  return (db().prepare(`${DECISIONS} ORDER BY r.created_at DESC LIMIT ?`).all(limit) as Row[]).map(toDecision);
}

export function livePayload(since: number): LivePayload {
  const conn = db();
  const t = Date.now();

  const routed: Record<EnvKey, number> = { cloud: 0, onprem: 0, airgap: 0 };
  for (const r of conn.prepare(
    `SELECT env_key, COUNT(*) AS n FROM routing_decisions
      WHERE verdict = 'ALLOW' AND env_key IS NOT NULL GROUP BY env_key`
  ).all() as Array<{ env_key: EnvKey; n: number }>) {
    if (r.env_key in routed) routed[r.env_key] = r.n;
  }

  const c = conn.prepare(
    `SELECT COUNT(*) AS requests, COALESCE(SUM(verdict = 'REFUSE'), 0) AS refused,
            COALESCE(SUM(created_at > ?), 0) AS last24h FROM routing_decisions`
  ).get(t - 86_400_000) as { requests: number; refused: number; last24h: number };

  const inspecting = (conn.prepare(
    `SELECT COUNT(*) AS n FROM messages m
      WHERE m.role = 'user' AND m.created_at > ?
        AND NOT EXISTS (SELECT 1 FROM routing_decisions r WHERE r.message_id = m.id)`
  ).get(t - 120_000) as { n: number }).n;

  const decisions = (conn.prepare(`${DECISIONS} WHERE r.created_at >= ? ORDER BY r.created_at ASC LIMIT 40`)
    .all(since) as Row[]).map(toDecision);

  return { now: t, envs: listEnvRuntime(), decisions, counts: { ...c, routed }, inspecting };
}
