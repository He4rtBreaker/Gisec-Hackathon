"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Level } from "@/lib/domain";
import type { ProjectOption } from "@/lib/projects";

const LEVEL_TEXT: Record<Level, string> = {
  PUBLIC: "text-cloud",
  OFFICIAL: "text-official",
  CONFIDENTIAL: "text-onprem",
  SECRET: "text-airgap",
};

interface Props {
  projects: ProjectOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** A thread keeps its project once used — its knowledge may already be in the history. */
  locked: boolean;
}

function Folder() {
  return (
    <svg viewBox="0 0 16 14" className="h-[12px] w-[13px] shrink-0" aria-hidden>
      <path d="M1.5 3.2c0-.7.5-1.2 1.2-1.2h3.1l1.5 1.6h5.9c.7 0 1.2.5 1.2 1.2v6.5c0 .7-.5 1.2-1.2 1.2H2.7c-.7 0-1.2-.5-1.2-1.2z"
            fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

/** Composer pill that attaches a project's knowledge to the chat. Expands upward. */
export default function ProjectPicker({ projects, value, onChange, locked }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  const current = projects.find((p) => p.id === value) ?? null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !locked && setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-disabled={locked}
        title={locked ? "This chat is bound to its project" : "Attach a project's knowledge"}
        className={`flex max-w-[220px] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition
          ${open ? "border-cloud bg-cloud-soft" : "border-line bg-base"}
          ${locked ? "cursor-default" : "hover:border-ink-faint"}`}
      >
        <span className={current ? "text-ink-mid" : "text-ink-faint"}><Folder /></span>
        <span className="text-ink-dim">Project</span>
        <span className="text-ink-faint">·</span>
        <span className={`truncate font-medium ${current ? "text-ink" : "text-ink-mid"}`}>
          {current?.name ?? "None"}
        </span>
        {locked ? (
          <svg viewBox="0 0 10 12" aria-label="locked" className="h-[11px] w-[9px] shrink-0 text-ink-faint">
            <path d="M2.5 5V3.2a2.5 2.5 0 015 0V5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <rect x="1" y="5" width="8" height="6" rx="1.4" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 10 6" aria-hidden
               className={`h-[6px] w-[10px] shrink-0 text-ink-faint transition-transform duration-150 ${open ? "rotate-180" : ""}`}>
            <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {open && (
        <div role="listbox" className="mz-anim-in mz-pop absolute bottom-full left-0 z-30 mb-2 w-[300px] overflow-hidden rounded-xl">
          <div className="mz-label border-b border-line-soft px-3 py-2">Project knowledge</div>

          <button type="button" role="option" aria-selected={!current}
                  onClick={() => { onChange(null); setOpen(false); }}
                  className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition hover:bg-raised
                              ${!current ? "bg-cloud-soft" : ""}`}>
            <span className="mt-[3px] text-ink-faint"><Folder /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] text-ink">No project</span>
              <span className="block text-[11.5px] text-ink-dim">Chat without project knowledge</span>
            </span>
            {!current && <span className="mt-0.5 text-[11px] text-cloud">✓</span>}
          </button>

          <div className="max-h-[260px] overflow-y-auto">
            {projects.map((p) => {
              const selected = p.id === value;
              return (
                <button key={p.id} type="button" role="option" aria-selected={selected}
                        onClick={() => { onChange(p.id); setOpen(false); }}
                        className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition hover:bg-raised
                                    ${selected ? "bg-cloud-soft" : ""}`}>
                  <span className="mt-[3px] text-ink-dim"><Folder /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{p.name}</span>
                    <span className="block text-[11.5px] text-ink-dim">
                      {p.files} file{p.files === 1 ? "" : "s"}
                      {p.level && <> · <span className={`font-mono text-[10px] ${LEVEL_TEXT[p.level]}`}>{p.level}</span></>}
                    </span>
                  </span>
                  {selected && <span className="mt-0.5 text-[11px] text-cloud">✓</span>}
                </button>
              );
            })}
            {projects.length === 0 && (
              <p className="px-3 py-2.5 text-[12px] text-ink-faint">No projects yet.</p>
            )}
          </div>

          <Link href="/projects"
                className="block border-t border-line-soft px-3 py-2 text-[11.5px] text-ink-dim transition hover:bg-raised hover:text-ink">
            Manage projects →
          </Link>
        </div>
      )}
    </div>
  );
}
