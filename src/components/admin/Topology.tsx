"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { adjustLoadAction, setEnvStatusAction } from "@/app/admin/actions";
import type { LiveDecision, LivePayload } from "@/lib/live";
import type { EnvRuntime } from "@/lib/environments";
import { ENV_META, type EnvKey, type Level } from "@/lib/domain";

/**
 * Live, interactive workload topology.
 *
 * Polls /api/admin/live and animates every new routing decision: a packet
 * travels from the requesters into the core, is classified there, and leaves
 * for the environment policy chose — coloured by its level — or for the
 * refusal sink. Busy environments pulse; any node opens a detail popover.
 */

type EnvNodeKey = EnvKey;
type NodeKey = "source" | "core" | EnvNodeKey | "refused" | "diode";
type RouteKey = "ingress" | EnvNodeKey | "refused";

/* Canvas coordinates. The container keeps this aspect ratio, so HTML nodes
   (positioned in %) and SVG routes (viewBox units) stay aligned at any width. */
const W = 1000;
const H = 540;
const POS = {
  source:  { x: 100, y: 270 },
  core:    { x: 390, y: 270 },
  cloud:   { x: 820, y: 92 },
  onprem:  { x: 820, y: 270 },
  airgap:  { x: 820, y: 448 },
  refused: { x: 520, y: 478 },
  diode:   { x: 700, y: 423 },
} as const;

const ROUTES: Record<RouteKey, string> = {
  ingress: `M ${POS.source.x} ${POS.source.y} L ${POS.core.x} ${POS.core.y}`,
  cloud:   `M ${POS.core.x} ${POS.core.y} C 610 270, 600 ${POS.cloud.y}, ${POS.cloud.x} ${POS.cloud.y}`,
  onprem:  `M ${POS.core.x} ${POS.core.y} L ${POS.onprem.x} ${POS.onprem.y}`,
  airgap:  `M ${POS.core.x} ${POS.core.y} C 610 270, 600 ${POS.airgap.y}, ${POS.airgap.x} ${POS.airgap.y}`,
  refused: `M ${POS.core.x} ${POS.core.y} C 400 420, 440 ${POS.refused.y}, ${POS.refused.x} ${POS.refused.y}`,
};

