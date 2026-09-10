import Link from "next/link";
import { listEnvRuntime, type EnvRuntime } from "@/lib/environments";
import { overviewStats, type EnvStats, type OverviewStats } from "@/lib/analytics";
import { SCENARIOS } from "@/lib/demo";
import { bindingInfo } from "@/lib/llm/provider";
import { chainHead } from "@/lib/audit";
import { db } from "@/lib/db";
import { ENV_META, LEVELS, type EnvKey, type Level } from "@/lib/domain";
import { adjustLoadAction, setEnvStatusAction } from "./actions";
import AutoRefresh from "@/components/admin/AutoRefresh";
import DemoRunner from "@/components/admin/DemoRunner";
import UserDirectory from "@/components/admin/UserDirectory";
import { listUsersWithStats } from "@/lib/users";

export const dynamic = "force-dynamic";

const TONE: Record<EnvKey, {
  text: string; bar: string; barSoft: string; border: string; shape: string; stroke: string;
}> = {
  cloud:  { text: "text-cloud",  bar: "bg-cloud",  barSoft: "bg-cloud/30",  border: "border-cloud/35",
            shape: "rounded-full",            stroke: "var(--color-cloud)" },
  onprem: { text: "text-onprem", bar: "bg-onprem", barSoft: "bg-onprem/30", border: "border-onprem/40",
            shape: "rounded-[4px]",           stroke: "var(--color-onprem)" },
  airgap: { text: "text-airgap", bar: "bg-airgap", barSoft: "bg-airgap/30", border: "border-airgap/40",
            shape: "rotate-45 rounded-[3px]", stroke: "var(--color-airgap)" },
};

const LEVEL_TONE: Record<Level, { text: string; bar: string }> = {
  PUBLIC:       { text: "text-cloud",    bar: "bg-cloud" },
  OFFICIAL:     { text: "text-official", bar: "bg-official" },
  CONFIDENTIAL: { text: "text-onprem",   bar: "bg-onprem" },
  SECRET:       { text: "text-airgap",   bar: "bg-airgap" },
};

const ROW_H = 150;

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function hostOf(endpoint: string): string {
  try { return new URL(endpoint).host; } catch { return endpoint; }
}

