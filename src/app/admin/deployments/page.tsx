import {
  TRANSPORT, deployLedger, listArtefacts, listDeployments, listEnvironments,
  type Artefact, type Deployment, type DeployState,
} from "@/lib/deployments";
import { ENV_META, type EnvKey } from "@/lib/domain";
import DeployButton from "@/components/admin/DeployButton";
import RegisterVersionForm from "@/components/admin/RegisterVersionForm";

export const dynamic = "force-dynamic";

const ENVS: EnvKey[] = ["cloud", "onprem", "airgap"];

const TONE: Record<EnvKey, { text: string; dot: string; border: string; shape: string }> = {
  cloud:  { text: "text-cloud",  dot: "bg-cloud",  border: "border-cloud/30",  shape: "rounded-full" },
  onprem: { text: "text-onprem", dot: "bg-onprem", border: "border-onprem/35", shape: "rounded-[5px]" },
  airgap: { text: "text-airgap", dot: "bg-airgap", border: "border-airgap/35", shape: "rotate-45 rounded-[4px]" },
};

const STATE: Record<DeployState, { label: string; cls: string }> = {
  absent:     { label: "Not present",   cls: "border-line text-ink-faint" },
  staged:     { label: "On media",      cls: "border-warn/40 bg-warn-soft text-warn" },
  importing:  { label: "Crossed diode", cls: "border-warn/40 bg-warn-soft text-warn" },
  active:     { label: "Active",        cls: "border-ok/40 bg-onprem-soft text-ok" },
  superseded: { label: "Superseded",    cls: "border-line bg-raised text-ink-dim" },
};

