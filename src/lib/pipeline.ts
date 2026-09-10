import { db, id, now } from "./db";
import { writeAudit } from "./audit";
import {
  addMessage, createConversation, getConversation, listMessages,
  renameConversation, titleFrom, updateMessage,
} from "./conversations";
import { classify } from "./classify";
import { EgressBlockedError, getProvider, type ChatMessage } from "./llm/provider";
import { evaluate } from "./policy/engine";
import { activeArtefact } from "./deployments";
import { acquire, release } from "./environments";
import { maxLevel, type EnvKey, type Level } from "./domain";

/**
 * The request pipeline: inspect → decide → dispatch → record.
 *
 * Shared by the chat API and the scripted demo, so both exercise exactly the
 * same path. Events are emitted as they happen; the caller decides how (or
 * whether) to deliver them.
 */

const SYSTEM = `You are Mizan, an assistant deployed inside a government AI platform.
Answer clearly and concisely. Prefer short paragraphs and plain language.
Never invent facts about the user's data; say when you do not know.`;

export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_CHARS = 200_000;
/** Attachment text handed to the model per file. The inspector always sees all of it. */
const MODEL_ATTACHMENT_CHARS = 24_000;

export interface AttachmentInput {
  filename: string;
  mime: string;
  text: string;
}

export interface PipelineUser {
  id: string;
  email: string;
  clearance: Level;
}

export interface RunInput {
  user: PipelineUser;
  conversationId?: string | null;
  content: string;
  /** Environment the requester pinned; policy decides whether it is honoured. */
  preferred?: EnvKey | "auto";
  attachments?: AttachmentInput[];
  /** Title for a new thread; defaults to the request text. */
  title?: string;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface RunResult {
  conversationId: string;
  verdict: "ALLOW" | "REFUSE" | "ERROR";
  level: Level;
  seal: Level;
  envKey: EnvKey | null;
  policyName: string | null;
  reason: string;
  artefact: string | null;
}

export type Emit = (event: { type: string } & Record<string, unknown>) => void;

/** Rough token estimate — the demo does not need a real tokenizer. */
const estTokens = (s: string) => Math.max(1, Math.round(s.length / 4));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Validate attachments arriving from a client. Text only, bounded. */
export function sanitizeAttachments(raw: unknown): AttachmentInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_ATTACHMENTS).flatMap((a) => {
    if (!a || typeof a !== "object") return [];
    const { filename, mime, text } = a as Record<string, unknown>;
    if (typeof filename !== "string" || typeof text !== "string" || !text.trim()) return [];
    return [{
      filename: filename.slice(0, 120),
      mime: typeof mime === "string" && mime ? mime.slice(0, 80) : "text/plain",
      text: text.slice(0, MAX_ATTACHMENT_CHARS),
    }];
  });
}

function withAttachments(content: string, files: Array<{ filename: string; text: string }>): string {
  if (!files.length) return content;
  return content + files
    .map((f) => `\n\n--- attached file: ${f.filename} ---\n${f.text.slice(0, MODEL_ATTACHMENT_CHARS)}`)
    .join("");
}

/** Attachments on earlier turns of a thread, keyed by user message id. */
function threadAttachments(convId: string): Map<string, Array<{ filename: string; text: string }>> {
  const rows = db().prepare(
    `SELECT a.message_id, a.filename, a.content_text
       FROM attachments a JOIN messages m ON m.id = a.message_id
      WHERE m.conversation_id = ?`
  ).all(convId) as Array<{ message_id: string; filename: string; content_text: string }>;
  const out = new Map<string, Array<{ filename: string; text: string }>>();
  for (const r of rows) {
    const list = out.get(r.message_id) ?? [];
    list.push({ filename: r.filename, text: r.content_text });
    out.set(r.message_id, list);
  }
  return out;
}