export default async function OverviewPage({
  searchParams,
}: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;

  if (view === "users") {
    return (
      <div className="mx-auto max-w-[1180px] space-y-6 px-8 py-8">
        <ViewTabs active="users" />
        <header>
          <div className="mz-label">Overview</div>
          <h1 className="mt-1 text-[21px] font-semibold tracking-tight">User management</h1>
          <p className="mt-1.5 max-w-[660px] text-[13px] leading-relaxed text-ink-dim">
            Everyone with access to Mizan, what they are cleared to handle, and every request they
            have made. Select a user to open their profile and history.
          </p>
        </header>
        <UserDirectory users={listUsersWithStats()} />
      </div>
    );
  }

  const envs = listEnvRuntime();
  const stats = overviewStats();
  const inspector = bindingInfo("inspector");
  const rules = (db().prepare(`SELECT COUNT(*) AS n FROM policies WHERE enabled = 1`).get() as { n: number }).n;
  const chain = chainHead();
  const refusalRate = stats.requests ? Math.round((stats.refused / stats.requests) * 100) : 0;

  const maxFlow = Math.max(1, stats.refused, ...envs.map((e) => stats.byEnv[e.key].routed));
  const paths = [
    ...envs.map((e) => ({
      key: e.key as string,
      stroke: e.status === "offline" ? "var(--color-ink-faint)" : TONE[e.key].stroke,
      dashed: e.status === "offline",
      width: 1.25 + 3 * (stats.byEnv[e.key].routed / maxFlow),
    })),
    { key: "refused", stroke: "var(--color-deny)", dashed: true, width: 1.25 + 3 * (stats.refused / maxFlow) },
  ];

  return (
    <div className="mx-auto max-w-[1180px] space-y-6 px-8 py-8">
      <ViewTabs active="workload" />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mz-label">Overview</div>
          <h1 className="mt-1 text-[21px] font-semibold tracking-tight">Workload topology</h1>
          <p className="mt-1.5 max-w-[660px] text-[13px] leading-relaxed text-ink-dim">
            Every request is inspected on-prem, matched against policy and dispatched to the one
            environment accredited to hold it — or refused with a reason.
          </p>
        </div>
        <AutoRefresh />
      </header>

      {/* ---- KPIs ------------------------------------------------------ */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Requests" value={String(stats.requests)} sub={`${stats.last24h} in the last 24h`} />
        <Kpi label="Refused" value={String(stats.refused)} tone="text-deny"
             sub={`${refusalRate}% of requests · ${stats.failed} failed`} />
        <Kpi label="Spend" value={`$${stats.spend.toFixed(4)}`} sub={`${stats.tokens.toLocaleString()} tokens`} />
        <Link href="/admin/audit" className="block">
          <Kpi label="Audit chain" value={`${chain.count}`} sub={`head ${chain.head.slice(0, 12)}…`} />
        </Link>
      </div>

      {/* ---- topology -------------------------------------------------- */}
      <section className="mz-panel p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="mz-label">Topology</div>
          <div className="flex items-center gap-3 font-mono text-[10px] text-ink-dim">
            <span>line weight = traffic served</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-sm bg-ink-mid" /> running</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-sm bg-ink-mid/30" /> reserved</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="grid min-w-[700px] grid-cols-[250px_minmax(70px,1fr)_340px]"
               style={{ height: ROW_H * 4 }}>
            {/* core */}
            <div className="flex items-center">
              <div className="w-full rounded-2xl border border-line bg-overlay p-4 shadow-[0_2px_10px_oklch(0.55_0.02_260/0.07)]">
                <div className="flex items-center gap-3">
                  <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cloud-soft">
                    <span className="h-5 w-5 rotate-45 rounded-[3px] border-[1.5px] border-cloud" />
                    <span className="absolute h-2 w-2 rounded-full bg-airgap" />
                  </span>
                  <div>
                    <div className="text-[12.5px] font-bold tracking-[0.08em]">MIZAN CORE</div>
                    <div className="font-mono text-[9.5px] text-ink-dim">INSPECTOR + POLICY ENGINE</div>
                  </div>
                </div>
                <dl className="mt-3 space-y-1 font-mono text-[10.5px]">
                  <Row k="inspector" v={`${inspector.id}:${inspector.model}`} />
                  <Row k="boundary" v={inspector.egress.ok ? `on-prem · ${hostOf(inspector.endpoint)}` : "BREACH"}
                       tone={inspector.egress.ok ? undefined : "text-deny"} />
                  <Row k="avg inspect" v={`${Math.round(stats.inspector.avgMs)} ms`} />
                  <Row k="rules" v={`${rules} active`} />
                  <Row k="requests" v={String(stats.requests)} />
                </dl>
              </div>
            </div>

            {/* flows */}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
              {paths.map((p, i) => {
                const y = 12.5 + i * 25;
                return (
                  <path key={p.key} d={`M0,50 C50,50 50,${y} 100,${y}`} fill="none"
                        stroke={p.stroke} strokeOpacity={0.85} strokeWidth={p.width}
                        strokeDasharray={p.dashed ? "5 5" : undefined} vectorEffect="non-scaling-stroke" />
                );
              })}
            </svg>

            {/* targets */}
            <div className="grid grid-rows-4">
              {envs.map((e) => (
                <div key={e.key} className="flex items-center py-1.5">
                  <EnvNode e={e} s={stats.byEnv[e.key]} />
                </div>
              ))}
              <div className="flex items-center py-1.5">
                <div className="w-full rounded-2xl border border-dashed border-deny/50 bg-deny-soft px-3.5 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border-[1.5px]
                                     border-deny text-[10px] text-deny">✕</span>
                    <span className="text-[11.5px] font-semibold tracking-[0.03em] text-deny">REFUSED — NO LAWFUL PATH</span>
                  </div>
                  <div className="mt-1.5 font-mono text-[10px] text-ink-dim">
                    {stats.refused} request{stats.refused === 1 ? "" : "s"}
                    {stats.refusals[0] && <> · most often “{stats.refusals[0].name}”</>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---- demo ------------------------------------------------------ */}
      <DemoRunner scenarios={SCENARIOS.map(({ id, title, actor, expect, note }) => ({ id, title, actor, expect, note }))} />

      {/* ---- analytics ------------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel title="Classification mix">
          <LevelBars byLevel={stats.byLevel} />
        </Panel>

        <Panel title="Served by environment">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="mz-label">
                <th className="pb-1.5 font-normal">Environment</th>
                <th className="pb-1.5 text-right font-normal">Served</th>
                <th className="pb-1.5 text-right font-normal">Tokens</th>
                <th className="pb-1.5 text-right font-normal">Cost</th>
                <th className="pb-1.5 text-right font-normal">Avg latency</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[11px]">
              {envs.map((e) => {
                const s = stats.byEnv[e.key];
                return (
                  <tr key={e.key} className="border-t border-line-soft">
                    <td className={`py-1.5 font-sans text-[12px] ${TONE[e.key].text}`}>{ENV_META[e.key].name}</td>
                    <td className="py-1.5 text-right">{s.routed}</td>
                    <td className="py-1.5 text-right">{s.tokens.toLocaleString()}</td>
                    <td className="py-1.5 text-right">${s.cost.toFixed(4)}</td>
                    <td className="py-1.5 text-right">{s.routed ? `${Math.round(s.avgLatency)} ms` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>

        <Panel title="Refusals by rule">
          {stats.refusals.length === 0 ? (
            <p className="text-[12px] text-ink-faint">No refusals yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {stats.refusals.map((r) => (
                <li key={r.name} className="flex items-center gap-2 text-[12px]">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-deny" />
                  <span className="text-ink-mid">{r.name}</span>
                  <span className="ml-auto font-mono text-[11px] text-ink-dim">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Detector signals seen">
          {stats.signals.length === 0 ? (
            <p className="text-[12px] text-ink-faint">No regulated data patterns detected yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {stats.signals.map((s) => (
                <span key={s.code} title={s.label}
                      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 font-mono text-[10.5px]">
                  <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_TONE[s.level]?.bar ?? "bg-ink-faint"}`} />
                  {s.code}
                  <span className="text-ink-faint">×{s.count}</span>
                </span>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* ---- recent decisions ------------------------------------------ */}
      <Panel title="Recent routing decisions" action={<Link href="/admin/audit?group=request" className="text-[11.5px] text-cloud hover:underline">Full ledger →</Link>}>
        {stats.recent.length === 0 ? (
          <p className="text-[12px] text-ink-faint">No requests yet. Run the demo sequence above.</p>
        ) : (
          <div className="overflow-x-auto">
            <ul className="min-w-[760px] divide-y divide-line-soft">
              {stats.recent.map((d, i) => (
                <li key={i} className="grid grid-cols-[70px_170px_104px_96px_1fr] items-baseline gap-3 py-2">
                  <span className="font-mono text-[10.5px] text-ink-faint">{clock(d.ts)}</span>
                  <span className="truncate text-[12px] text-ink-mid">{d.actor}</span>
                  <span className={`font-mono text-[10px] tracking-[0.08em] ${d.level ? LEVEL_TONE[d.level].text : "text-ink-faint"}`}>
                    {d.level ?? "—"}
                  </span>
                  {d.verdict === "ALLOW" && d.envKey ? (
                    <span className={`font-mono text-[10.5px] font-semibold ${TONE[d.envKey].text}`}>→ {ENV_META[d.envKey].short}</span>
                  ) : (
                    <span className="font-mono text-[10.5px] font-semibold text-deny">REFUSED</span>
                  )}
                  <span className="truncate text-[12px] text-ink-dim" title={d.reason}>
                    <span className="text-ink-mid">{d.rule}</span> — {d.reason}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ---- pieces --------------------------------------------------------- */

function ViewTabs({ active }: { active: "workload" | "users" }) {
  const tabs = [
    { key: "workload", href: "/admin", label: "Workload topology" },
    { key: "users", href: "/admin?view=users", label: "User management" },
  ] as const;
  return (
    <nav aria-label="Overview sections" className="inline-flex rounded-full border border-line bg-surface p-1">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={`rounded-full px-4 py-1.5 text-[12.5px] transition ${
            active === t.key
              ? "bg-overlay font-medium text-ink shadow-[0_1px_4px_oklch(0.55_0.02_260/0.14)]"
              : "text-ink-dim hover:text-ink-mid"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="mz-panel h-full px-4 py-3 transition hover:border-ink-faint">
      <div className="mz-label">{label}</div>
      <div className={`mt-1 font-mono text-[20px] font-semibold ${tone ?? ""}`}>{value}</div>
      <div className="mt-0.5 truncate text-[11.5px] text-ink-dim">{sub}</div>
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-[76px] shrink-0 text-ink-faint">{k}</dt>
      <dd className={`min-w-0 truncate ${tone ?? "text-ink-mid"}`} title={v}>{v}</dd>
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mz-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="mz-label">{title}</div>
        {action}
      </div>
      {children}
    </section>
  );
}

function LevelBars({ byLevel }: { byLevel: OverviewStats["byLevel"] }) {
  const total = Object.values(byLevel).reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...Object.values(byLevel));
  return (
    <ul className="space-y-2">
      {LEVELS.map((l) => (
        <li key={l} className="grid grid-cols-[104px_1fr_64px] items-center gap-3">
          <span className={`font-mono text-[10px] tracking-[0.10em] ${LEVEL_TONE[l].text}`}>{l}</span>
          <span className="h-2 overflow-hidden rounded-full bg-raised">
            <span className={`block h-full rounded-full ${LEVEL_TONE[l].bar}`}
                  style={{ width: `${(byLevel[l] / max) * 100}%` }} />
          </span>
          <span className="text-right font-mono text-[11px] text-ink-dim">
            {byLevel[l]} · {total ? Math.round((byLevel[l] / total) * 100) : 0}%
          </span>
        </li>
      ))}
    </ul>
  );
}

const btn = `rounded-full border border-line bg-base px-2 py-0.5 font-mono text-[10px] text-ink-mid transition
             hover:border-ink-faint hover:text-ink disabled:cursor-not-allowed disabled:opacity-40`;

function EnvNode({ e, s }: { e: EnvRuntime; s: EnvStats }) {
  const t = TONE[e.key];
  const offline = e.status === "offline";
  const used = e.inFlight + e.simLoad;
  const full = used >= e.capacity;

  return (
    <div className={`w-full rounded-2xl border bg-overlay px-3.5 py-2.5 shadow-[0_2px_10px_oklch(0.55_0.02_260/0.07)]
                     ${offline ? "border-dashed border-line opacity-70" : t.border}`}>
      <div className="flex items-center gap-2.5">
        <span className={`h-[14px] w-[14px] shrink-0 border-[1.5px] border-current ${t.text} ${t.shape}`} />
        <span className={`text-[11.5px] font-bold tracking-[0.05em] ${t.text}`}>{e.name.toUpperCase()}</span>
        {e.key === "airgap" && (
          <span className="rounded border border-airgap/40 px-1 font-mono text-[8.5px] tracking-[0.12em] text-airgap">
            DIODE IN
          </span>
        )}
        <span className={`ml-auto rounded px-1.5 py-px font-mono text-[9px] tracking-[0.10em]
          ${offline ? "bg-deny-soft text-deny" : full ? "bg-warn-soft text-warn" : "bg-onprem-soft text-ok"}`}>
          {offline ? "OFFLINE" : full ? "SATURATED" : "ONLINE"}
        </span>
      </div>

      <div className="mt-2 flex gap-1">
        {Array.from({ length: e.capacity }, (_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-sm
            ${i < e.inFlight ? t.bar : i < used ? t.barSoft : "bg-raised"}`} />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9.5px] text-ink-dim">
        <span>{e.inFlight} running · {e.simLoad} reserved</span>
        <span>{Math.min(used, e.capacity)}/{e.capacity} slots</span>
      </div>
      <div className="mt-0.5 truncate font-mono text-[9.5px] text-ink-faint">
        {s.routed} served · ${s.cost.toFixed(4)} · {e.artefact ?? "no artefact"} · +{e.netMs}ms · ≤ {e.maxLevel}
      </div>
      <div className={`truncate font-mono text-[9.5px] ${e.binding.egress.ok ? "text-ink-faint" : "text-deny"}`}
           title={e.binding.egress.reason}>
        {e.binding.egress.ok ? "✓" : "✕"} {e.binding.id}:{e.binding.model} @ {hostOf(e.binding.endpoint)} — {e.binding.egress.reason}
      </div>

      <div className="mt-1.5 flex items-center gap-1.5">
        <form action={adjustLoadAction.bind(null, e.key, -1)}>
          <button type="submit" className={btn} disabled={e.simLoad === 0} aria-label="Release a reserved slot">−</button>
        </form>
        <span className="font-mono text-[9.5px] text-ink-dim">load</span>
        <form action={adjustLoadAction.bind(null, e.key, 1)}>
          <button type="submit" className={btn} disabled={e.simLoad >= e.capacity} aria-label="Reserve a slot">+</button>
        </form>
        <form action={setEnvStatusAction.bind(null, e.key, offline ? "online" : "offline")} className="ml-auto">
          <button type="submit" className={btn}>{offline ? "Bring online" : "Take offline"}</button>
        </form>
      </div>
    </div>
  );
}
