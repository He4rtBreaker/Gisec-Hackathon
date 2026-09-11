"use client";

import { useActionState } from "react";
import { simulateAction, type SimResult } from "@/app/admin/policies/actions";
import { ENV_META, LEVELS, type EnvKey, type Level } from "@/lib/domain";

const ENV_TEXT: Record<EnvKey, string> = { cloud: "text-cloud", onprem: "text-onprem", airgap: "text-airgap" };

/** Dry-run the live rule set: what would happen to a request like this, and why. */
export default function PolicySimulator({ signals }: { signals: Array<{ code: string; level: Level }> }) {
  const [state, action, pending] = useActionState<SimResult, FormData>(simulateAction, null);
  const field = "mz-field px-2.5 py-1.5 text-[12.5px]";

  return (
    <section className="mz-panel overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <div className="mz-label">Policy simulator</div>
        <p className="mt-0.5 text-[12px] text-ink-dim">
          Test the live rules — including current capacity, status and deployments — against a
          hypothetical request. Nothing is dispatched or logged.
        </p>
      </div>

      <form action={action} className="space-y-3 px-4 py-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="mz-label">Thread level</span>
            <select name="level" defaultValue="CONFIDENTIAL" className={field}>
              {LEVELS.map((l) => <option key={l}>{l}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="mz-label">Requester clearance</span>
            <select name="clearance" defaultValue="CONFIDENTIAL" className={field}>
              {LEVELS.map((l) => <option key={l}>{l}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="mz-label">Pinned target</span>
            <select name="pinned" defaultValue="auto" className={field}>
              <option value="auto">Automatic</option>
              {(["cloud", "onprem", "airgap"] as EnvKey[]).map((k) => (
                <option key={k} value={k}>{ENV_META[k].name}</option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={pending}
                  className="rounded-full bg-primary px-4 py-2 font-mono text-[11px] font-semibold tracking-[0.08em]
                             text-white transition hover:bg-primary-active disabled:opacity-60">
            {pending ? "EVALUATING…" : "EVALUATE"}
          </button>
        </div>

        <div>
          <span className="mz-label">Signals present</span>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
            {signals.map((s) => (
              <label key={s.code} className="flex items-center gap-1.5 font-mono text-[10.5px]">
                <input type="checkbox" name="signals" value={s.code} /> {s.code}
              </label>
            ))}
          </div>
        </div>
      </form>

      {state && "error" in state && (
        <p className="border-t border-line px-4 py-3 text-[12px] text-deny">{state.error}</p>
      )}

      {state && "decision" in state && (
        <div className="border-t border-line px-4 py-4">
          {state.decision.verdict === "ALLOW" && state.decision.envKey ? (
            <div className="rounded-lg border border-ok/40 bg-onprem-soft px-3 py-2">
              <span className="font-mono text-[10px] font-semibold tracking-[0.12em] text-ok">ALLOW</span>
              <span className={`ml-2 font-mono text-[12px] font-semibold ${ENV_TEXT[state.decision.envKey]}`}>
                → {ENV_META[state.decision.envKey].name}
              </span>
              <p className="mt-1 text-[12.5px] text-ink-mid">{state.decision.reason}</p>
            </div>
          ) : (
            <div className="rounded-lg border border-deny/40 bg-deny-soft px-3 py-2">
              <span className="font-mono text-[10px] font-semibold tracking-[0.12em] text-deny">REFUSE</span>
              <span className="ml-2 text-[12px] text-ink-mid">{state.decision.matchedPolicyName ?? "Default deny"}</span>
              <p className="mt-1 text-[12.5px] text-ink-mid">{state.decision.reason}</p>
            </div>
          )}

          <div className="mz-label mb-1.5 mt-4">Trace</div>
          <ol className="space-y-1">
            {state.decision.trace.map((t, i) => (
              <li key={i} className="grid grid-cols-[36px_16px_210px_1fr] items-baseline gap-2 font-mono text-[10.5px]">
                <span className="text-ink-faint">{t.priority || "—"}</span>
                <span className={t.matched ? (t.action === "REFUSE" ? "text-deny" : "text-ok") : "text-ink-faint"}>
                  {t.matched ? "●" : "○"}
                </span>
                <span className={t.matched ? "text-ink" : "text-ink-dim"}>{t.name}</span>
                <span className="font-sans text-[11.5px] text-ink-dim">{t.note}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
