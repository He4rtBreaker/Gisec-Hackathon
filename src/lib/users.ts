import { db } from "./db";
import { guardName } from "./analytics";
import { ENV_CLEARANCE, LEVEL_RANK, LEVELS, type EnvKey, type Level } from "./domain";

/** User directory and per-user request history for the admin console. */

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  org: string;
  clearance: Level;
  createdAt: number;
  threads: number;
  requests: number;
  refused: number;
  /** Most sensitive seal any of their threads has reached. */
  highestSeal: Level | null;
  lastActive: number | null;
  lastSignIn: number | null;
}

export interface HistoryRequest {
  id: string;
  ts: number;
  content: string;
  files: number;
  level: Level | null;
  verdict: "ALLOW" | "REFUSE" | null;
  envKey: EnvKey | null;
  rule: string | null;
  reason: string | null;
  /** Status of the reply that followed: ok, error, refused, pending. */
  replyStatus: string | null;
}

export interface HistoryThread {
  id: string;
  title: string;
  seal: Level;
  createdAt: number;
  updatedAt: number;
  requests: HistoryRequest[];
}

export interface UserHistory {
  user: UserSummary;
  /** Environments this user can reach at all, and those closed to them. */
  reachable: EnvKey[];
  closed: EnvKey[];
  failedSignIns: number;
  threads: HistoryThread[];
}

const SEAL_RANK = `CASE c.seal_level WHEN 'SECRET' THEN 3 WHEN 'CONFIDENTIAL' THEN 2 WHEN 'OFFICIAL' THEN 1 ELSE 0 END`;
const USER_REQUESTS = `FROM routing_decisions r
   JOIN messages m ON m.id = r.message_id
   JOIN conversations c ON c.id = m.conversation_id
  WHERE c.user_id = u.id`;

export function listUsersWithStats(): UserSummary[] {
  const rows = db().prepare(
    `SELECT u.id, u.name, u.email, u.role, u.org, u.clearance, u.created_at AS createdAt,
            (SELECT COUNT(*) FROM conversations c WHERE c.user_id = u.id) AS threads,
            (SELECT COUNT(*) ${USER_REQUESTS}) AS requests,
            (SELECT COUNT(*) ${USER_REQUESTS} AND r.verdict = 'REFUSE') AS refused,
            (SELECT MAX(${SEAL_RANK}) FROM conversations c WHERE c.user_id = u.id) AS sealRank,
            (SELECT MAX(c.updated_at) FROM conversations c WHERE c.user_id = u.id) AS lastActive,
            (SELECT MAX(a.ts) FROM audit_log a WHERE a.actor = u.email AND a.kind = 'auth.granted') AS lastSignIn
       FROM users u
      ORDER BY CASE u.role WHEN 'admin' THEN 0 ELSE 1 END, u.name`
  ).all() as Array<Omit<UserSummary, "highestSeal"> & { sealRank: number | null }>;

  return rows.map(({ sealRank, ...r }) => ({
    ...r,
    highestSeal: sealRank == null ? null : LEVELS[sealRank],
  }));
}

export function userHistory(userId: string): UserHistory | null {
  const user = listUsersWithStats().find((u) => u.id === userId);
  if (!user) return null;

  const threads = db().prepare(
    `SELECT id, title, seal_level AS seal, created_at AS createdAt, updated_at AS updatedAt
       FROM conversations WHERE user_id = ? ORDER BY updated_at DESC`
  ).all(userId) as Array<Omit<HistoryThread, "requests">>;

  const rows = db().prepare(
    `SELECT m.id, m.conversation_id AS convId, m.content, m.created_at AS ts,
            (SELECT COUNT(*) FROM attachments a WHERE a.message_id = m.id) AS files,
            cl.level, r.verdict, r.env_key AS envKey, r.reason, r.trace_json, p.name AS policy,
            (SELECT x.status FROM messages x
              WHERE x.conversation_id = m.conversation_id AND x.role = 'assistant'
                AND x.created_at >= m.created_at
              ORDER BY x.created_at LIMIT 1) AS replyStatus
       FROM messages m
       JOIN conversations cv ON cv.id = m.conversation_id
       LEFT JOIN classifications cl ON cl.message_id = m.id
       LEFT JOIN routing_decisions r ON r.message_id = m.id
       LEFT JOIN policies p ON p.id = r.matched_policy_id
      WHERE cv.user_id = ? AND m.role = 'user'
      ORDER BY m.created_at ASC`
  ).all(userId) as Array<{
    id: string; convId: string; content: string; ts: number; files: number;
    level: Level | null; verdict: "ALLOW" | "REFUSE" | null; envKey: EnvKey | null;
    reason: string | null; trace_json: string | null; policy: string | null; replyStatus: string | null;
  }>;

  const byThread = new Map<string, HistoryRequest[]>();
  for (const r of rows) {
    const list = byThread.get(r.convId) ?? [];
    list.push({
      id: r.id, ts: r.ts, files: r.files, level: r.level, verdict: r.verdict, envKey: r.envKey,
      reason: r.reason, replyStatus: r.replyStatus,
      content: r.content.length > 240 ? `${r.content.slice(0, 239)}…` : r.content,
      rule: r.verdict ? (r.policy ?? (r.trace_json ? guardName(r.trace_json) : null) ?? "Default deny") : null,
    });
    byThread.set(r.convId, list);
  }

  const failed = db().prepare(
    `SELECT COUNT(*) AS n FROM audit_log WHERE kind = 'auth.denied' AND actor = ?`
  ).get(user.email) as { n: number };

  const envs: EnvKey[] = ["cloud", "onprem", "airgap"];
  const canReach = (e: EnvKey) => LEVEL_RANK[user.clearance] >= LEVEL_RANK[ENV_CLEARANCE[e]];

  return {
    user,
    reachable: envs.filter(canReach),
    closed: envs.filter((e) => !canReach(e)),
    failedSignIns: failed.n,
    threads: threads.map((t) => ({ ...t, requests: byThread.get(t.id) ?? [] })),
  };
}