export async function runRequest(input: RunInput, emit: Emit): Promise<RunResult> {
  const { user } = input;
  const content = input.content.trim();
  const files = input.attachments ?? [];

  let conv = input.conversationId ? getConversation(input.conversationId, user.id) : null;
  const isNew = !conv;
  if (!conv) conv = createConversation(user.id, titleFrom(input.title ?? content));
  else if (conv.title === "New request") renameConversation(conv.id, titleFrom(content));
  const convId = conv.id;

  const history = listMessages(convId);
  const priorFiles = threadAttachments(convId);
  const userMsgId = addMessage({ conversationId: convId, role: "user", content });

  const insAtt = db().prepare(
    `INSERT INTO attachments (id, message_id, filename, mime, size_bytes, content_text)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const f of files) {
    insAtt.run(id("att"), userMsgId, f.filename, f.mime, Buffer.byteLength(f.text), f.text);
  }

  emit({
    type: "meta",
    conversationId: convId,
    isNewConversation: isNew,
    attachments: files.map((f) => ({ filename: f.filename, size: Buffer.byteLength(f.text) })),
  });

  /* ---------- 1. inspect, before anything is dispatched --------------- */
  emit({ type: "inspecting" });

  const cls = await classify({
    prompt: content,
    attachments: files.map((f) => ({ filename: f.filename, text: f.text })),
  });

  // A thread never de-escalates: once it has held Secret, it stays sealed.
  const seal = maxLevel(conv.seal_level, cls.level);
  db().prepare(`UPDATE conversations SET seal_level = ? WHERE id = ?`).run(seal, convId);

  const clsId = id("cls");
  db().prepare(
    `INSERT INTO classifications
       (id, message_id, level, confidence, rationale, signals_json, inspector, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(clsId, userMsgId, cls.level, cls.confidence, cls.rationale,
        JSON.stringify(cls.signals), cls.inspector, cls.latencyMs, now());

  emit({
    type: "classified",
    classificationId: clsId,
    level: cls.level,
    sealLevel: seal,
    confidence: cls.confidence,
    rationale: cls.rationale,
    signals: cls.signals,
    inspector: cls.inspector,
    latencyMs: cls.latencyMs,
    degraded: cls.degraded,
  });

  /* ---------- 2. evaluate policy --------------------------------------- */
  const pinned = input.preferred && input.preferred !== "auto" ? input.preferred : null;
  const decision = evaluate({
    level: seal,
    clearance: user.clearance,
    signals: cls.signals,
    pinned,
  });
  const artefact = decision.envKey ? activeArtefact(decision.envKey) : null;

  db().prepare(
    `INSERT INTO routing_decisions
       (id, message_id, classification_id, verdict, env_key, matched_policy_id, reason, trace_json,
        artefact_ref, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id("rt"), userMsgId, clsId, decision.verdict, decision.envKey,
        decision.matchedPolicyId, decision.reason, JSON.stringify(decision.trace),
        artefact?.ref ?? null, now());

  const signalCodes = cls.signals.map((s) => s.code);
  const base = {
    conversationId: convId, level: cls.level, seal,
    policyName: decision.matchedPolicyName, artefact: artefact?.ref ?? null,
  };

  /* ---------- 2a. refusal path ---------------------------------------- */
  if (decision.verdict === "REFUSE") {
    const refusedId = addMessage({
      conversationId: convId, role: "assistant", content: decision.reason,
      status: "refused", envKey: null,
    });

    writeAudit({
      actor: user.email, kind: "request.refused", subject: userMsgId,
      summary: `${seal} refused — ${decision.matchedPolicyName ?? "default deny"}`,
      detail: { level: cls.level, seal, pinned: input.preferred ?? "auto",
                policy: decision.matchedPolicyName, reason: decision.reason,
                signals: signalCodes, attachments: files.map((f) => f.filename) },
    });

    emit({
      type: "refused",
      messageId: refusedId,
      reason: decision.reason,
      policyName: decision.matchedPolicyName,
      trace: decision.trace,
    });
    return { ...base, verdict: "REFUSE", envKey: null, reason: decision.reason };
  }

  const envKey = decision.envKey!;
  const chosen = db().prepare(
    `SELECT name, cost_per_1k, net_ms FROM environments WHERE key = ?`
  ).get(envKey) as { name: string; cost_per_1k: number; net_ms: number };

  const overrodePin = !!pinned && pinned !== envKey;
  const reason = overrodePin
    ? `${decision.reason} Your pinned target (${pinned}) was not available.`
    : decision.reason;

  emit({
    type: "routed",
    envKey,
    envName: chosen.name,
    policyName: decision.matchedPolicyName,
    artefact: artefact?.ref ?? null,
    overrodePin,
    reason,
    trace: decision.trace,
  });

  writeAudit({
    actor: user.email, kind: "request.routed", subject: userMsgId,
    summary: `${seal} → ${chosen.name} via ${decision.matchedPolicyName}`,
    detail: { level: cls.level, seal, envKey, artefact: artefact?.ref, pinned, overrodePin,
              policy: decision.matchedPolicyName, signals: signalCodes,
              attachments: files.map((f) => f.filename) },
  });

  /* ---------- 3. dispatch ------------------------------------------------ */
  const assistantId = addMessage({
    conversationId: convId, role: "assistant", content: "",
    status: "pending", envKey,
  });
  emit({ type: "dispatched", assistantMessageId: assistantId, envKey });

  const messages: ChatMessage[] = [
    ...history
      .filter((m) => m.role !== "system" && m.status !== "refused" && m.content.trim())
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.role === "user" ? withAttachments(m.content, priorFiles.get(m.id) ?? []) : m.content,
      })),
    { role: "user", content: withAttachments(content, files) },
  ];

  const started = Date.now();
  let text = "";
  acquire(envKey);
  try {
    // Simulated network hop between the core and the chosen environment.
    await sleep(chosen.net_ms);
    const stream = getProvider(envKey).stream({
      messages, system: SYSTEM, maxTokens: input.maxTokens, signal: input.signal,
    });
    for await (const chunk of stream) {
      text += chunk;
      emit({ type: "delta", text: chunk });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateMessage(assistantId, { status: "error", content: text });
    writeAudit({
      actor: user.email,
      kind: err instanceof EgressBlockedError ? "egress.blocked" : "request.failed",
      subject: userMsgId,
      summary: `${chosen.name}: ${message.slice(0, 160)}`,
      detail: { envKey },
    });
    emit({ type: "error", message });
    return { ...base, verdict: "ERROR", envKey, reason: message };
  } finally {
    release(envKey);
  }

  const latency = Date.now() - started;
  const tokens = estTokens(withAttachments(content, files)) + estTokens(text);
  const cost = (tokens / 1000) * chosen.cost_per_1k;
  updateMessage(assistantId, {
    content: text, status: "ok", tokens, cost_usd: cost, latency_ms: latency,
  });

  emit({ type: "done", tokens, latencyMs: latency, costUsd: cost });
  return { ...base, verdict: "ALLOW", envKey, reason };
}
