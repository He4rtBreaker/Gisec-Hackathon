import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getConversation, listMessages } from "@/lib/conversations";
import { db } from "@/lib/db";
import ChatView from "@/components/ChatView";
import type { UiMessage } from "@/components/MessageList";
import type { Inspection } from "@/components/InspectionCard";
import type { Refusal } from "@/components/RefusalCard";
import { ENV_META } from "@/lib/domain";

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const conv = getConversation(id, user.id);
  if (!conv) notFound();

  const rows = listMessages(conv.id).filter((m) => m.role !== "system");

  // Classifications are recorded against the user turn that triggered them;
  // the UI shows them attached to the assistant reply that followed.
  const inspections = new Map<string, ReturnType<typeof loadInspection>>();
  for (const m of rows) {
    if (m.role === "user") inspections.set(m.id, loadInspection(m.id));
  }

  const messages: UiMessage[] = [];
  let pending: ReturnType<typeof loadInspection> = null;
  let pendingRefusal: Refusal | null = null;

  for (const m of rows) {
    if (m.role === "user") {
      pending = inspections.get(m.id) ?? null;
      pendingRefusal = loadRefusal(m.id);
      messages.push({
        id: m.id, role: "user", content: m.content,
        status: m.status === "pending" ? "error" : m.status,
        envKey: m.env_key,
        attachments: db().prepare(
          `SELECT filename, size_bytes AS size FROM attachments WHERE message_id = ?`
        ).all(m.id) as Array<{ filename: string; size: number }>,
      });
    } else {
      messages.push({
        id: m.id,
        role: "assistant",
        content: m.content,
        status: m.status === "pending" ? "error" : m.status,
        envKey: m.env_key,
        tokens: m.tokens,
        latencyMs: m.latency_ms,
        costUsd: m.cost_usd,
        inspection: pending
          ? { ...pending, envName: m.env_key ? ENV_META[m.env_key].name : undefined }
          : undefined,
        refusal: m.status === "refused" && pendingRefusal ? pendingRefusal : undefined,
      });
      pending = null;
      pendingRefusal = null;
    }
  }

  return (
    <ChatView
      conversationId={conv.id}
      initialMessages={messages}
      sealLevel={conv.seal_level}
      clearance={user.clearance}
    />
  );
}

/** Rehydrate a stored classification for display. */
function loadInspection(userMessageId: string): Inspection | null {
  const row = db().prepare(
    `SELECT level, confidence, rationale, signals_json, inspector, latency_ms
       FROM classifications WHERE message_id = ? ORDER BY created_at DESC LIMIT 1`
  ).get(userMessageId) as {
    level: Inspection["level"]; confidence: number; rationale: string;
    signals_json: string; inspector: string; latency_ms: number;
  } | undefined;
  if (!row) return null;

  const route = db().prepare(
    `SELECT reason, artefact_ref FROM routing_decisions
      WHERE message_id = ? AND verdict = 'ALLOW' ORDER BY created_at DESC LIMIT 1`
  ).get(userMessageId) as { reason: string; artefact_ref: string | null } | undefined;

  return {
    level: row.level,
    confidence: row.confidence,
    rationale: row.rationale,
    signals: JSON.parse(row.signals_json) as Inspection["signals"],
    inspector: row.inspector,
    latencyMs: row.latency_ms,
    degraded: false,
    routeReason: route?.reason,
    artefact: route?.artefact_ref ?? undefined,
  };
}

/** Rehydrate a stored refusal, so a reopened thread still explains itself. */
function loadRefusal(userMessageId: string): Refusal | null {
  const row = db().prepare(
    `SELECT r.verdict, r.reason, r.trace_json, p.name AS policy_name
       FROM routing_decisions r
       LEFT JOIN policies p ON p.id = r.matched_policy_id
      WHERE r.message_id = ? ORDER BY r.created_at DESC LIMIT 1`
  ).get(userMessageId) as {
    verdict: string; reason: string; trace_json: string; policy_name: string | null;
  } | undefined;
  if (!row || row.verdict !== "REFUSE") return null;

  const trace = JSON.parse(row.trace_json) as Refusal["trace"];
  // Engine-level guards (the pin checks) are not rows in `policies`; their name
  // lives only on the refusing trace entry.
  const guard = trace.find((t) => t.matched && t.action === "REFUSE");

  return {
    reason: row.reason,
    policyName: row.policy_name ?? guard?.name ?? null,
    trace,
  };
}
