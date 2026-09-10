"use client";

import { useActionState, useEffect, useState } from "react";
import {
  deletePolicyAction, savePolicyAction, togglePolicyAction, type SaveResult,
} from "@/app/admin/policies/actions";
import type { ConditionType, PolicyView } from "@/lib/policies";
import type { PolicyCondition } from "@/lib/policy/engine";
import { ENV_META, LEVELS, type EnvKey, type Level } from "@/lib/domain";

interface SignalOption { code: string; level: Level }

const ENV_TEXT: Record<EnvKey, string> = { cloud: "text-cloud", onprem: "text-onprem", airgap: "text-airgap" };
const ENV_KEYS: EnvKey[] = ["cloud", "onprem", "airgap"];

const CTYPES: Array<{ key: ConditionType; label: string }> = [
  { key: "level",            label: "Classification is one of" },
  { key: "minLevel",         label: "Classification at or above" },
  { key: "exceedsClearance", label: "Classification above requester clearance" },
  { key: "signals",          label: "Any of these detector signals fired" },
  { key: "always",           label: "Always (terminal rule)" },
];

function ctypeOf(c?: PolicyCondition): ConditionType {
  if (!c) return "level";
  if (c.always) return "always";
  if (c.exceedsClearance) return "exceedsClearance";
  if (c.signals) return "signals";
  if (c.minLevel) return "minLevel";
  return "level";
}

