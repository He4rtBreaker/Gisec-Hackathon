"use client";

import { useEffect, useState } from "react";
import { userHistoryAction } from "@/app/admin/actions";
import type { HistoryRequest, HistoryThread, UserHistory, UserSummary } from "@/lib/users";
import { ENV_META, LEVELS, type EnvKey, type Level } from "@/lib/domain";

const LEVEL_TONE: Record<Level, { text: string; dot: string; chip: string }> = {
  PUBLIC:       { text: "text-cloud",    dot: "bg-cloud",    chip: "border-cloud/35 bg-cloud-soft text-cloud" },
  OFFICIAL:     { text: "text-official", dot: "bg-official", chip: "border-official/35 bg-official-soft text-official" },
  CONFIDENTIAL: { text: "text-onprem",   dot: "bg-onprem",   chip: "border-onprem/35 bg-onprem-soft text-onprem" },
  SECRET:       { text: "text-airgap",   dot: "bg-airgap",   chip: "border-airgap/35 bg-airgap-soft text-airgap" },
};
const ENV_TEXT: Record<EnvKey, string> = { cloud: "text-cloud", onprem: "text-onprem", airgap: "text-airgap" };

function ago(ts: number | null): string {
  if (!ts) return "—";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function stamp(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

const initials = (name: string) => name.split(" ").map((w) => w[0]).slice(0, 2).join("");
const roleLabel = (r: UserSummary["role"]) => (r === "admin" ? "Administrator" : "Employee");

function LevelChip({ level }: { level: Level }) {
  return (
    <span className={`rounded border px-1.5 py-0.5 font-mono text-[9.5px] tracking-[0.10em] ${LEVEL_TONE[level].chip}`}>
      {level}
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 10 6" aria-hidden
         className={`h-[6px] w-[10px] shrink-0 text-ink-faint transition-transform duration-150 ${open ? "rotate-180" : ""}`}>
      <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---- directory ------------------------------------------------------- */

export default function UserDirectory({ users }: { users: UserSummary[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="mz-label mr-1">{users.length} users</span>
        {LEVELS.slice().reverse().map((l) => {
          const n = users.filter((u) => u.clearance === l).length;
          return n ? (
            <span key={l} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-overlay
                                     px-2.5 py-1 text-[11.5px] text-ink-mid">
              <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_TONE[l].dot}`} />
              {n} cleared {l.toLowerCase()}
            </span>
          ) : null;
        })}
      </div>

      <section className="mz-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left">
            <thead>
              <tr className="border-b border-line">
                {["Identity", "Organisation", "Role", "Clearance", "Threads", "Requests", "Refused", "Highest seal", "Last active"]
                  .map((h, i) => (
                    <th key={h} className={`mz-label px-4 py-2.5 font-normal ${i >= 4 && i <= 6 ? "text-right" : ""}`}>{h}</th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  tabIndex={0}
                  onClick={() => setOpenId(u.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenId(u.id); } }}
                  className="cursor-pointer border-b border-line-soft transition last:border-0 hover:bg-surface
                             focus:bg-surface focus:outline-none"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cloud-soft
                                       font-mono text-[11px] font-semibold text-cloud">{initials(u.name)}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium">{u.name}</span>
                        <span className="block truncate font-mono text-[10.5px] text-ink-dim">{u.email}</span>
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[12.5px] text-ink-mid">{u.org}</td>
                  <td className="px-4 py-3 text-[12.5px] text-ink-mid">{roleLabel(u.role)}</td>
                  <td className="px-4 py-3"><LevelChip level={u.clearance} /></td>
                  <td className="px-4 py-3 text-right font-mono text-[12px]">{u.threads}</td>
                  <td className="px-4 py-3 text-right font-mono text-[12px]">{u.requests}</td>
                  <td className={`px-4 py-3 text-right font-mono text-[12px] ${u.refused ? "text-deny" : "text-ink-faint"}`}>{u.refused}</td>
                  <td className="px-4 py-3">
                    {u.highestSeal ? (
                      <span className={`inline-flex items-center gap-1.5 font-mono text-[10.5px] ${LEVEL_TONE[u.highestSeal].text}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${LEVEL_TONE[u.highestSeal].dot}`} />
                        {u.highestSeal}
                      </span>
                    ) : <span className="text-ink-faint">—</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-[10.5px] text-ink-dim">{ago(u.lastActive ?? u.lastSignIn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {openId && <UserPopup userId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

/* ---- popup ------------------------------------------------------------ */

function UserPopup({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [data, setData] = useState<UserHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    userHistoryAction(userId)
      .then((d) => { if (live) d ? setData(d) : setError("User not found."); })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [userId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const u = data?.user;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/20 px-4 py-[6vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-label={u ? `${u.name} — user detail` : "User detail"}
           className="mz-anim-in flex max-h-[88vh] w-full max-w-[760px] flex-col overflow-hidden rounded-[18px]
                      border border-line bg-overlay shadow-[0_12px_40px_rgba(20,20,19,0.14)]">
        {/* header */}
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cloud-soft
                             font-mono text-[12px] font-semibold text-cloud">{u ? initials(u.name) : "··"}</span>
            <div className="min-w-0">
              <div className="font-mono text-[8.5px] tracking-[0.12em] text-ink-faint">
                USER · {u ? roleLabel(u.role).toUpperCase() : "LOADING"}
              </div>
              <div className="truncate text-[15px] font-bold leading-tight">{u?.name ?? "Loading…"}</div>
              {u && <div className="truncate font-mono text-[10.5px] text-ink-dim">{u.email}</div>}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-raised text-[11px]
                             text-ink-dim transition hover:bg-line">✕</button>
        </div>
        <div className="h-px bg-line-soft" />

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error && <p className="text-[12.5px] text-deny">{error}</p>}
          {!data && !error && <p className="mz-anim-pulse text-[12.5px] text-ink-dim">Loading profile and history…</p>}

          {data && u && (
            <div className="space-y-5">
              {/* profile */}
              <div className="grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2">
                <KV k="organisation" v={u.org} />
                <KV k="role" v={roleLabel(u.role)} />
                <KV k="clearance" v={<LevelChip level={u.clearance} />} />
                <KV k="highest seal" v={u.highestSeal ?? "—"} tone={u.highestSeal ? LEVEL_TONE[u.highestSeal].text : undefined} />
                <KV k="last sign-in" v={stamp(u.lastSignIn)} />
                <KV k="failed logins" v={String(data.failedSignIns)} tone={data.failedSignIns ? "text-deny" : undefined} />
                <KV k="requests" v={`${u.requests} in ${u.threads} thread${u.threads === 1 ? "" : "s"}`} />
                <KV k="refused" v={String(u.refused)} tone={u.refused ? "text-deny" : undefined} />
              </div>

              {/* access */}
              <div className="rounded-lg border border-line-soft bg-surface px-3.5 py-3">
                <div className="mz-label mb-1.5">Access</div>
                <p className="text-[12.5px] leading-relaxed text-ink-mid">
                  Cleared to process material up to <span className={`font-mono text-[11px] ${LEVEL_TONE[u.clearance].text}`}>{u.clearance}</span>.
                  {u.clearance !== "SECRET" && " Anything classified above that is refused by the Clearance ceiling rule."}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {data.reachable.map((e) => (
                    <span key={e} className={`rounded-full border border-line bg-overlay px-2 py-0.5 font-mono text-[10px] ${ENV_TEXT[e]}`}>
                      ✓ {ENV_META[e].short}
                    </span>
                  ))}
                  {data.closed.map((e) => (
                    <span key={e} className="rounded-full border border-dashed border-line px-2 py-0.5 font-mono text-[10px] text-ink-faint line-through">
                      {ENV_META[e].short}
                    </span>
                  ))}
                </div>
              </div>

              {/* history */}
              <div>
                <div className="mz-label mb-2">Request history</div>
                {data.threads.length === 0 ? (
                  <p className="text-[12.5px] text-ink-faint">No requests yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {data.threads.map((t, i) => <ThreadItem key={t.id} t={t} defaultOpen={i === 0} />)}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KV({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline gap-2.5 font-mono text-[10.5px]">
      <span className="w-[88px] shrink-0 text-ink-faint">{k}</span>
      <span className={`min-w-0 truncate ${tone ?? "text-ink-mid"}`}>{v}</span>
    </div>
  );
}

function ThreadItem({ t, defaultOpen }: { t: HistoryThread; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const refused = t.requests.filter((r) => r.verdict === "REFUSE").length;

  return (
    <li className="overflow-hidden rounded-lg border border-line">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-surface">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${LEVEL_TONE[t.seal].dot}`} title={`Sealed at ${t.seal}`} />
        <span className="min-w-0 flex-1 truncate text-[12.5px]">{t.title}</span>
        <span className="shrink-0 font-mono text-[10px] text-ink-faint">
          {t.requests.length} req{refused ? <span className="text-deny"> · {refused} refused</span> : null} · {ago(t.updatedAt)}
        </span>
        <LevelChip level={t.seal} />
        <Chevron open={open} />
      </button>

      {open && (
        <ol className="mz-anim-in divide-y divide-line-soft border-t border-line-soft bg-surface">
          {t.requests.map((r) => <RequestRow key={r.id} r={r} />)}
          {t.requests.length === 0 && <li className="px-3 py-2 text-[12px] text-ink-faint">No requests in this thread.</li>}
        </ol>
      )}
    </li>
  );
}

function RequestRow({ r }: { r: HistoryRequest }) {
  const failed = r.verdict === "ALLOW" && r.replyStatus === "error";
  return (
    <li className="grid grid-cols-[96px_1fr_auto] items-start gap-3 px-3 py-2">
      <span className="pt-px font-mono text-[10px] text-ink-faint">{stamp(r.ts)}</span>
      <div className="min-w-0">
        <p className="line-clamp-2 text-[12px] leading-snug text-ink-mid">{r.content}</p>
        {r.files > 0 && <span className="font-mono text-[10px] text-ink-faint">+{r.files} file{r.files > 1 ? "s" : ""}</span>}
        {r.verdict === "REFUSE" && r.reason && (
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-deny">{r.reason}</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        {r.level && <LevelChip level={r.level} />}
        {r.verdict === "REFUSE" ? (
          <span className="font-mono text-[10px] font-semibold text-deny">REFUSED · {r.rule}</span>
        ) : failed ? (
          <span className="font-mono text-[10px] font-semibold text-deny">FAILED</span>
        ) : r.verdict === "ALLOW" && r.envKey ? (
          <span className={`font-mono text-[10px] font-semibold ${ENV_TEXT[r.envKey]}`}>→ {ENV_META[r.envKey].short}</span>
        ) : (
          <span className="font-mono text-[10px] text-ink-faint">—</span>
        )}
      </div>
    </li>
  );
}
