"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ENV_META, type EnvKey, type Level } from "@/lib/domain";

export interface ScenarioView {
  id: string;
  title: string;
  actor: string;
  expect: string;
  note: string;
}

interface TurnResult {
  verdict: "ALLOW" | "REFUSE" | "ERROR";
  level: Level;
  seal: Level;
  envKey: EnvKey | null;
  policyName: string | null;
  reason: string;
}

interface RowState {
  status: "running" | "done" | "error";
  result?: TurnResult;
  message?: string;
}

const ENV_TEXT: Record<EnvKey, string> = { cloud: "text-cloud", onprem: "text-onprem", airgap: "text-airgap" };

/** Fires the scripted scenarios through the real pipeline and shows each outcome. */
export default function DemoRunner({ scenarios }: { scenarios: ScenarioView[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setRows({});
    setError(null);
    try {
      const res = await fetch("/api/admin/demo", { method: "POST" });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `Demo failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const e = JSON.parse(line) as {
            type: string; id?: string; status?: RowState["status"]; result?: TurnResult; message?: string;
          };
          if (e.type === "scenario" && e.id && e.status) {
            setRows((r) => ({ ...r, [e.id!]: { status: e.status!, result: e.result, message: e.message } }));
            if (e.status !== "running") router.refresh();
          } else if (e.type === "error") {
            setError(e.message ?? "Demo failed.");
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  const finished = Object.values(rows).filter((r) => r.status !== "running").length;

  return (
    <section className="mz-panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <div className="mz-label">Demo sequence</div>
          <p className="mt-0.5 text-[12px] text-ink-dim">
            {scenarios.length} scripted requests run through the real pipeline as the seeded users.
            Watch the topology above move.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {running && <span className="font-mono text-[10.5px] text-ink-dim">{finished}/{scenarios.length}</span>}
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="rounded-full bg-cloud px-4 py-2 font-mono text-[11px] font-semibold tracking-[0.08em]
                       text-white transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
          >
            {running ? "RUNNING…" : "▶ RUN DEMO SEQUENCE"}
          </button>
        </div>
      </div>

      {error && <p className="border-b border-line bg-deny-soft px-4 py-2 text-[12px] text-deny">{error}</p>}

      <ol className="divide-y divide-line-soft">
        {scenarios.map((s, i) => {
          const r = rows[s.id];
          const dot = !r ? "bg-line"
            : r.status === "running" ? "bg-cloud mz-anim-pulse"
            : r.status === "error" || r.result?.verdict === "ERROR" ? "bg-deny"
            : r.result?.verdict === "REFUSE" ? "bg-deny" : "bg-ok";
          return (
            <li key={s.id} className="grid grid-cols-[14px_1fr_auto] items-start gap-3 px-4 py-2.5">
              <span className={`mt-[6px] h-2 w-2 rounded-full ${dot}`} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[13px] font-medium">{i + 1}. {s.title}</span>
                  <span className="font-mono text-[10.5px] text-ink-faint">{s.actor}</span>
                </div>
                <div className="text-[11.5px] text-ink-dim">{s.note}</div>
                {r?.result && (
                  <div className="mt-0.5 line-clamp-2 text-[11.5px] text-ink-mid">{r.result.reason}</div>
                )}
                {r?.message && <div className="mt-0.5 text-[11.5px] text-deny">{r.message}</div>}
              </div>
              <div className="text-right">
                <div className="font-mono text-[10px] text-ink-faint">expect {s.expect}</div>
                {r?.result && <Outcome r={r.result} />}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Outcome({ r }: { r: TurnResult }) {
  if (r.verdict === "REFUSE") {
    return <div className="font-mono text-[11px] font-semibold text-deny">REFUSED · {r.policyName ?? "default deny"}</div>;
  }
  if (r.verdict === "ERROR" || !r.envKey) {
    return <div className="font-mono text-[11px] font-semibold text-deny">ERROR</div>;
  }
  return (
    <div className={`font-mono text-[11px] font-semibold ${ENV_TEXT[r.envKey]}`}>
      {r.seal} → {ENV_META[r.envKey].short}
    </div>
  );
}
