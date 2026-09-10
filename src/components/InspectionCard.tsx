"use client";

import { useState } from "react";
import { LEVEL_META, type Level } from "@/lib/domain";
import type { ContextSummary } from "@/lib/projects";

export interface Signal {
  code: string;
  label: string;
  level: Level;
  count: number;
  sample: string;
}

export interface Inspection {
  level: Level;
  confidence: number;
  rationale: string;
  signals: Signal[];
  inspector: string;
  latencyMs: number;
  degraded: boolean;
  /** Filled once routing resolves. */
  envName?: string;
  routeReason?: string;
  overrodePin?: boolean;
  /** Model artefact that served the request, e.g. "mizan-assistant v2.4.1". */
  artefact?: string;
  /** Project knowledge that accompanied the request. */
  context?: ContextSummary | null;
}

const LEVEL_STYLE: Record<Level, { text: string; dot: string; ring: string }> = {
  PUBLIC:       { text: "text-cloud",    dot: "bg-cloud",    ring: "border-cloud/35 bg-cloud-soft" },
  OFFICIAL:     { text: "text-official", dot: "bg-official", ring: "border-official/35 bg-official-soft" },
  CONFIDENTIAL: { text: "text-onprem",   dot: "bg-onprem",   ring: "border-onprem/35 bg-onprem-soft" },
  SECRET:       { text: "text-airgap",   dot: "bg-airgap",   ring: "border-airgap/35 bg-airgap-soft" },
};

/** Live state while the inspector is still running. */
export function InspectingStrip() {
  return (
    <div className="mz-anim-in flex items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cloud opacity-70" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cloud" />
      </span>
      <span className="mz-label text-cloud">Inspecting on sovereign infrastructure…</span>
    </div>
  );
}

export default function InspectionCard({ data }: { data: Inspection }) {
  const [open, setOpen] = useState(false);
  const s = LEVEL_STYLE[data.level];

  return (
    <div className={`mz-anim-in overflow-hidden rounded-lg border ${s.ring}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-black/[0.02]"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.dot}`} />
        <span className={`font-mono text-[10px] font-semibold tracking-[0.14em] ${s.text}`}>
          {data.level}
        </span>

        {data.signals.length > 0 && (
          <span className="mz-label normal-case tracking-normal">
            {data.signals.length} signal{data.signals.length > 1 ? "s" : ""}
          </span>
        )}

        {data.envName && (
          <span className="mz-label normal-case tracking-normal truncate">
            → {data.envName}
          </span>
        )}

        {data.context && data.context.excerpts.length > 0 && (
          <span className="mz-label normal-case tracking-normal truncate">
            · {data.context.excerpts.length} excerpt{data.context.excerpts.length > 1 ? "s" : ""} from {data.context.project}
          </span>
        )}

        {data.degraded && (
          <span className="rounded border border-warn/40 bg-warn-soft px-1.5 py-px font-mono
                           text-[9px] tracking-[0.10em] text-warn">
            RULES ONLY
          </span>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-2.5">
          <span className="font-mono text-[10px] text-ink-faint">
            {Math.round(data.confidence * 100)}% · {data.latencyMs}ms
          </span>
          <span className="flex items-center gap-1 rounded border border-line bg-base px-1.5 py-0.5
                           font-mono text-[9px] tracking-[0.10em] text-ink-dim transition
                           group-hover:border-ink-faint group-hover:text-ink-mid">
            {open ? "HIDE" : "REASONING"}
            <svg viewBox="0 0 10 6" aria-hidden
                 className={`h-[6px] w-[10px] transition-transform duration-150 ${open ? "rotate-180" : ""}`}>
              <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </span>
      </button>

      {open && (
        <div className="mz-anim-in space-y-3 border-t border-line-soft bg-overlay px-3 py-3">
          <div>
            <div className="mz-label mb-1">Verdict</div>
            <p className="text-[12.5px] leading-relaxed text-ink-mid">{data.rationale}</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-dim">
              {LEVEL_META[data.level].blurb}
            </p>
          </div>

          {data.signals.length > 0 && (
            <div>
              <div className="mz-label mb-1.5">Matched signals</div>
              <ul className="space-y-1">
                {data.signals.map((sig) => {
                  const st = LEVEL_STYLE[sig.level];
                  return (
                    <li key={sig.code} className="flex items-center gap-2 text-[12px]">
                      <span className={`h-1 w-1 shrink-0 rounded-full ${st.dot}`} />
                      <span className="text-ink-mid">{sig.label}</span>
                      {sig.count > 1 && (
                        <span className="font-mono text-[10px] text-ink-faint">×{sig.count}</span>
                      )}
                      <span className="ml-auto truncate font-mono text-[10.5px] text-ink-faint">
                        {sig.sample}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {data.routeReason && (
            <div>
              <div className="mz-label mb-1">Routing</div>
              <p className="text-[12.5px] leading-relaxed text-ink-mid">{data.routeReason}</p>
              {data.artefact && (
                <p className="mt-1 font-mono text-[10.5px] text-ink-dim">served by {data.artefact}</p>
              )}
              {data.overrodePin && (
                <p className="mt-1 text-[11.5px] text-warn">
                  Your pinned target was overridden by policy.
                </p>
              )}
            </div>
          )}

          {data.context && (
            <div>
              <div className="mz-label mb-1">Project knowledge</div>
              <p className="text-[12px] leading-relaxed text-ink-dim">
                {data.context.excerpts.length === 0
                  ? <>“{data.context.project}” has no files yet.</>
                  : data.context.mode === "full"
                    ? <>All files of “{data.context.project}” were included in full.</>
                    : <>The {data.context.excerpts.length} most relevant excerpts were retrieved from “{data.context.project}” on-prem.</>}
                {" "}Excerpts inherit their file&apos;s classification.
              </p>
              {data.context.excerpts.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {data.context.excerpts.map((x, i) => (
                    <li key={`${x.filename}-${x.part}-${i}`} className="flex items-center gap-2 text-[12px]">
                      <span className={`h-1 w-1 shrink-0 rounded-full ${LEVEL_STYLE[x.level].dot}`} />
                      <span className="truncate text-ink-mid">{x.filename}</span>
                      {data.context!.mode === "retrieval" && (
                        <span className="font-mono text-[10px] text-ink-faint">part {x.part}</span>
                      )}
                      <span className={`ml-auto font-mono text-[10px] ${LEVEL_STYLE[x.level].text}`}>{x.level}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="border-t border-line-soft pt-2 font-mono text-[10px] text-ink-faint">
            inspector · {data.inspector}
          </div>
        </div>
      )}
    </div>
  );
}
