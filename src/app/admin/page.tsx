import Link from "next/link";
import { overviewStats, type OverviewStats } from "@/lib/analytics";
import { SCENARIOS } from "@/lib/demo";
import { bindingInfo } from "@/lib/llm/provider";
import { chainHead } from "@/lib/audit";
import { db } from "@/lib/db";
import { livePayload, recentDecisions } from "@/lib/live";
import { listUsersWithStats } from "@/lib/users";
import { ENV_META, LEVELS, type EnvKey, type Level } from "@/lib/domain";
import AutoRefresh from "@/components/admin/AutoRefresh";
import DemoRunner from "@/components/admin/DemoRunner";
import Topology from "@/components/admin/Topology";
import UserDirectory from "@/components/admin/UserDirectory";
import SpotlightCard from "@/components/SpotlightCard";

export const dynamic = "force-dynamic";

const ENV_TEXT: Record<EnvKey, string> = { cloud: "text-cloud", onprem: "text-onprem", airgap: "text-airgap" };
const ENV_BAR: Record<EnvKey, string> = { cloud: "bg-cloud", onprem: "bg-onprem", airgap: "bg-airgap" };

const LEVEL_TONE: Record<Level, { text: string; bar: string }> = {
  PUBLIC:       { text: "text-cloud",    bar: "bg-cloud" },
  OFFICIAL:     { text: "text-official", bar: "bg-official" },
  CONFIDENTIAL: { text: "text-onprem",   bar: "bg-onprem" },
  SECRET:       { text: "text-airgap",   bar: "bg-airgap" },
};

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
          <h1 className="mt-1 text-[28px] tracking-tight">User management</h1>
          <p className="mt-1.5 max-w-[660px] text-[13px] leading-relaxed text-ink-dim">
            Everyone with access to Mizan, what they are cleared to handle, and every request they
            have made. Select a user to open their profile and history.
          </p>
        </header>
        <UserDirectory users={listUsersWithStats()} />
      </div>
    );
  }

  const stats = overviewStats();
  const inspector = bindingInfo("inspector");
  const rules = (db().prepare(`SELECT COUNT(*) AS n FROM policies WHERE enabled = 1`).get() as { n: number }).n;
  const users = (db().prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
  const chain = chainHead();
  const refusalRate = stats.requests ? Math.round((stats.refused / stats.requests) * 100) : 0;
  const envKeys: EnvKey[] = ["cloud", "onprem", "airgap"];
  const maxServed = Math.max(1, ...envKeys.map((k) => stats.byEnv[k].routed));

  return (
    <div className="mx-auto max-w-[1180px] space-y-6 px-8 py-8">
      <ViewTabs active="workload" />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mz-label">Overview</div>
          <h1 className="mt-1 text-[28px] tracking-tight">Workload topology</h1>
          <p className="mt-1.5 max-w-[660px] text-[13px] leading-relaxed text-ink-dim">
            Watch requests move through the platform as they happen. Each one is inspected on-prem,
            matched against policy and dispatched to the environment accredited to hold it — or refused.
          </p>
        </div>
        <AutoRefresh ms={6000} />
      </header>

      {/* ---- KPIs ------------------------------------------------------ */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Requests" value={String(stats.requests)} sub={`${stats.last24h} in the last 24h`} accent="bg-cloud" />
        <Kpi label="Refused" value={String(stats.refused)} tone="text-deny" accent="bg-deny"
             sub={`${refusalRate}% of requests · ${stats.failed} failed`} />
        <Kpi label="Spend" value={`$${stats.spend.toFixed(4)}`} sub={`${stats.tokens.toLocaleString()} tokens`} accent="bg-onprem" />
        <Link href="/admin/audit" className="block">
          <Kpi label="Audit chain" value={`${chain.count}`} sub={`head ${chain.head.slice(0, 12)}…`} accent="bg-airgap" />
        </Link>
      </div>

      {/* ---- live topology --------------------------------------------- */}
      <Topology
        initial={livePayload(Date.now())}
        recent={recentDecisions(6)}
        inspector={{
          id: inspector.id, model: inspector.model, endpoint: inspector.endpoint,
          egressOk: inspector.egress.ok, reason: inspector.egress.reason,
        }}
        rules={rules}
        users={users}
        avgInspectMs={stats.inspector.avgMs}
        refusals={stats.refusals}
      />

      {/* ---- demo + mix ------------------------------------------------ */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <DemoRunner scenarios={SCENARIOS.map(({ id, title, actor, expect, note }) => ({ id, title, actor, expect, note }))} />
        <div className="space-y-4">
          <Panel title="Classification mix">
            <LevelBars byLevel={stats.byLevel} />
          </Panel>
          <Panel title="Refusals by rule">
            {stats.refusals.length === 0 ? (
              <p className="text-[12px] text-ink-faint">No refusals yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {stats.refusals.slice(0, 5).map((r) => (
                  <li key={r.name} className="flex items-center gap-2 text-[12px]">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-deny" />
                    <span className="truncate text-ink-mid">{r.name}</span>
                    <span className="ml-auto font-mono text-[11px] text-ink-dim">{r.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {/* ---- environments + signals ------------------------------------ */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Panel title="Served by environment">
          <ul className="space-y-3">
            {envKeys.map((k) => {
              const s = stats.byEnv[k];
              return (
                <li key={k}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={`text-[12.5px] font-medium ${ENV_TEXT[k]}`}>{ENV_META[k].name}</span>
                    <span className="font-mono text-[10.5px] text-ink-dim">
                      {s.routed} served · ${s.cost.toFixed(4)} · {s.routed ? `${Math.round(s.avgLatency)} ms` : "—"}
                    </span>
                  </div>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-raised">
                    <span className={`block h-full rounded-full ${ENV_BAR[k]}`} style={{ width: `${(s.routed / maxServed) * 100}%` }} />
                  </span>
                </li>
              );
            })}
          </ul>
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
              ? "bg-overlay font-medium text-ink shadow-[0_1px_4px_rgba(20,20,19,0.14)]"
              : "text-ink-dim hover:text-ink-mid"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

function Kpi({ label, value, sub, tone, accent }: {
  label: string; value: string; sub: string; tone?: string; accent: string;
}) {
  return (
    <SpotlightCard className="mz-panel h-full px-4 py-3 transition hover:border-ink-faint">
      <span className={`absolute inset-y-0 left-0 w-[3px] ${accent} opacity-70`} />
      <div className="mz-label">{label}</div>
      <div className={`mt-1 font-mono text-[20px] font-semibold ${tone ?? ""}`}>{value}</div>
      <div className="mt-0.5 truncate text-[11.5px] text-ink-dim">{sub}</div>
    </SpotlightCard>
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