function ago(ts?: number): string {
  if (!ts) return "—";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function stamp(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function shortDigest(d: string): string {
  const h = d.replace(/^sha256:/, "");
  return `sha256:${h.slice(0, 8)}…${h.slice(-4)}`;
}

/** Suggest the next minor release after the newest registered one. */
function nextVersion(v?: string): string {
  const m = v ? /^v(\d+)\.(\d+)\.(\d+)$/.exec(v) : null;
  return m ? `v${m[1]}.${Number(m[2]) + 1}.0` : "v1.0.0";
}

export default function DeploymentsPage() {
  const envs = listEnvironments();
  const artefacts = listArtefacts();
  const deps = listDeployments();
  const ledger = deployLedger(18);

  const byId = new Map(artefacts.map((a) => [a.id, a]));
  const find = (artId: string, env: EnvKey) =>
    deps.find((d) => d.artefactId === artId && d.envKey === env);

  const serving = Object.fromEntries(ENVS.map((e) => {
    const d = deps.find((x) => x.envKey === e && x.state === "active");
    return [e, d ? { dep: d, art: byId.get(d.artefactId)! } : null];
  })) as Record<EnvKey, { dep: Deployment; art: Artefact } | null>;

  const servingVersions = new Set(ENVS.map((e) => serving[e]?.art.version ?? "none"));
  const consistent = servingVersions.size === 1 && !servingVersions.has("none");

  const inTransit = deps.filter((d) =>
    d.envKey === "airgap" && (d.state === "staged" || d.state === "importing"));
  const enclaveActive = serving.airgap;

  return (
    <div className="mx-auto max-w-[1120px] space-y-7 px-8 py-8">
      {/* ---- header --------------------------------------------------- */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mz-label">Model deployments</div>
          <h1 className="mt-1 font-mono text-[21px] font-semibold tracking-tight">
            {artefacts[0]?.name ?? "No artefacts registered"}
          </h1>
          <p className="mt-1.5 max-w-[640px] text-[13px] leading-relaxed text-ink-dim">
            One signed artefact, versioned identically across every environment. Each environment
            receives it over the only channel its accreditation permits — the enclave has no
            network path at all.
          </p>
        </div>

        {consistent ? (
          <div className="rounded-lg border border-ok/40 bg-onprem-soft px-3 py-2">
            <div className="font-mono text-[10px] font-semibold tracking-[0.12em] text-ok">IN STEP</div>
            <div className="text-[12px] text-ink-mid">
              All environments serve <span className="font-mono">{[...servingVersions][0]}</span>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2">
            <div className="font-mono text-[10px] font-semibold tracking-[0.12em] text-warn">VERSION DRIFT</div>
            <div className="font-mono text-[11px] text-ink-mid">
              {ENVS.map((e) => `${ENV_META[e].short.toLowerCase()} ${serving[e]?.art.version ?? "—"}`).join(" · ")}
            </div>
          </div>
        )}
      </header>

      {/* ---- environments ---------------------------------------------- */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {ENVS.map((key) => {
          const e = envs.find((x) => x.key === key);
          const s = serving[key];
          const t = TONE[key];
          if (!e) return null;
          return (
            <section key={key} className={`mz-panel flex flex-col gap-3 p-4 ${t.border}`}>
              <div className="flex items-center gap-3">
                <span className={`h-[17px] w-[17px] shrink-0 border-[1.5px] border-current ${t.text} ${t.shape}`} />
                <div className="min-w-0">
                  <div className={`text-[12px] font-bold tracking-[0.05em] ${t.text}`}>{e.name.toUpperCase()}</div>
                  <div className="font-mono text-[10px] text-ink-dim">{e.region}</div>
                </div>
              </div>

              <dl className="space-y-1 font-mono text-[10.5px]">
                {[
                  ["accredited", e.maxLevel],
                  ["channel", TRANSPORT[key]],
                  ["egress", e.egress],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-3">
                    <dt className="w-[72px] shrink-0 text-ink-faint">{k}</dt>
                    <dd className="text-ink-mid">{v}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-auto rounded-lg border border-line-soft bg-surface px-3 py-2.5">
                <div className="mz-label">Serving</div>
                {s ? (
                  <>
                    <div className="mt-1 font-mono text-[17px] font-semibold">{s.art.version}</div>
                    <div className="font-mono text-[10px] text-ink-faint">{shortDigest(s.art.digest)}</div>
                    <div className="mt-1.5 text-[11.5px] leading-snug text-ink-dim">
                      {key === "airgap" && s.dep.detail.mediaRef
                        ? <>Imported on <span className="font-mono">{s.dep.detail.mediaRef}</span> · digest
                            verified {ago(s.dep.detail.verifiedAt ?? s.dep.updatedAt)}</>
                        : <>Live since {ago(s.dep.detail.activatedAt ?? s.dep.updatedAt)}</>}
                    </div>
                  </>
                ) : (
                  <div className="mt-1 text-[12px] leading-snug text-deny">
                    No active artefact — the router will not dispatch here.
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* ---- version matrix -------------------------------------------- */}
      <section className="mz-panel overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <div className="mz-label">Version matrix</div>
          <p className="mt-0.5 text-[12px] text-ink-dim">
            Every registered build and its state in each environment. Superseded builds stay
            resident for rollback.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left">
            <thead>
              <tr className="border-b border-line-soft">
                <th className="mz-label px-4 py-2 font-normal">Build</th>
                {ENVS.map((k) => (
                  <th key={k} className="mz-label px-4 py-2 font-normal">
                    <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${TONE[k].dot}`} />
                    {ENV_META[k].short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {artefacts.map((a) => (
                <tr key={a.id} className="border-b border-line-soft align-top last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-mono text-[13px] font-semibold">{a.version}</div>
                    <div className="font-mono text-[10px] text-ink-faint">
                      {shortDigest(a.digest)} · {(a.sizeMb / 1000).toFixed(1)} GB
                    </div>
                    <div className="mt-1 max-w-[270px] text-[11.5px] leading-snug text-ink-dim">{a.notes}</div>
                  </td>
                  {ENVS.map((k) => (
                    <td key={k} className="px-4 py-3">
                      <Cell
                        dep={find(a.id, k)}
                        env={k}
                        artefact={a}
                        serving={serving[k]?.art ?? null}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-line bg-surface px-4 py-3.5">
          <div className="mz-label mb-2">Register a new build</div>
          <RegisterVersionForm suggested={nextVersion(artefacts[0]?.version)} />
        </div>
      </section>

      {/* ---- data diode ------------------------------------------------ */}
      <section id="diode" className="mz-panel overflow-hidden border-airgap/35">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <div className="mz-label text-airgap">Data diode · manual import</div>
            <p className="mt-0.5 max-w-[680px] text-[12px] leading-relaxed text-ink-dim">
              The enclave cannot pull. A build reaches it only on removable media, through a one-way
              optical diode, and is re-hashed on the high side before it is allowed to run.
            </p>
          </div>
          <span className="rounded border border-airgap/35 bg-airgap-soft px-2 py-1 font-mono
                           text-[9.5px] tracking-[0.12em] text-airgap">
            NO WAN · NO RETURN PATH
          </span>
        </div>

        <div className="space-y-5 p-4">
          {inTransit.map((d) => (
            <DiodeTrack key={d.id} dep={d} art={byId.get(d.artefactId)!} />
          ))}

          {inTransit.length === 0 && enclaveActive && (
            <>
              <p className="text-[12px] text-ink-dim">
                No import in progress. Start one from the Enclave column of the version matrix.
                The chain of custody for the build currently running is below.
              </p>
              <DiodeTrack dep={enclaveActive.dep} art={enclaveActive.art} />
            </>
          )}

          {inTransit.length === 0 && !enclaveActive && (
            <p className="text-[12px] text-ink-dim">
              Nothing is running in the enclave and no import is in progress.
            </p>
          )}
        </div>
      </section>

      {/* ---- ledger ---------------------------------------------------- */}
      <section className="mz-panel overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <div className="mz-label">Deployment ledger</div>
        </div>
        {ledger.length === 0 ? (
          <p className="px-4 py-4 text-[12px] text-ink-faint">No deployment events recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <ul className="min-w-[640px] divide-y divide-line-soft">
              {ledger.map((r) => (
                <li key={r.id} className="grid grid-cols-[104px_140px_1fr] items-baseline gap-3 px-4 py-2">
                  <span className="font-mono text-[10.5px] text-ink-faint">{stamp(r.ts)}</span>
                  <span className={`font-mono text-[10.5px] ${
                    r.kind.startsWith("diode") ? "text-airgap"
                      : r.kind === "deploy.activated" ? "text-ok" : "text-ink-mid"}`}>
                    {r.kind}
                  </span>
                  <span className="text-[12px] text-ink-mid">
                    {r.summary} <span className="text-ink-faint">· {r.actor}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

/* ---- matrix cell ---------------------------------------------------- */

function Cell({ dep, env, artefact, serving }: {
  dep: Deployment | undefined;
  env: EnvKey;
  artefact: Artefact;
  serving: Artefact | null;
}) {
  if (!dep) return <span className="text-ink-faint">—</span>;
  const s = STATE[dep.state];
  const older = !!serving && artefact.createdAt < serving.createdAt;
  const common = { artefactId: artefact.id, env };

  let action: React.ReactNode = null;
  if (env !== "airgap") {
    if (dep.state === "absent") {
      action = <DeployButton {...common} op="activate" label="Deploy" pendingLabel="Pulling…" tone="primary" />;
    } else if (dep.state === "superseded") {
      action = <DeployButton {...common} op="activate" label={older ? "Roll back" : "Redeploy"}
                             pendingLabel="Switching…" />;
    }
  } else if (dep.state === "absent") {
    action = <DeployButton {...common} op="export" label="Begin diode import"
                           pendingLabel="Writing media…" tone="airgap" />;
  } else if (dep.state === "staged" || dep.state === "importing") {
    action = <a href="#diode" className="text-[11.5px] text-airgap hover:underline">Continue import ↓</a>;
  } else if (dep.state === "superseded") {
    action = <DeployButton {...common} op="activate" label={older ? "Roll back" : "Reactivate"}
                           pendingLabel="Switching…" />;
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <span className={`rounded border px-1.5 py-0.5 font-mono text-[9.5px] tracking-[0.10em] ${s.cls}`}>
        {s.label.toUpperCase()}
      </span>
      <span className="font-mono text-[10px] text-ink-faint">
        {dep.state === "absent" ? dep.transport : ago(dep.updatedAt)}
      </span>
      {action}
    </div>
  );
}

/* ---- diode chain of custody ---------------------------------------- */

function DiodeTrack({ dep, art }: { dep: Deployment; art: Artefact }) {
  const d = dep.detail;
  // 1 = waiting at the diode, 2 = inside, awaiting verification, 3 = complete.
  const step = dep.state === "staged" ? 1 : dep.state === "importing" ? 2 : 3;
  const common = { artefactId: art.id, env: "airgap" as EnvKey };

  const steps = [
    {
      title: "Export to removable media",
      where: "Low side · export station, DC-1",
      done: true,
      record: d.mediaRef && <><span className="font-mono">{d.mediaRef}</span> · {d.exportedBy} · {stamp(d.exportedAt)}</>,
      action: null,
    },
    {
      title: "Pass through the data diode",
      where: "One-way optical link · no return path",
      done: step > 1,
      record: step > 1 && <>{d.crossedBy} · {stamp(d.crossedAt)}</>,
      action: step === 1 && (
        <DeployButton {...common} op="transfer" label="Transfer through diode"
                      pendingLabel="Transferring…" tone="airgap" />
      ),
    },
    {
      title: "Verify digest & activate",
      where: "High side · Facility K",
      done: step > 2,
      record: step > 2 && (
        <>
          <span className="font-mono">{shortDigest(d.computedDigest ?? art.digest)}</span> matches manifest ·{" "}
          {d.verifiedBy} · {stamp(d.verifiedAt)}
        </>
      ),
      action: step === 2 && (
        <DeployButton {...common} op="verify" label="Verify & activate"
                      pendingLabel="Re-hashing…" tone="airgap" />
      ),
    },
  ];

  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-[13px] font-semibold">
          {art.name} {art.version}
        </span>
        <span className="text-[12px] text-ink-dim">→ {ENV_META.airgap.name}</span>
        <span className="font-mono text-[10px] text-ink-faint">manifest {art.digest.slice(0, 23)}…</span>
        {step === 3 && (
          <span className="rounded border border-ok/40 bg-onprem-soft px-1.5 py-0.5 font-mono
                           text-[9.5px] tracking-[0.10em] text-ok">
            {dep.state === "active" ? "RUNNING" : dep.state.toUpperCase()}
          </span>
        )}
      </div>

      <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {steps.map((s, i) => {
          const current = !s.done && i === step;
          return (
            <li
              key={s.title}
              className={`relative flex flex-col gap-1.5 rounded-lg border p-3 ${
                current ? "border-airgap bg-airgap-soft"
                  : s.done ? "border-line-soft bg-surface" : "border-dashed border-line opacity-60"}`}
            >
              {i === 1 && (
                <span className="absolute -top-2 left-3 rounded border border-airgap/50 bg-overlay px-1.5
                                 font-mono text-[8.5px] tracking-[0.14em] text-airgap">
                  ▶ DIODE
                </span>
              )}
              <div className="flex items-center gap-2">
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] ${
                  s.done ? "bg-ok text-white"
                    : current ? "bg-airgap text-white" : "border border-line text-ink-faint"}`}>
                  {s.done ? "✓" : i + 1}
                </span>
                <span className="text-[12.5px] font-medium">{s.title}</span>
              </div>
              <span className="font-mono text-[10px] text-ink-faint">{s.where}</span>
              {s.record && <span className="text-[11px] leading-snug text-ink-dim">{s.record}</span>}
              {s.action && <div className="pt-1">{s.action}</div>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
