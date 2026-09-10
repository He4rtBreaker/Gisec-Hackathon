"use client";

import { useEffect, useRef, useState } from "react";
import { ENV_CLEARANCE, ENV_MAX_LEVEL, ENV_META, LEVEL_RANK, envAccepts, type EnvKey, type Level } from "@/lib/domain";

type Value = EnvKey | "auto";

interface Props {
  value: Value;
  onChange: (v: Value) => void;
  clearance: Level;
  /** Highest classification this thread has held. Routing cannot go below it. */
  seal: Level;
}

const TOKEN: Record<EnvKey, { dot: string; text: string }> = {
  cloud:  { dot: "bg-cloud",  text: "text-cloud" },
  onprem: { dot: "bg-onprem", text: "text-onprem" },
  airgap: { dot: "bg-airgap", text: "text-airgap" },
};

const OPTIONS: Array<{ key: Value; name: string; short: string; hint: string; needs: Level }> = [
  { key: "auto",   name: "Automatic",          short: "Auto",    hint: "Policy engine selects the environment", needs: "PUBLIC" },
  { key: "cloud",  name: ENV_META.cloud.name,  short: "Cloud",   hint: "Elastic · external egress · $0.31/1k",  needs: ENV_CLEARANCE.cloud },
  { key: "onprem", name: ENV_META.onprem.name, short: "On-Prem", hint: "Abu Dhabi DC-1 · fixed 4 slots",        needs: ENV_CLEARANCE.onprem },
  { key: "airgap", name: ENV_META.airgap.name, short: "Enclave", hint: "Facility K · no outbound network",      needs: ENV_CLEARANCE.airgap },
];

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 10 6" aria-hidden
      className={`h-[6px] w-[10px] shrink-0 text-ink-faint transition-transform duration-150
                  ${open ? "rotate-180" : ""}`}
    >
      <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Compact pill that lives inside the composer and expands upward. */
export default function EnvSelector({ value, onChange, clearance, seal }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const sealed = LEVEL_RANK[seal] > LEVEL_RANK["PUBLIC"];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = OPTIONS.find((o) => o.key === value)!;
  const dot = value === "auto" ? "bg-ink-faint" : TOKEN[value as EnvKey].dot;
  const text = value === "auto" ? "text-ink-mid" : TOKEN[value as EnvKey].text;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition
          ${open ? "border-cloud bg-cloud-soft" : "border-line bg-base hover:border-ink-faint"}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className="text-ink-dim">Routing</span>
        <span className="text-ink-faint">·</span>
        <span className={`font-medium ${text}`}>{current.short}</span>
        <Chevron open={open} />
      </button>

      {open && (
        <div
          role="listbox"
          className="mz-anim-in mz-pop absolute bottom-full left-0 z-30 mb-2 w-[310px]
                     overflow-hidden rounded-xl"
        >
          <div className="mz-label border-b border-line-soft px-3 py-2">Execution target</div>

          {OPTIONS.map((o) => {
            const isEnv = o.key !== "auto";
            // Two independent locks: what the requester is cleared to reach,
            // and what this thread's accumulated sensitivity permits.
            const clearanceLocked = LEVEL_RANK[o.needs] > LEVEL_RANK[clearance];
            const sealLocked = isEnv && !envAccepts(o.key as EnvKey, seal);
            const locked = clearanceLocked || sealLocked;

            const lockReason = clearanceLocked
              ? `Requires ${o.needs} clearance`
              : sealLocked
                ? `Accredited to ${ENV_MAX_LEVEL[o.key as EnvKey]} — this thread holds ${seal} material`
                : null;

            const d = o.key === "auto" ? "bg-ink-faint" : TOKEN[o.key as EnvKey].dot;
            const selected = value === o.key;
            return (
              <button
                key={o.key}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={locked}
                onClick={() => { onChange(o.key); setOpen(false); }}
                className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition
                  ${locked ? "cursor-not-allowed opacity-45" : "hover:bg-raised"}
                  ${selected ? "bg-cloud-soft" : ""}`}
              >
                <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${d}`} />
                <span className="min-w-0 flex-1">
                  <span className={`flex items-center gap-1.5 text-[13px] ${locked ? "text-ink-dim" : "text-ink"}`}>
                    {o.name}
                    {sealLocked && (
                      <svg viewBox="0 0 10 12" aria-label="locked by thread seal"
                           className="h-[11px] w-[9px] shrink-0 text-ink-faint">
                        <path d="M2.5 5V3.2a2.5 2.5 0 015 0V5" fill="none"
                              stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                        <rect x="1" y="5" width="8" height="6" rx="1.4" fill="currentColor" />
                      </svg>
                    )}
                  </span>
                  <span className={`block text-[11.5px] leading-snug ${lockReason ? "text-ink-faint" : "text-ink-dim"}`}>
                    {lockReason ?? o.hint}
                  </span>
                </span>
                {selected && <span className="mt-0.5 text-[11px] text-cloud">✓</span>}
              </button>
            );
          })}

          <p className="border-t border-line-soft px-3 py-2 text-[11px] leading-relaxed text-ink-dim">
            {sealed ? (
              <>
                This thread is sealed at{" "}
                <span className="font-mono text-[10px] tracking-[0.08em] text-ink-mid">{seal}</span>.
                Targets below that accreditation are locked and cannot be reopened — a
                conversation never de-escalates.
              </>
            ) : (
              <>A pinned target is a request, not a guarantee — policy may override or refuse it.</>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
