"use client";

import { useActionState, useEffect, useState } from "react";
import { deleteProjectAction, updateProjectAction, type ProjectResult } from "@/app/projects/actions";

/** Project name and description, editable in place, with delete. */
export default function ProjectHeader({ projectId, name, description }: {
  projectId: string; name: string; description: string;
}) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<ProjectResult, FormData>(updateProjectAction, null);

  useEffect(() => { if (state?.ok) setEditing(false); }, [state]);

  if (editing) {
    return (
      <form action={action} className="mt-3 space-y-2">
        <input type="hidden" name="projectId" value={projectId} />
        <input name="name" defaultValue={name} required maxLength={80}
               className="mz-field w-full px-3 py-2 text-[18px] font-semibold" />
        <textarea name="description" defaultValue={description} rows={2} maxLength={500}
                  placeholder="Describe the project"
                  className="mz-field w-full resize-none px-3 py-2 text-[13px] leading-relaxed" />
        <div className="flex items-center gap-2">
          <button type="submit" disabled={pending}
                  className="rounded-full bg-cloud px-4 py-1.5 font-mono text-[11px] font-semibold tracking-[0.08em]
                             text-white transition hover:brightness-110 disabled:opacity-60">
            {pending ? "SAVING…" : "SAVE"}
          </button>
          <button type="button" onClick={() => setEditing(false)}
                  className="rounded-full border border-line px-3.5 py-1.5 font-mono text-[11px] text-ink-mid
                             transition hover:border-ink-faint">
            CANCEL
          </button>
          {state && !state.ok && <span className="text-[12px] text-deny">{state.message}</span>}
        </div>
      </form>
    );
  }

  return (
    <div className="mt-3 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight">{name}</h1>
        {description && <p className="mt-1 max-w-[620px] text-[13px] leading-relaxed text-ink-dim">{description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" onClick={() => setEditing(true)}
                className="rounded-full border border-line px-2.5 py-1 font-mono text-[10px] text-ink-mid
                           transition hover:border-ink-faint hover:text-ink">
          EDIT
        </button>
        <form action={deleteProjectAction}
              onSubmit={(e) => {
                if (!confirm(`Delete project "${name}" and its files? Its chats are kept.`)) e.preventDefault();
              }}>
          <input type="hidden" name="projectId" value={projectId} />
          <button type="submit"
                  className="rounded-full border border-line px-2.5 py-1 font-mono text-[10px] text-ink-dim
                             transition hover:border-deny hover:text-deny">
            DELETE
          </button>
        </form>
      </div>
    </div>
  );
}