const pct = (p: { x: number; y: number }) => ({ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` });

const LEVEL_COLOR: Record<Level, string> = {
  PUBLIC: "var(--color-cloud)",
  OFFICIAL: "var(--color-official)",
  CONFIDENTIAL: "var(--color-onprem)",
  SECRET: "var(--color-airgap)",
};
const LEVEL_TEXT: Record<Level, string> = {
  PUBLIC: "text-cloud", OFFICIAL: "text-official", CONFIDENTIAL: "text-onprem", SECRET: "text-airgap",
};

const TONE: Record<EnvKey, {
  text: string; bar: string; barSoft: string; border: string; ring: string; shape: string; stroke: string;
}> = {
  cloud:  { text: "text-cloud",  bar: "bg-cloud",  barSoft: "bg-cloud/30",  border: "border-cloud/35",
            ring: "border-cloud/60",  shape: "rounded-full",            stroke: "var(--color-cloud)" },
  onprem: { text: "text-onprem", bar: "bg-onprem", barSoft: "bg-onprem/30", border: "border-onprem/40",
            ring: "border-onprem/60", shape: "rounded-[4px]",           stroke: "var(--color-onprem)" },
  airgap: { text: "text-airgap", bar: "bg-airgap", barSoft: "bg-airgap/30", border: "border-airgap/40",
            ring: "border-airgap/60", shape: "rotate-45 rounded-[3px]", stroke: "var(--color-airgap)" },
};

/* Packet timing, in ms: travel in, classify at the core, travel out. */
const T_IN = 700;
const T_HOLD = 280;
const T_OUT = 1000;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface Packet {
  id: string;
  route: EnvKey | "refused";
  color: string;
  start: number;
}

export interface TopologyProps {
  initial: LivePayload;
  recent: LiveDecision[];
  inspector: { id: string; model: string; endpoint: string; egressOk: boolean; reason: string };
  rules: number;
  users: number;
  avgInspectMs: number;
  refusals: Array<{ name: string; count: number }>;
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function hostOf(endpoint: string): string {
  try { return new URL(endpoint).host; } catch { return endpoint; }
}

const shadow = "shadow-[0_2px_10px_rgba(20,20,19,0.07)]";
const shadowHover = "hover:shadow-[0_6px_20px_rgba(20,20,19,0.13)]";

export default function Topology({ initial, recent, inspector, rules, users, avgInspectMs, refusals }: TopologyProps) {
  const [live, setLive] = useState(initial);
  const [feed, setFeed] = useState(recent);
  const [open, setOpen] = useState<NodeKey | null>(null);
  const [hover, setHover] = useState<RouteKey | null>(null);
  const [hits, setHits] = useState<Partial<Record<NodeKey, number>>>({});
  const [busy, setBusy] = useState(false);
  const [, setFrame] = useState(0);

  const packets = useRef<Packet[]>([]);
  const paths = useRef<Partial<Record<RouteKey, SVGPathElement | null>>>({});
  const raf = useRef<number | null>(null);
  const since = useRef(initial.now);
  const seen = useRef(new Set(recent.map((d) => d.id)));
  const timers = useRef<number[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  const hit = useCallback((k: NodeKey) => setHits((h) => ({ ...h, [k]: Date.now() + Math.random() })), []);

  const tick = useCallback(() => {
    const now = performance.now();
    packets.current = packets.current.filter((p) => now - p.start < T_IN + T_HOLD + T_OUT);
    setFrame((f) => (f + 1) % 1_000_000);
    raf.current = packets.current.length ? requestAnimationFrame(tick) : null;
  }, []);

  const launch = useCallback((ds: LiveDecision[]) => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const base = performance.now();
    ds.forEach((d, i) => {
      const route: EnvKey | "refused" = d.verdict === "REFUSE" || !d.envKey ? "refused" : d.envKey;
      const delay = i * 320;
      const color = route === "refused" ? "var(--color-deny)"
        : d.level ? LEVEL_COLOR[d.level] : "var(--color-ink-mid)";
      if (!reduce) packets.current.push({ id: `${d.id}-${base}`, route, color, start: base + delay });
      timers.current.push(window.setTimeout(() => hit("core"), reduce ? delay : delay + T_IN));
      timers.current.push(window.setTimeout(() => hit(route), reduce ? delay : delay + T_IN + T_HOLD + T_OUT));
    });
    if (!reduce && raf.current == null) raf.current = requestAnimationFrame(tick);
  }, [hit, tick]);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/live?since=${since.current}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as LivePayload;
      const fresh = data.decisions.filter((d) => !seen.current.has(d.id));
      for (const d of fresh) {
        seen.current.add(d.id);
        since.current = Math.max(since.current, d.ts);
      }
      setLive(data);
      if (fresh.length) {
        launch(fresh);
        setFeed((f) => [...[...fresh].reverse(), ...f].slice(0, 6));
      }
    } catch { /* transient — the next poll retries */ }
  }, [launch]);

  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, 1200);
    const pending = timers.current;
    return () => {
      window.clearInterval(t);
      pending.forEach((id) => window.clearTimeout(id));
      if (raf.current != null) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [poll]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest("[data-node]") && !el.closest("[data-pop]")) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); await poll(); } finally { setBusy(false); }
  }

  function point(route: RouteKey, t: number) {
    const p = paths.current[route];
    if (!p) return null;
    return p.getPointAtLength(p.getTotalLength() * ease(Math.min(1, Math.max(0, t))));
  }

  const envs = live.envs;
  const env = (k: EnvKey) => envs.find((e) => e.key === k);
  const toggle = (k: NodeKey) => setOpen((o) => (o === k ? null : k));
  const now = typeof performance !== "undefined" ? performance.now() : 0;
  const inspecting = live.inspecting > 0;

  /* ---- packets --------------------------------------------------------- */
  const packetEls = packets.current.map((p) => {
    const el = now - p.start;
    if (el < 0) return null;
    const trail = [0, 0.045, 0.09];
    const leg = el < T_IN ? "in" : el < T_IN + T_HOLD ? "hold" : "out";
    if (leg === "hold") return null; // being classified inside the core
    const route: RouteKey = leg === "in" ? "ingress" : p.route;
    const t = leg === "in" ? el / T_IN : (el - T_IN - T_HOLD) / T_OUT;
    const color = leg === "in" ? "var(--color-ink-mid)" : p.color;
    return (
      <g key={p.id}>
        {trail.map((d, i) => {
          const pt = point(route, t - d);
          if (!pt || t - d < 0) return null;
          return i === 0 ? (
            <g key={i} transform={`translate(${pt.x} ${pt.y})`}>
              <circle r={12} fill={color} opacity={0.16} />
              <circle r={5.5} fill={color} />
              <circle r={2} fill="white" opacity={0.85} />
            </g>
          ) : (
            <circle key={i} cx={pt.x} cy={pt.y} r={4 - i} fill={color} opacity={0.35 / i} />
          );
        })}
      </g>
    );
  });

  /* ---- routes ---------------------------------------------------------- */
  const routeStyle = (k: RouteKey) => {
    if (k === "ingress") return { color: "var(--color-ink-faint)", dashed: false, active: inspecting, offline: false };
    if (k === "refused") return { color: "var(--color-deny)", dashed: true, active: false, offline: false };
    const e = env(k);
    return {
      color: e?.status === "offline" ? "var(--color-ink-faint)" : TONE[k].stroke,
      dashed: e?.status === "offline",
      active: (e?.inFlight ?? 0) > 0,
      offline: e?.status === "offline",
    };
  };

  return (
    <section className="mz-panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div>
          <div className="mz-label">Live topology</div>
          <p className="mt-0.5 text-[12px] text-ink-dim">
            Every request is classified in the core, then routed to the one environment accredited to hold it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-ink-dim">
          {(Object.keys(LEVEL_COLOR) as Level[]).map((l) => (
            <span key={l} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: LEVEL_COLOR[l] }} />
              {l.toLowerCase()}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-deny" /> refused
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div ref={rootRef} className="relative mx-auto min-w-[880px] max-w-[1120px] select-none"
             style={{ aspectRatio: `${W} / ${H}` }}>
          {/* dotted canvas */}
          <div className="pointer-events-none absolute inset-0 opacity-60"
               style={{ backgroundImage: "radial-gradient(var(--color-line) 1px, transparent 1px)", backgroundSize: "22px 22px" }} />

          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
            {(Object.keys(ROUTES) as RouteKey[]).map((k) => {
              const s = routeStyle(k);
              const lit = hover === k || open === k;
              return (
                <g key={k}>
                  <path d={ROUTES[k]} fill="none" stroke="var(--color-line)" strokeWidth={7} strokeOpacity={0.45}
                        strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  <path ref={(el) => { paths.current[k] = el; }} d={ROUTES[k]} fill="none" stroke={s.color}
                        strokeWidth={lit ? 2.5 : 1.75} strokeOpacity={lit ? 0.95 : s.active ? 0.7 : 0.4}
                        strokeDasharray={s.dashed ? "5 6" : undefined} strokeLinecap="round"
                        vectorEffect="non-scaling-stroke" className="transition-[stroke-opacity,stroke-width] duration-200" />
                  {s.active && !s.offline && (
                    <path d={ROUTES[k]} fill="none" stroke={s.color} strokeWidth={2.25} strokeLinecap="round"
                          vectorEffect="non-scaling-stroke" className="mz-flow" />
                  )}
                </g>
              );
            })}
            {packetEls}
          </svg>

          {/* ---- source ---- */}
          <div data-node style={pct(POS.source)} className="absolute w-[150px] -translate-x-1/2 -translate-y-1/2">
            <button type="button" onClick={() => toggle("source")}
                    onMouseEnter={() => setHover("ingress")} onMouseLeave={() => setHover(null)}
                    className={`relative w-full rounded-2xl border border-line bg-overlay px-3.5 py-3 text-left transition
                                ${shadow} ${shadowHover} hover:border-ink-faint ${open === "source" ? "border-ink-faint" : ""}`}>
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 16 16" className="h-[14px] w-[14px] text-ink-mid" aria-hidden>
                  <circle cx="6" cy="5.5" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M1.5 13.5c.6-2.4 2.4-3.6 4.5-3.6s3.9 1.2 4.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <circle cx="11.5" cy="6" r="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M11 9.8c1.9.1 3 1.2 3.5 3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                <span className="text-[11px] font-bold tracking-[0.06em]">REQUESTERS</span>
              </div>
              <div className="mt-1.5 font-mono text-[20px] font-semibold leading-none">{live.counts.requests}</div>
              <div className="mt-1 font-mono text-[9.5px] text-ink-dim">{users} users · {live.counts.last24h} today</div>
            </button>
          </div>

          {/* ---- core ---- */}
          <div data-node style={pct(POS.core)} className="absolute w-[214px] -translate-x-1/2 -translate-y-1/2">
            <button type="button" onClick={() => toggle("core")}
                    className={`relative w-full rounded-2xl border border-cloud/30 bg-overlay px-4 py-3.5 text-left transition
                                ${shadow} ${shadowHover} hover:border-cloud/60 ${open === "core" ? "border-cloud/60" : ""}`}>
              {inspecting && <span className="mz-anim-ring pointer-events-none absolute -inset-1.5 rounded-[20px] border-2 border-cloud/50" />}
              {hits.core && <span key={hits.core} className="mz-anim-hit pointer-events-none absolute -inset-1 rounded-[19px] border-2 border-cloud/70" />}
              <div className="flex items-center gap-3">
                <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cloud-soft">
                  <span className={`h-5 w-5 rotate-45 rounded-[3px] border-[1.5px] border-cloud ${inspecting ? "mz-anim-spin" : ""}`} />
                  <span className="absolute h-2 w-2 rounded-full bg-airgap" />
                </span>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-bold tracking-[0.08em]">MIZAN CORE</div>
                  <div className="font-mono text-[9.5px] text-ink-dim">INSPECTOR + POLICY</div>
                </div>
              </div>
              <div className="mt-2.5 flex items-center justify-between font-mono text-[10px]">
                <span className={inspecting ? "mz-anim-pulse text-cloud" : "text-ok"}>
                  {inspecting ? `inspecting ${live.inspecting}…` : "● ready"}
                </span>
                <span className="text-ink-faint">{rules} rules · {Math.round(avgInspectMs)}ms</span>
              </div>
            </button>
          </div>

          {/* ---- environments ---- */}
          {(["cloud", "onprem", "airgap"] as EnvKey[]).map((k) => {
            const e = env(k);
            if (!e) return null;
            const t = TONE[k];
            const offline = e.status === "offline";
            const used = e.inFlight + e.simLoad;
            const full = used >= e.capacity;
            return (
              <div key={k} data-node style={pct(POS[k])} className="absolute w-[244px] -translate-x-1/2 -translate-y-1/2">
                <button type="button" onClick={() => toggle(k)}
                        onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)}
                        className={`relative w-full rounded-2xl border bg-overlay px-3.5 py-3 text-left transition
                                    ${shadow} ${shadowHover}
                                    ${offline ? "border-dashed border-line opacity-70" : t.border}
                                    ${open === k ? "ring-2 ring-line" : ""}`}>
                  {e.inFlight > 0 && !offline && (
                    <span className={`mz-anim-ring pointer-events-none absolute -inset-1.5 rounded-[20px] border-2 ${t.ring}`} />
                  )}
                  {hits[k] && <span key={hits[k]} className={`mz-anim-hit pointer-events-none absolute -inset-1 rounded-[19px] border-2 ${t.ring}`} />}
                  <div className="flex items-center gap-2.5">
                    <span className={`h-[14px] w-[14px] shrink-0 border-[1.5px] border-current ${t.text} ${t.shape}`} />
                    <span className={`truncate text-[11.5px] font-bold tracking-[0.05em] ${t.text}`}>{e.name.toUpperCase()}</span>
                    <span className={`ml-auto shrink-0 rounded px-1.5 py-px font-mono text-[8.5px] tracking-[0.10em]
                      ${offline ? "bg-deny-soft text-deny" : full ? "bg-warn-soft text-warn"
                        : e.inFlight > 0 ? "bg-cloud-soft text-cloud" : "bg-onprem-soft text-ok"}`}>
                      {offline ? "OFFLINE" : full ? "SATURATED" : e.inFlight > 0 ? "RUNNING" : "ONLINE"}
                    </span>
                  </div>
                  <div className="mt-2.5 flex gap-1">
                    {Array.from({ length: e.capacity }, (_, i) => (
                      <span key={i} className={`h-1.5 flex-1 rounded-sm transition-colors duration-300
                        ${i < e.inFlight ? t.bar : i < used ? t.barSoft : "bg-raised"}`} />
                    ))}
                  </div>
                  <div className="mt-1.5 flex justify-between font-mono text-[9.5px] text-ink-dim">
                    <span>{live.counts.routed[k]} routed</span>
                    <span>{Math.min(used, e.capacity)}/{e.capacity} slots</span>
                  </div>
                  <div className="mt-0.5 flex justify-between font-mono text-[9.5px] text-ink-faint">
                    <span>≤ {e.maxLevel}</span>
                    <span>{e.artefact ?? "no artefact"} · +{e.netMs}ms</span>
                  </div>
                </button>
              </div>
            );
          })}

          {/* ---- refused ---- */}
          <div data-node style={pct(POS.refused)} className="absolute w-[214px] -translate-x-1/2 -translate-y-1/2">
            <button type="button" onClick={() => toggle("refused")}
                    onMouseEnter={() => setHover("refused")} onMouseLeave={() => setHover(null)}
                    className={`relative w-full rounded-2xl border border-dashed border-deny/50 bg-overlay px-3.5 py-2.5 text-left
                                transition ${shadowHover} hover:border-deny`}>
              {hits.refused && <span key={hits.refused} className="mz-anim-hit pointer-events-none absolute -inset-1 rounded-[19px] border-2 border-deny/60" />}
              <div className="flex items-center gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-deny text-[10px] text-deny">✕</span>
                <span className="text-[11px] font-semibold tracking-[0.03em] text-deny">REFUSED</span>
                <span className="ml-auto font-mono text-[15px] font-semibold text-deny">{live.counts.refused}</span>
              </div>
              <div className="mt-1 truncate font-mono text-[9.5px] text-ink-dim">no lawful path · {refusals[0]?.name ?? "none yet"}</div>
            </button>
          </div>

          {/* ---- data diode ---- */}
          <div data-node style={pct(POS.diode)} className="absolute -translate-x-1/2 -translate-y-1/2">
            <button type="button" onClick={() => toggle("diode")}
                    className="flex items-center gap-1 rounded-md border border-airgap/50 bg-overlay px-1.5 py-0.5 font-mono
                               text-[8.5px] tracking-[0.12em] text-airgap transition hover:border-airgap">
              ▶ DIODE
            </button>
          </div>

          {/* ---- popover ---- */}
          {open && (
            <Popover node={open} onClose={() => setOpen(null)}>
              {open === "source" && (
                <PopBody kind="REQUESTERS" title={`${users} users`} rows={[
                  ["requests", String(live.counts.requests)],
                  ["last 24h", String(live.counts.last24h)],
                  ["last", feed[0] ? `${feed[0].actor} · ${clock(feed[0].ts)}` : "—"],
                ]} note="Every request enters here and goes to the core before any environment sees it."
                   link={{ href: "/admin?view=users", label: "User management →" }} />
              )}
              {open === "core" && (
                <PopBody kind="CLASSIFIER + POLICY ENGINE" title="Mizan core" rows={[
                  ["inspector", `${inspector.id}:${inspector.model}`],
                  ["boundary", inspector.egressOk ? `on-prem · ${hostOf(inspector.endpoint)}` : inspector.reason],
                  ["avg inspect", `${Math.round(avgInspectMs)} ms`],
                  ["rules", `${rules} active`],
                  ["in inspection", String(live.inspecting)],
                ]} note="Detectors set a floor, the local model may only raise it; policy then picks the environment or refuses."
                   link={{ href: "/admin/policies", label: "Edit policies →" }} />
              )}
              {open === "refused" && (
                <PopBody kind="REFUSAL SINK" title="Refused — no lawful path" rows={[
                  ["total", String(live.counts.refused)],
                  ["rate", live.counts.requests ? `${Math.round((live.counts.refused / live.counts.requests) * 100)}%` : "—"],
                  ...refusals.slice(0, 4).map((r) => [r.name, String(r.count)] as [string, string]),
                ]} note="Refusals are shown to the requester with the rule that blocked them, and logged."
                   link={{ href: "/admin/audit?group=request", label: "Audit ledger →" }} />
              )}
              {open === "diode" && (
                <PopBody kind="ONE-WAY TRANSFER" title="Data diode" rows={[
                  ["direction", "inbound only"],
                  ["medium", "removable media"],
                  ["enclave", env("airgap")?.artefact ?? "—"],
                ]} note="The enclave has no network route. Model artefacts arrive only through this optical diode and are re-hashed before activation."
                   link={{ href: "/admin/deployments", label: "Deployments →" }} />
              )}
              {(open === "cloud" || open === "onprem" || open === "airgap") && env(open) && (
                <EnvPop e={env(open)!} routed={live.counts.routed[open]} busy={busy}
                        onLoad={(d) => act(() => adjustLoadAction(open, d))}
                        onStatus={(s) => act(() => setEnvStatusAction(open, s))} />
              )}
            </Popover>
          )}
        </div>
      </div>

      {/* ---- live feed ---- */}
      <div className="border-t border-line px-5 py-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="mz-label">Live feed</span>
          <span className="text-[11px] text-ink-faint">Click any node for detail</span>
        </div>
        {feed.length === 0 ? (
          <p className="py-1 text-[12px] text-ink-faint">No requests yet — run the demo sequence below.</p>
        ) : (
          <div className="overflow-x-auto">
            <ul className="min-w-[720px]">
              {feed.map((d) => (
                <li key={d.id} className="mz-anim-in grid grid-cols-[66px_minmax(0,170px)_104px_92px_minmax(0,1fr)] items-baseline gap-3 py-1">
                  <span className="font-mono text-[10.5px] text-ink-faint">{clock(d.ts)}</span>
                  <span className="truncate text-[12px] text-ink-mid">{d.actor}</span>
                  <span className={`font-mono text-[10px] tracking-[0.08em] ${d.level ? LEVEL_TEXT[d.level] : "text-ink-faint"}`}>{d.level ?? "—"}</span>
                  {d.verdict === "ALLOW" && d.envKey ? (
                    <span className={`font-mono text-[10.5px] font-semibold ${TONE[d.envKey].text}`}>→ {ENV_META[d.envKey].short}</span>
                  ) : (
                    <span className="font-mono text-[10.5px] font-semibold text-deny">REFUSED</span>
                  )}
                  <span className="truncate text-[12px] text-ink-dim" title={d.reason}>{d.rule}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

/* ---- popover pieces --------------------------------------------------- */

const POP_PLACE: Record<NodeKey, React.CSSProperties> = {
  source:  { ...pct(POS.source),  transform: "translate(90px, -50%)" },
  core:    { ...pct(POS.core),    transform: "translate(122px, -50%)" },
  cloud:   { ...pct(POS.cloud),   transform: "translate(calc(-100% - 136px), -18%)" },
  onprem:  { ...pct(POS.onprem),  transform: "translate(calc(-100% - 136px), -50%)" },
  airgap:  { ...pct(POS.airgap),  transform: "translate(calc(-100% - 136px), -82%)" },
  refused: { ...pct(POS.refused), transform: "translate(-50%, calc(-100% - 42px))" },
  diode:   { ...pct(POS.diode),   transform: "translate(-50%, calc(-100% - 18px))" },
};

function Popover({ node, onClose, children }: { node: NodeKey; onClose: () => void; children: React.ReactNode }) {
  // Placement lives on the wrapper: the entrance animation animates `transform`
  // on the card, and would otherwise override the positioning transform.
  return (
    <div data-pop style={POP_PLACE[node]} className="absolute z-20 w-[290px]">
      <div className="mz-anim-in relative rounded-[18px] border border-line bg-overlay p-4
                      shadow-[0_12px_40px_rgba(20,20,19,0.14)]">
        <button type="button" onClick={onClose} aria-label="Close"
                className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-raised text-[10px]
                           text-ink-dim transition hover:bg-line">✕</button>
        {children}
      </div>
    </div>
  );
}

function PopBody({ kind, title, rows, note, link }: {
  kind: string; title: string; rows: Array<[string, string]>; note: string; link?: { href: string; label: string };
}) {
  return (
    <>
      <div className="pr-6 font-mono text-[8.5px] tracking-[0.12em] text-ink-faint">{kind}</div>
      <div className="mt-1 pr-6 text-[13.5px] font-bold leading-tight">{title}</div>
      <div className="my-2.5 h-px bg-line-soft" />
      <dl className="space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline gap-2.5 font-mono text-[10px]">
            <dt className="w-[80px] shrink-0 truncate text-ink-faint" title={k}>{k}</dt>
            <dd className="min-w-0 break-words text-ink-mid">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2.5 text-[11px] leading-relaxed text-ink-dim">{note}</p>
      {link && (
        <Link href={link.href} className="mt-2 inline-block text-[11.5px] text-cloud hover:underline">{link.label}</Link>
      )}
    </>
  );
}

const btn = `rounded-full border border-line bg-base px-2.5 py-0.5 font-mono text-[10.5px] text-ink-mid transition
             hover:border-ink-faint hover:text-ink disabled:cursor-not-allowed disabled:opacity-40`;

function EnvPop({ e, routed, busy, onLoad, onStatus }: {
  e: EnvRuntime; routed: number; busy: boolean;
  onLoad: (delta: number) => void; onStatus: (s: "online" | "offline") => void;
}) {
  const t = TONE[e.key];
  const offline = e.status === "offline";
  return (
    <>
      <div className="pr-6 font-mono text-[8.5px] tracking-[0.12em] text-ink-faint">EXECUTION ENVIRONMENT</div>
      <div className={`mt-1 pr-6 text-[13.5px] font-bold leading-tight ${t.text}`}>{e.name}</div>
      <div className="my-2.5 h-px bg-line-soft" />
      <dl className="space-y-1.5">
        {([
          ["region", e.region],
          ["accredited", `up to ${e.maxLevel}`],
          ["slots", `${e.inFlight} running · ${e.simLoad} reserved · ${e.capacity} total`],
          ["routed", String(routed)],
          ["cost", `$${e.costPer1k.toFixed(2)} / 1k tokens`],
          ["network", `+${e.netMs} ms · ${e.egress}`],
          ["model", `${e.binding.id}:${e.binding.model} @ ${hostOf(e.binding.endpoint)}`],
          ["artefact", e.artefact ?? "none active"],
        ] as Array<[string, string]>).map(([k, v]) => (
          <div key={k} className="flex items-baseline gap-2.5 font-mono text-[10px]">
            <dt className="w-[66px] shrink-0 text-ink-faint">{k}</dt>
            <dd className="min-w-0 break-words text-ink-mid">{v}</dd>
          </div>
        ))}
      </dl>
      <p className={`mt-2.5 text-[11px] leading-relaxed ${e.binding.egress.ok ? "text-ink-dim" : "text-deny"}`}>
        {e.binding.egress.ok ? "✓" : "✕"} {e.binding.egress.reason}
      </p>
      <div className="mt-3 flex items-center gap-1.5 border-t border-line-soft pt-3">
        <button type="button" className={btn} disabled={busy || e.simLoad === 0} onClick={() => onLoad(-1)}
                aria-label="Release a reserved slot">−</button>
        <span className="font-mono text-[10px] text-ink-dim">reserve load</span>
        <button type="button" className={btn} disabled={busy || e.simLoad >= e.capacity} onClick={() => onLoad(1)}
                aria-label="Reserve a slot">+</button>
        <button type="button" className={`${btn} ml-auto ${offline ? "" : "hover:border-deny hover:text-deny"}`}
                disabled={busy} onClick={() => onStatus(offline ? "online" : "offline")}>
          {offline ? "Bring online" : "Take offline"}
        </button>
      </div>
    </>
  );
}
