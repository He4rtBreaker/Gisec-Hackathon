"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { envAccepts, type EnvKey, type Level } from "@/lib/domain";
import type { Inspection } from "./InspectionCard";
import type { Refusal } from "./RefusalCard";
import MessageList, { type UiMessage } from "./MessageList";
import Composer, { type DraftAttachment } from "./Composer";

interface Props {
  conversationId: string | null;
  initialMessages: UiMessage[];
  sealLevel: Level;
  clearance: Level;
}

export default function ChatView({ conversationId, initialMessages, sealLevel, clearance }: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
  const [convId, setConvId] = useState<string | null>(conversationId);
  const [preferred, setPreferred] = useState<EnvKey | "auto">("auto");
  const [seal, setSeal] = useState<Level>(sealLevel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState<{ text: string; n: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // An escalation can invalidate a target the user pinned earlier in the thread.
  // Drop back to Automatic rather than leaving a selection the policy engine
  // would now refuse.
  useEffect(() => {
    if (preferred !== "auto" && !envAccepts(preferred, seal)) setPreferred("auto");
  }, [seal, preferred]);

  // Adopt server state only when the route genuinely switches threads.
  // `initialMessages` is a fresh array on every server render, so keying the
  // effect on it would let a routine router.refresh() wipe a live exchange.
  const appliedRef = useRef<string | null>(conversationId);
  useEffect(() => {
    if (appliedRef.current === conversationId) return;
    appliedRef.current = conversationId;
    setMessages(initialMessages);
    setConvId(conversationId);
    setSeal(sealLevel);
    setError(null);
  }, [conversationId, initialMessages, sealLevel]);

  async function send(text: string, attachments: DraftAttachment[] = []) {
    if (busy || (!text.trim() && !attachments.length)) return;
    setError(null);
    setBusy(true);

    const localUser: UiMessage = {
      id: `local_${Date.now()}`, role: "user", content: text || "Review the attached file.",
      status: "ok", envKey: null,
      attachments: attachments.map((a) => ({ filename: a.filename, size: a.size })),
    };
    const localAssistant: UiMessage = {
      id: `local_a_${Date.now()}`, role: "assistant", content: "", status: "pending",
      envKey: null, inspecting: true,
    };
    setMessages((m) => [...m, localUser, localAssistant]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: convId, content: text, preferred,
          attachments: attachments.map(({ filename, mime, text: body }) => ({ filename, mime, text: body })),
        }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let newConvId: string | null = null;

      const applyToLast = (fn: (m: UiMessage) => UiMessage) =>
        setMessages((all) => all.map((m, i) => (i === all.length - 1 ? fn(m) : m)));

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const evt = JSON.parse(line) as Record<string, never> & { type: string };

          if (evt.type === "meta") {
            const e = evt as unknown as { conversationId: string };
            newConvId = e.conversationId;
            setConvId(e.conversationId);
          } else if (evt.type === "inspecting") {
            applyToLast((m) => ({ ...m, inspecting: true }));
          } else if (evt.type === "classified") {
            const e = evt as unknown as {
              level: Inspection["level"]; sealLevel: Inspection["level"]; confidence: number;
              rationale: string; signals: Inspection["signals"]; inspector: string;
              latencyMs: number; degraded: boolean;
            };
            setSeal(e.sealLevel);
            applyToLast((m) => ({
              ...m,
              inspecting: false,
              inspection: {
                level: e.level, confidence: e.confidence, rationale: e.rationale,
                signals: e.signals, inspector: e.inspector,
                latencyMs: e.latencyMs, degraded: e.degraded,
              },
            }));
          } else if (evt.type === "routed") {
            const e = evt as unknown as {
              envKey: EnvKey; envName: string; reason: string; overrodePin: boolean;
              artefact: string | null;
            };
            applyToLast((m) => ({
              ...m,
              envKey: e.envKey,
              inspection: m.inspection
                ? {
                    ...m.inspection, envName: e.envName, routeReason: e.reason,
                    overrodePin: e.overrodePin, artefact: e.artefact ?? undefined,
                  }
                : m.inspection,
            }));
          } else if (evt.type === "refused") {
            const e = evt as unknown as {
              reason: string; policyName: string | null; trace: Refusal["trace"];
            };
            applyToLast((m) => ({
              ...m,
              inspecting: false,
              status: "refused",
              refusal: { reason: e.reason, policyName: e.policyName, trace: e.trace },
            }));
          } else if (evt.type === "dispatched") {
            const e = evt as unknown as { envKey: EnvKey };
            applyToLast((m) => ({ ...m, envKey: e.envKey }));
          } else if (evt.type === "delta") {
            const e = evt as unknown as { text: string };
            applyToLast((m) => ({ ...m, content: m.content + e.text, status: "streaming" }));
          } else if (evt.type === "done") {
            const e = evt as unknown as { tokens: number; latencyMs: number; costUsd: number };
            applyToLast((m) => ({
              ...m, status: "ok", tokens: e.tokens, latencyMs: e.latencyMs, costUsd: e.costUsd,
            }));
          } else if (evt.type === "error") {
            const e = evt as unknown as { message: string };
            setError(e.message);
            applyToLast((m) => ({ ...m, status: "error" }));
          }
        }
      }

      // Move the URL onto the real thread, and refresh the sidebar.
      if (newConvId && !conversationId) {
        window.history.replaceState(null, "", `/chat/${newConvId}`);
      }
      // Refresh the sidebar without letting the server's empty message list
      // clobber what this stream just rendered.
      router.refresh();
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : String(err));
        setMessages((all) => all.map((m, i) =>
          i === all.length - 1 ? { ...m, status: "error" } : m));
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }

  return (
    <>
      <header className="flex shrink-0 items-center justify-end gap-3 border-b border-line px-5 py-3">
        <span className="mz-label">Thread seal</span>
        <span className="rounded-md border border-line bg-raised px-2 py-1 font-mono text-[10px] tracking-[0.12em] text-ink-mid">
          {seal}
        </span>
      </header>

      <MessageList messages={messages} onSuggest={(t) => setSeed({ text: t, n: Date.now() })} />

      {error && (
        <div className="mz-anim-in mx-auto w-full max-w-[760px] px-5">
          <p className="rounded-lg border border-deny/40 bg-deny-soft px-3.5 py-2.5 text-[12.5px] text-deny">
            {error}
          </p>
        </div>
      )}

      <Composer
        onSend={send}
        onStop={stop}
        busy={busy}
        preferred={preferred}
        onPreferredChange={setPreferred}
        clearance={clearance}
        seal={seal}
        seed={seed}
      />
    </>
  );
}