export default function PolicyTable({ policies, signals }: { policies: PolicyView[]; signals: SignalOption[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const close = () => setEditing(null);
  const nextPriority = Math.min(998, Math.max(0, ...policies.filter((p) => p.priority < 99).map((p) => p.priority)) + 5);

  return (
    <section className="mz-panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <div className="mz-label">Rules</div>
          <p className="mt-0.5 text-[12px] text-ink-dim">
            {policies.filter((p) => p.enabled).length} of {policies.length} enabled. Every change is written to the audit ledger.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="rounded-full bg-primary px-3.5 py-1.5 font-mono text-[11px] font-semibold tracking-[0.08em]
                     text-white transition hover:opacity-90"
        >
          + NEW RULE
        </button>
      </div>

      {editing === "new" && (
        <PolicyForm signals={signals} onDone={close} defaultPriority={nextPriority} />
      )}

      <ol className="divide-y divide-line-soft">
        {policies.map((p) =>
          editing === p.id ? (
            <li key={p.id}><PolicyForm initial={p} signals={signals} onDone={close} /></li>
          ) : (
            <li key={p.id} className={`grid grid-cols-[52px_1fr_230px_150px_auto] items-start gap-4 px-4 py-3
                                      ${p.enabled ? "" : "bg-surface"}`}>
              <span className="font-mono text-[15px] font-semibold text-ink-mid">{p.priority}</span>
              <div className="min-w-0">
                <div className={`text-[13px] font-medium ${p.enabled ? "" : "text-ink-faint line-through"}`}>{p.name}</div>
                {p.description && <div className="text-[11.5px] leading-snug text-ink-dim">{p.description}</div>}
                {p.warnings.map((w) => (
                  <div key={w} className="mt-1 text-[11.5px] leading-snug text-warn">⚠ {w}</div>
                ))}
              </div>
              <span className="font-mono text-[10.5px] leading-relaxed text-ink-mid">{p.summary}</span>
              <span>
                {p.action === "REFUSE" ? (
                  <span className="rounded border border-deny/40 bg-deny-soft px-1.5 py-0.5 font-mono text-[10px]
                                   tracking-[0.10em] text-deny">REFUSE</span>
                ) : (
                  <span className="font-mono text-[10.5px]">
                    <span className="text-ink-dim">ROUTE → </span>
                    <span className={`font-semibold ${p.envKey ? ENV_TEXT[p.envKey] : ""}`}>
                      {p.envKey ? ENV_META[p.envKey].short : "?"}
                    </span>
                  </span>
                )}
              </span>
              <div className="flex items-center gap-1.5">
                <form action={togglePolicyAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <button type="submit" className={`rounded-full border px-2 py-0.5 font-mono text-[10px] transition
                    ${p.enabled ? "border-ok/40 bg-onprem-soft text-ok" : "border-line text-ink-faint"}`}>
                    {p.enabled ? "ON" : "OFF"}
                  </button>
                </form>
                <button type="button" onClick={() => setEditing(p.id)}
                        className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-ink-mid
                                   transition hover:border-ink-faint hover:text-ink">
                  EDIT
                </button>
                <form action={deletePolicyAction}
                      onSubmit={(e) => { if (!confirm(`Delete rule "${p.name}"?`)) e.preventDefault(); }}>
                  <input type="hidden" name="id" value={p.id} />
                  <button type="submit" className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px]
                                                   text-ink-dim transition hover:border-deny hover:text-deny">
                    ✕
                  </button>
                </form>
              </div>
            </li>
          )
        )}
      </ol>
    </section>
  );
}

function PolicyForm({ initial, signals, onDone, defaultPriority }: {
  initial?: PolicyView;
  signals: SignalOption[];
  onDone: () => void;
  defaultPriority?: number;
}) {
  const [state, action, pending] = useActionState<SaveResult, FormData>(savePolicyAction, null);
  const [ctype, setCtype] = useState<ConditionType>(ctypeOf(initial?.cond));
  const [act, setAct] = useState<"ROUTE" | "REFUSE">(initial?.action ?? "ROUTE");

  useEffect(() => { if (state?.ok) onDone(); }, [state, onDone]);

  const field = "mz-field px-2.5 py-1.5 text-[12.5px]";

  return (
    <form action={action} className="space-y-3 border-b border-line bg-surface px-4 py-4">
      <input type="hidden" name="id" value={initial?.id ?? ""} />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_100px_130px_150px]">
        <label className="flex flex-col gap-1">
          <span className="mz-label">Name</span>
          <input name="name" defaultValue={initial?.name} required className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="mz-label">Priority</span>
          <input name="priority" type="number" min={1} max={999}
                 defaultValue={initial?.priority ?? defaultPriority} className={`${field} font-mono`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="mz-label">Action</span>
          <select name="action" value={act} onChange={(e) => setAct(e.target.value as "ROUTE" | "REFUSE")} className={field}>
            <option value="ROUTE">ROUTE</option>
            <option value="REFUSE">REFUSE</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="mz-label">Target</span>
          <select name="envKey" defaultValue={initial?.envKey ?? "onprem"} disabled={act === "REFUSE"} className={field}>
            {ENV_KEYS.map((k) => <option key={k} value={k}>{ENV_META[k].name}</option>)}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="mz-label">Description — shown to the requester when this rule refuses</span>
        <input name="description" defaultValue={initial?.description} className={field} />
      </label>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[300px_1fr]">
        <label className="flex flex-col gap-1">
          <span className="mz-label">Condition</span>
          <select name="ctype" value={ctype} onChange={(e) => setCtype(e.target.value as ConditionType)} className={field}>
            {CTYPES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>

        <div className="flex flex-col gap-1">
          <span className="mz-label">Parameters</span>
          {ctype === "level" && (
            <div className="flex flex-wrap gap-3 pt-1">
              {LEVELS.map((l) => (
                <label key={l} className="flex items-center gap-1.5 font-mono text-[11px]">
                  <input type="checkbox" name="levels" value={l} defaultChecked={initial?.cond.level?.includes(l)} />
                  {l}
                </label>
              ))}
            </div>
          )}
          {ctype === "minLevel" && (
            <select name="minLevel" defaultValue={initial?.cond.minLevel ?? "CONFIDENTIAL"} className={`${field} w-[180px]`}>
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
          {ctype === "signals" && (
            <div className="flex flex-wrap gap-x-3 gap-y-1.5 pt-1">
              {signals.map((s) => (
                <label key={s.code} className="flex items-center gap-1.5 font-mono text-[10.5px]">
                  <input type="checkbox" name="signals" value={s.code}
                         defaultChecked={initial?.cond.signals?.includes(s.code)} />
                  {s.code}
                </label>
              ))}
            </div>
          )}
          {(ctype === "exceedsClearance" || ctype === "always") && (
            <p className="pt-1.5 text-[12px] text-ink-dim">
              {ctype === "always"
                ? "Matches every request. Rules below it become unreachable."
                : "Matches when the thread's classification outranks the requester's clearance."}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button type="submit" disabled={pending}
                className="rounded-full bg-primary px-4 py-1.5 font-mono text-[11px] font-semibold tracking-[0.08em]
                           text-white transition hover:opacity-90 disabled:opacity-60">
          {pending ? "SAVING…" : "SAVE RULE"}
        </button>
        <button type="button" onClick={onDone}
                className="rounded-full border border-line px-3.5 py-1.5 font-mono text-[11px] text-ink-mid
                           transition hover:border-ink-faint">
          CANCEL
        </button>
        {state && !state.ok && <span className="text-[12px] text-deny">{state.message}</span>}
      </div>
    </form>
  );
}
