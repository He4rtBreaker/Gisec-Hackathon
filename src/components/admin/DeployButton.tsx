"use client";

import { useActionState } from "react";
import { deployAction, type ActionResult } from "@/app/admin/deployments/actions";
import type { EnvKey } from "@/lib/domain";

type Op = "activate" | "export" | "transfer" | "verify";

const TONE = {
  primary: "bg-primary text-white hover:bg-primary-active",
  airgap:  "bg-airgap text-white hover:bg-primary-active",
  ghost:   "border border-line bg-overlay text-ink-mid hover:border-ink-faint hover:text-ink",
} as const;

interface Props {
  op: Op;
  artefactId: string;
  env: EnvKey;
  label: string;
  pendingLabel?: string;
  tone?: keyof typeof TONE;
}

/** One lifecycle transition, posted as a server action. */
export default function DeployButton({ op, artefactId, env, label, pendingLabel, tone = "ghost" }: Props) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(deployAction, null);

  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="artefactId" value={artefactId} />
      <input type="hidden" name="env" value={env} />
      <button
        type="submit"
        disabled={pending}
        className={`rounded-full px-3 py-1 font-mono text-[10.5px] tracking-[0.06em] transition
                    disabled:cursor-wait disabled:opacity-60 ${TONE[tone]}`}
      >
        {pending ? (pendingLabel ?? "Working…") : label}
      </button>
      {state && !state.ok && (
        <span className="max-w-[220px] text-[11px] leading-snug text-deny">{state.message}</span>
      )}
    </form>
  );
}
