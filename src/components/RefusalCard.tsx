"use client";

import { useState } from "react";

export interface TraceEntry {
  policyId: string;
  name: string;
  priority: number;
  action: "ROUTE" | "REFUSE";
  envKey: string | null;
  matched: boolean;
  note: string;
}

export interface Refusal {
  reason: string;
  policyName: string | null;
  trace: TraceEntry[];
}

/** Shown in place of a model response when policy refuses to route a request. */
export default function RefusalCard({ data }: { data: Refusal }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mz-anim-in overflow-hidden rounded-lg border border-deny/40 bg-deny-soft">
      <div className="flex items-start gap-2.5 px-3.5 py-3">
        <span className="mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center
                         rounded-full border border-deny/50 font-mono text-[10px] text-deny">
          ✕
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] font-semibold tracking-[0.14em] text-deny">
            REQUEST REFUSED
          </div>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink">{data.reason}</p>
          {data.policyName && (
            <p className="mt-1.5 text-[11.5px] text-ink-dim">
              Refused by policy <span className="font-medium text-ink-mid">{data.policyName}</span>.
              Nothing was dispatched to any environment.
            </p>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group flex w-full items-center gap-2 border-t border-deny/25 px-3.5 py-2
                   text-left transition hover:bg-deny/[0.04]"
      >
        <span className="mz-label">Policy trace</span>
        <span className="ml-auto flex items-center gap-1 rounded border border-deny/30 bg-base
                         px-1.5 py-0.5 font-mono text-[9px] tracking-[0.10em] text-ink-dim
                         transition group-hover:text-ink-mid">
          {open ? "HIDE" : `${data.trace.length} RULES`}
          <svg viewBox="0 0 10 6" aria-hidden
               className={`h-[6px] w-[10px] transition-transform duration-150 ${open ? "rotate-180" : ""}`}>
            <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5"
                  strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <ol className="mz-anim-in divide-y divide-line-soft border-t border-deny/25 bg-overlay">
          {data.trace.map((t) => (
            <li key={t.policyId} className="flex items-start gap-2.5 px-3.5 py-2">
              <span className="mt-[3px] font-mono text-[10px] text-ink-faint">
                {String(t.priority).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={`text-[12.5px] ${t.matched ? "text-ink" : "text-ink-dim"}`}>
                    {t.name}
                  </span>
                  <span className={`font-mono text-[9px] tracking-[0.10em]
                    ${t.action === "REFUSE" ? "text-deny" : "text-ink-faint"}`}>
                    {t.action}
                  </span>
                </span>
                <span className="block text-[11.5px] leading-snug text-ink-dim">{t.note}</span>
              </span>
              <span className={`mt-[3px] font-mono text-[9px] tracking-[0.10em]
                ${t.matched ? "text-deny" : "text-ink-faint"}`}>
                {t.matched ? "MATCH" : "skip"}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
