import { db, id, now } from "./db";
import type { EnvKey, Level } from "./domain";

export interface ConversationRow {
  id: string;
  user_id: string;
  title: string;
  seal_level: Level;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: "ok" | "refused" | "error" | "pending";
  env_key: EnvKey | null;
  tokens: number;
  cost_usd: number;
  latency_ms: number;
  created_at: number;
}

export function listConversations(userId: string): ConversationRow[] {
  return db().prepare(
    `SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC`
  ).all(userId) as ConversationRow[];
}

export function getConversation(convId: string, userId: string): ConversationRow | null {
  const row = db().prepare(
    `SELECT * FROM conversations WHERE id = ? AND user_id = ?`
  ).get(convId, userId) as ConversationRow | undefined;
  return row ?? null;
}

export function createConversation(userId: string, title = "New request"): ConversationRow {
  const t = now();
  const convId = id("cnv");
  db().prepare(
    `INSERT INTO conversations (id, user_id, title, seal_level, created_at, updated_at)
     VALUES (?, ?, ?, 'PUBLIC', ?, ?)`
  ).run(convId, userId, title, t, t);
  return getConversation(convId, userId)!;
}

export function listMessages(convId: string): MessageRow[] {
  return db().prepare(
    `SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`
  ).all(convId) as MessageRow[];
}

export function addMessage(input: {
  conversationId: string;
  role: MessageRow["role"];
  content: string;
  status?: MessageRow["status"];
  envKey?: EnvKey | null;
  tokens?: number;
  costUsd?: number;
  latencyMs?: number;
}): string {
  const msgId = id("msg");
  db().prepare(
    `INSERT INTO messages (id, conversation_id, role, content, status, env_key, tokens, cost_usd, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    msgId,
    input.conversationId,
    input.role,
    input.content,
    input.status ?? "ok",
    input.envKey ?? null,
    input.tokens ?? 0,
    input.costUsd ?? 0,
    input.latencyMs ?? 0,
    now(),
  );
  db().prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(now(), input.conversationId);
  return msgId;
}

export function updateMessage(msgId: string, patch: Partial<Pick<MessageRow,
  "content" | "status" | "env_key" | "tokens" | "cost_usd" | "latency_ms">>): void {
  const cols = Object.keys(patch);
  if (!cols.length) return;
  const set = cols.map((c) => `${c} = ?`).join(", ");
  db().prepare(`UPDATE messages SET ${set} WHERE id = ?`)
    .run(...cols.map((c) => (patch as Record<string, unknown>)[c]), msgId);
}

/** Derive a readable thread title from the first user turn. */
export function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "New request";
  return clean.length <= 52 ? clean : `${clean.slice(0, 51)}…`;
}

export function renameConversation(convId: string, title: string): void {
  db().prepare(`UPDATE conversations SET title = ? WHERE id = ?`).run(title, convId);
}

export function deleteConversation(convId: string, userId: string): void {
  db().prepare(`DELETE FROM conversations WHERE id = ? AND user_id = ?`).run(convId, userId);
}
