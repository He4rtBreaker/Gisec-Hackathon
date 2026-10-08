import { db, id, now } from "./db";
import { writeAudit } from "./audit";
import {
  addMessage, createConversation, getConversation, listMessages,
  renameConversation, titleFrom, updateMessage,
} from "./conversations";
import { classify } from "./classify";
import { EgressBlockedError, getProvider, type ChatMessage } from "./llm/provider";
import { anonymizeAll, createRestorer, type Replacement } from "./classify/anonymize";
import { evaluate } from "./policy/engine";
import { scanAgainstPolicies, skipFor, type PolicyScan } from "./policy/scan";
import { activeArtefact } from "./deployments";
import { acquire, release } from "./environments";
import { knowledgeBlock, ownsProject, retrieve, summarizeContext, withProjectContext } from "./projects";
import { ENV_LEAVES_BOUNDARY, maxLevel, type EnvKey, type Level } from "./domain";

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
  /** Project whose knowledge should accompany the request. Binds the thread on first use. */
  projectId?: string | null;
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

  // A thread binds to at most one project and keeps it: that project's
  // knowledge may already be part of the conversation.
  let projectId = conv.project_id ?? null;
  if (!projectId && input.projectId && ownsProject(user.id, input.projectId)) {
    projectId = input.projectId;
    db().prepare(`UPDATE conversations SET project_id = ? WHERE id = ?`).run(projectId, convId);
  }

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
    projectId,
    attachments: files.map((f) => ({ filename: f.filename, size: Buffer.byteLength(f.text) })),
  });

  /* ---------- 1. inspect, before anything is dispatched --------------- */
  emit({ type: "inspecting" });

  // Retrieval runs inside the boundary, before classification: the knowledge
  // that will travel with the request is part of what is being classified.
  const ctx = projectId ? retrieve(projectId, content) : null;
  const contextSummary = ctx ? summarizeContext(ctx) : null;

  const inspected = await classify({
    prompt: content,
    attachments: [
      ...files.map((f) => ({ filename: f.filename, text: f.text })),
      ...(ctx?.project.instructions ? [{ filename: "project instructions", text: ctx.project.instructions }] : []),
    ],
  });
  // Knowledge excerpts inherit the classification their file received at upload.
  const cls = withProjectContext(inspected, ctx);

  // A thread never de-escalates: once it has held Secret, it stays sealed.
  const seal = maxLevel(conv.seal_level, cls.level);
  db().prepare(`UPDATE conversations SET seal_level = ? WHERE id = ?`).run(seal, convId);

  const clsId = id("cls");
  db().prepare(
    `INSERT INTO classifications
       (id, message_id, level, confidence, rationale, signals_json, inspector, latency_ms, context_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(clsId, userMsgId, cls.level, cls.confidence, cls.rationale,
        JSON.stringify(cls.signals), cls.inspector, cls.latencyMs,
        contextSummary ? JSON.stringify(contextSummary) : null, now());

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
    nerAvailable: cls.nerAvailable,
    context: contextSummary,
  });

  /* ---------- 1a. scan the request against the written policies --------
   *
   * A second opinion, from a different model than the adjudicator, asking a
   * different question: not "how sensitive is this" but "would sending this
   * break a rule we have written down".
   *
   * It reads the request as written, before anonymisation, because a rule
   * about personal data cannot be judged once the personal data has become
   * <PERSON_1>. That is exactly why anything Confidential or above never
   * reaches it: the scanner is a hosted model today, and routing a request
   * on-prem afterwards would not undo a call that already carried it off
   * sovereign ground.
   *
   * Step 5 turns this verdict into a routing decision. For now it is
   * recorded and shown. */
  let scan: PolicyScan | null = null;
  if (skipFor(seal)) {
    emit({ type: "scan.skipped", level: seal });
  } else {
    scan = await scanAgainstPolicies(content, input.signal);
    db().prepare(`UPDATE classifications SET policy_scan_json = ? WHERE id = ?`)
      .run(JSON.stringify(scan), clsId);
    writeAudit({
      actor: user.email, kind: "policy.scanned", subject: userMsgId,
      summary: scan.skipped
        ? `Policy scan unavailable (${scan.scanner})`
        : scan.compatible
          ? `No policy breach found by ${scan.scanner}`
          : `Possible breach of ${scan.breached.join(", ")}`,
      detail: { compatible: scan.compatible, breached: scan.breached, reason: scan.reason,
                scanner: scan.scanner, latencyMs: scan.latencyMs, skipped: scan.skipped },
    });
    emit({ type: "scanned", scan });
  }

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
                project: contextSummary && { name: contextSummary.project, mode: contextSummary.mode,
                                             files: [...new Set(contextSummary.excerpts.map((x) => x.filename))] },
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
              attachments: files.map((f) => f.filename),
              project: contextSummary && { name: contextSummary.project, mode: contextSummary.mode,
                                           files: [...new Set(contextSummary.excerpts.map((x) => x.filename))] } },
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
    { role: "user", content: knowledgeBlock(ctx) + withAttachments(content, files) },
  ];
  const system = ctx?.project.instructions
    ? `${SYSTEM}\n\nProject instructions from the user:\n${ctx.project.instructions}`
    : SYSTEM;

  /* ---------- 3a. anonymise, but only for what leaves the building ------
   *
   * On-prem is sovereign ground: it may hold the real thing, and redacting
   * there would cost accuracy to protect data from a machine already trusted
   * with it. Anything bound outward goes as placeholders instead, and the
   * table that reverses them never leaves this process.
   *
   * The whole conversation is anonymised together, not just this turn: a name
   * introduced three turns ago is still a name, and one shared map keeps it
   * the same token throughout. */
  let replacements: Replacement[] = [];
  if (ENV_LEAVES_BOUNDARY[envKey]) {
    const outward = await anonymizeAll(messages.map((m) => m.content));
    if (!outward.available) {
      // Presidio found something to redact and could not do it. The one thing
      // we must not do is send the raw text onward anyway.
      const message =
        "Anonymisation is unavailable, so this request cannot be sent to an external environment. " +
        "Retry, or pin the request to Sovereign On-Prem, which does not redact.";
      // Persist the reason, not an empty body: a reopened thread should still
      // explain why it stopped rather than show a bare failure.
      updateMessage(assistantId, { status: "error", content: message });
      writeAudit({
        actor: user.email, kind: "anonymize.failed", subject: userMsgId,
        summary: `${chosen.name}: redaction unavailable, request withheld`,
        detail: { envKey, level: cls.level, seal },
      });
      emit({ type: "error", message });
      return { ...base, verdict: "ERROR", envKey, reason: message };
    }
    replacements = outward.replacements;
    outward.parts.forEach((content, i) => { messages[i].content = content; });

    if (replacements.length) {
      db().prepare(`UPDATE classifications SET anonymization_json = ? WHERE id = ?`)
        .run(JSON.stringify(replacements), clsId);
      writeAudit({
        actor: user.email, kind: "request.anonymized", subject: userMsgId,
        summary: `${replacements.length} value${replacements.length > 1 ? "s" : ""} replaced before leaving for ${chosen.name}`,
        detail: { envKey, entities: replacements.map((r) => ({ type: r.entityType, as: r.placeholder })) },
      });
    }
    emit({
      type: "anonymized",
      replacements: replacements.map((r) => ({
        placeholder: r.placeholder, entityType: r.entityType, original: r.original,
      })),
      analyzerUp: outward.analyzerUp,
    });
  }

  const started = Date.now();
  let text = "";
  const restorer = createRestorer(replacements);
  acquire(envKey);
  try {
    // Simulated network hop between the core and the chosen environment.
    await sleep(chosen.net_ms);
    const stream = getProvider(envKey).stream({
      messages, system, maxTokens: input.maxTokens, signal: input.signal,
    });
    for await (const chunk of stream) {
      // The reader must never see a placeholder, so rehydrate as it streams.
      const shown = restorer.push(chunk);
      if (shown) { text += shown; emit({ type: "delta", text: shown }); }
    }
    const tail = restorer.flush();
    if (tail) { text += tail; emit({ type: "delta", text: tail }); }
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
  const tokens = estTokens(system + knowledgeBlock(ctx) + withAttachments(content, files)) + estTokens(text);
  const cost = (tokens / 1000) * chosen.cost_per_1k;
  updateMessage(assistantId, {
    content: text, status: "ok", tokens, cost_usd: cost, latency_ms: latency,
  });

  emit({ type: "done", tokens, latencyMs: latency, costUsd: cost });
  return { ...base, verdict: "ALLOW", envKey, reason };
}
