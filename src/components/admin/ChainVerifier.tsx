"use client";

import { useActionState } from "react";
import { verifyChainAction } from "@/app/admin/actions";
import type { ChainReport } from "@/lib/audit";

/** Re-hash the whole ledger on demand and report the first entry that fails. */
export default function ChainVerifier() {
  const [state, action, pending] = useActionState<ChainReport | null, FormData>(verifyChainAction, null);

  return (
    <div className="flex max-w-[460px] flex-col items-end gap-2">
      <form action={action}>
        <button type="submit" disabled={pending}
                className="rounded-full bg-cloud px-4 py-1.5 font-mono text-[11px] font-semibold tracking-[0.08em]
                           text-white transition hover:brightness-110 disabled:opacity-60">
          {pending ? "VERIFYING…" : "VERIFY CHAIN"}
        </button>
      </form>
      {state?.ok && (
        <p className="text-right text-[12px] text-ok">
          ✓ Intact — all {state.total} entries re-hashed; every link holds.
        </p>
      )}
      {state && !state.ok && state.brokenAt && (
        <div className="rounded-lg border border-deny/40 bg-deny-soft px-3 py-2 text-[12px] text-deny">
          <div className="font-semibold">✕ Broken at entry {state.checked + 1} of {state.total}</div>
          <div>{state.brokenAt.problem}</div>
          <div className="mt-1 font-mono text-[10.5px] text-ink-mid">
            {state.brokenAt.kind} · {state.brokenAt.summary}
          </div>
        </div>
      )}
    </div>
  );
}
