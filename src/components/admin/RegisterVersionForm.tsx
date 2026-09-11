"use client";

import { useActionState } from "react";
import { registerAction, type ActionResult } from "@/app/admin/deployments/actions";

/** Register and sign a new build. It starts absent everywhere. */
export default function RegisterVersionForm({ suggested }: { suggested: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(registerAction, null);

  return (
    <div>
      <form key={suggested} action={action} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="mz-label">Version</span>
          <input
            name="version"
            defaultValue={suggested}
            className="mz-field w-[110px] px-2.5 py-1.5 font-mono text-[12.5px]"
          />
        </label>
        <label className="flex min-w-[240px] flex-1 flex-col gap-1">
          <span className="mz-label">Release notes</span>
          <input
            name="notes"
            placeholder="e.g. Refreshed Arabic tokenizer, tighter refusal behaviour"
            className="mz-field px-2.5 py-1.5 text-[12.5px]"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-primary px-4 py-1.5 font-mono text-[11px] font-semibold
                     tracking-[0.08em] text-white transition hover:bg-primary-active disabled:opacity-60"
        >
          {pending ? "SIGNING…" : "REGISTER & SIGN"}
        </button>
      </form>
      {state && (
        <p className={`mt-2 text-[12px] ${state.ok ? "text-ok" : "text-deny"}`}>{state.message}</p>
      )}
    </div>
  );
}
