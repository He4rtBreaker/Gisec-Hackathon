"use client";

import { useEffect, useRef } from "react";
import { ENV_META, type EnvKey } from "@/lib/domain";
import InspectionCard, { InspectingStrip, type Inspection } from "./InspectionCard";
import RefusalCard, { type Refusal } from "./RefusalCard";
import DecryptedText from "./DecryptedText";

export interface UiMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: "ok" | "refused" | "error" | "pending" | "streaming";
  envKey: EnvKey | null;
  tokens?: number;
  latencyMs?: number;
  costUsd?: number;
  /** Populated once the on-prem inspector returns. */
  inspection?: Inspection;
  /** True between dispatch of the request and the inspector's verdict. */
  inspecting?: boolean;
  /** Present when policy refused to route the request. */
  refusal?: Refusal;
  /** Files sent with a user turn. */
  attachments?: Array<{ filename: string; size: number }>;
}

const ENV_TEXT: Record<EnvKey, string> = {
  cloud: "text-cloud",
  onprem: "text-onprem",
  airgap: "text-airgap",
};
const ENV_DOT: Record<EnvKey, string> = {
  cloud: "bg-cloud",
  onprem: "bg-onprem",
  airgap: "bg-airgap",
};

function EnvBadge({ envKey }: { envKey: EnvKey }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${ENV_DOT[envKey]}`} />
      <span className={`font-mono text-[10px] tracking-[0.12em] ${ENV_TEXT[envKey]}`}>
        {ENV_META[envKey].short}
      </span>
    </span>
  );
}

function Empty() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <img
        src="/illustrations/inspect-document.png"
        alt=""
        aria-hidden
        className="mz-anim-float mb-6 h-[104px] w-[104px] object-contain opacity-90 select-none"
        draggable={false}
      />
      <DecryptedText
        text="Mizan"
        animateOn="view"
        sequential
        speed={35}
        maxIterations={8}
        parentClassName="font-serif text-[34px] font-normal tracking-tight"
        className="text-ink"
        encryptedClassName="text-ink-faint"
      />
    </div>
  );
}

function AttachmentChips({ files }: { files: Array<{ filename: string; size: number }> }) {
  return (
    <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
      {files.map((f, i) => (
        <span key={`${f.filename}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-overlay px-2 py-1
                         text-[11.5px] text-ink-mid">
          <span className="font-mono text-[9px] tracking-[0.1em] text-ink-faint">FILE</span>
          <span className="max-w-[220px] truncate">{f.filename}</span>
          <span className="font-mono text-[10px] text-ink-faint">
            {f.size < 1024 ? `${f.size} B` : `${(f.size / 1024).toFixed(1)} KB`}
          </span>
        </span>
      ))}
    </div>
  );
}

export default function MessageList({
  messages, onSuggest,
}: { messages: UiMessage[]; onSuggest?: (text: string) => void }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  if (messages.length === 0) {
    return <div className="min-h-0 flex-1 overflow-y-auto"><Empty /></div>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[760px] px-5 py-8 space-y-7">
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex flex-col items-end">
              {m.attachments && m.attachments.length > 0 && <AttachmentChips files={m.attachments} />}
              <div className="max-w-[85%] rounded-2xl rounded-br-md border border-line bg-raised
                              px-4 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-wrap">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={m.id} className="mz-anim-in">
              {m.inspecting && <div className="mb-3"><InspectingStrip /></div>}
              {m.inspection && <div className="mb-3"><InspectionCard data={m.inspection} /></div>}

              {m.refusal && <RefusalCard data={m.refusal} />}

              {!m.refusal && (
              <>
              <div className="mb-2 flex items-center gap-3">
                <span className="mz-label">Mizan</span>
                {m.envKey && <EnvBadge envKey={m.envKey} />}
                {m.status === "pending" && (
                  <span className="mz-label mz-anim-pulse text-cloud">dispatching…</span>
                )}
              </div>

              <div className="text-[14.5px] leading-[1.75] text-ink whitespace-pre-wrap">
                {m.content}
                {m.status === "streaming" && (
                  <span className="ml-0.5 inline-block h-[15px] w-[7px] translate-y-[2px] bg-cloud mz-anim-pulse" />
                )}
              </div>

              {m.status === "ok" && m.tokens ? (
                <div className="mt-2.5 flex items-center gap-3 font-mono text-[10px] text-ink-faint">
                  <span>{m.tokens} tok</span>
                  <span>·</span>
                  <span>{m.latencyMs}ms</span>
                  <span>·</span>
                  <span>${(m.costUsd ?? 0).toFixed(4)}</span>
                </div>
              ) : null}

              {m.status === "error" && (
                <p className="mt-2 text-[12.5px] text-deny">
                  Execution failed in {m.envKey ? ENV_META[m.envKey].name : "the selected environment"}.
                </p>
              )}
              </>
              )}
            </div>
          )
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
