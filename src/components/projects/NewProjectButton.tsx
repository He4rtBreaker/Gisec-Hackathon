"use client";

import { useActionState, useEffect, useState } from "react";
import { createProjectAction, type ProjectResult } from "@/app/projects/actions";

/** "New project" button and its creation dialog. */
export default function NewProjectButton() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ProjectResult, FormData>(createProjectAction, null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-cloud px-4 py-2 font-mono text-[11px] font-semibold tracking-[0.08em]
                   text-white transition hover:brightness-110"
      >
        + NEW PROJECT
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/20 px-4 py-[14vh]"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <form
            action={action}
            role="dialog"
            aria-modal="true"
            aria-label="Create a project"
            className="mz-anim-in w-full max-w-[520px] rounded-[18px] border border-line bg-overlay p-5
                       shadow-[0_12px_40px_oklch(0.4_0.02_260/0.16)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-mono text-[8.5px] tracking-[0.12em] text-ink-faint">NEW PROJECT</div>
                <div className="mt-1 text-[15px] font-bold">Create a project</div>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close"
                      className="flex h-6 w-6 items-center justify-center rounded-full bg-raised text-[11px]
                                 text-ink-dim transition hover:bg-line">✕</button>
            </div>

            <label className="mt-4 flex flex-col gap-1.5">
              <span className="text-[12.5px] text-ink-mid">What are you working on?</span>
              <input name="name" required autoFocus maxLength={80} placeholder="Name your project"
                     className="mz-field px-3 py-2 text-[13.5px]" />
            </label>
            <label className="mt-3 flex flex-col gap-1.5">
              <span className="text-[12.5px] text-ink-mid">What are you trying to achieve?</span>
              <textarea name="description" rows={3} maxLength={500}
                        placeholder="Describe the project, its goals, subject matter…"
                        className="mz-field resize-none px-3 py-2 text-[13px] leading-relaxed" />
            </label>

            <div className="mt-4 flex items-center justify-end gap-2">
              {state && !state.ok && <span className="mr-auto text-[12px] text-deny">{state.message}</span>}
              <button type="button" onClick={() => setOpen(false)}
                      className="rounded-full border border-line px-4 py-1.5 font-mono text-[11px] text-ink-mid
                                 transition hover:border-ink-faint">
                CANCEL
              </button>
              <button type="submit" disabled={pending}
                      className="rounded-full bg-cloud px-4 py-1.5 font-mono text-[11px] font-semibold tracking-[0.08em]
                                 text-white transition hover:brightness-110 disabled:opacity-60">
                {pending ? "CREATING…" : "CREATE PROJECT"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
