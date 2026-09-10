"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Level } from "@/lib/domain";
import { useNav } from "@/components/nav/useNav";
import NavToggle from "@/components/nav/NavToggle";

/**
 * The admin's left column. Shared by the console and the chat so an admin
 * sees one consistent navigation wherever they are.
 */

interface NavEntry { href: string; label: string; hint: string; exact?: boolean }

const PRIMARY: NavEntry[] = [
  { href: "/admin",          label: "Overview", hint: "Workload · users · demo", exact: true },
  { href: "/admin/policies", label: "Policies", hint: "Routing rules · simulator" },
];

/** Collapsed by default; opens on its own pages and remembers the choice. */
const GOVERNANCE: NavEntry[] = [
  { href: "/admin/deployments", label: "Deployments",  hint: "Artefact versions · diode import" },
  { href: "/admin/audit",       label: "Audit ledger", hint: "Hash-chained decision log" },
];
const GOV_KEY = "mizan.nav.governance";

function NavItem({ item, pathname }: { item: NavEntry; pathname: string }) {
  const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
  return (
    <Link
      href={item.href}
      className={`block rounded-lg px-2.5 py-2 transition ${active ? "bg-raised" : "hover:bg-raised/60"}`}
    >
      <span className={`block text-[13px] ${active ? "text-ink" : "text-ink-mid"}`}>{item.label}</span>
      <span className="block text-[11px] text-ink-faint">{item.hint}</span>
    </Link>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 10 6" aria-hidden
         className={`h-[6px] w-[10px] shrink-0 text-ink-faint transition-transform duration-150 ${open ? "rotate-180" : ""}`}>
      <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const LEVEL_DOT: Record<Level, string> = {
  PUBLIC: "bg-cloud",
  OFFICIAL: "bg-official",
  CONFIDENTIAL: "bg-onprem",
  SECRET: "bg-airgap",
};

export interface ChatSummary {
  id: string;
  title: string;
  sealLevel: Level;
  updatedAt: number;
}

function relative(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function AdminNav({ user, conversations }: {
  user: { name: string; clearance: Level };
  conversations: ChatSummary[];
}) {
  const pathname = usePathname();
  const { collapsed } = useNav();
  const govActive = GOVERNANCE.some((n) => pathname.startsWith(n.href));
  const [govOpen, setGovOpen] = useState(govActive);

  // Restore the viewer's last choice; always open when on one of its pages.
  useEffect(() => {
    if (govActive) { setGovOpen(true); return; }
    try { if (localStorage.getItem(GOV_KEY) === "1") setGovOpen(true); } catch { /* storage blocked */ }
  }, [govActive]);

  function toggleGovernance() {
    setGovOpen((v) => {
      try { localStorage.setItem(GOV_KEY, v ? "0" : "1"); } catch { /* storage blocked */ }
      return !v;
    });
  }

  return (
    <aside
      className={`flex w-[232px] flex-col overflow-hidden border-r border-line bg-surface
        ${collapsed ? "hidden" : "relative shrink-0"}`}
    >
      <div className="flex items-baseline gap-2.5 border-b border-line px-4 py-3.5">
        <span className="font-serif text-[24px] font-medium tracking-tight text-ink">Mizan</span>
        <span className="mz-label text-[8.5px]">Admin</span>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="mz-label px-2 pb-2 pt-2">Console</div>
        {PRIMARY.map((n) => <NavItem key={n.href} item={n} pathname={pathname} />)}

        <button
          type="button"
          onClick={toggleGovernance}
          aria-expanded={govOpen}
          className="mt-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-raised/60"
        >
          <span className="min-w-0 flex-1">
            <span className={`block text-[13px] ${govActive ? "text-ink" : "text-ink-mid"}`}>Governance</span>
            <span className="block text-[11px] text-ink-faint">Deployments · audit ledger</span>
          </span>
          <Chevron open={govOpen} />
        </button>
        {govOpen && (
          <div className="mz-anim-in ml-3 border-l border-line pl-1.5">
            {GOVERNANCE.map((n) => <NavItem key={n.href} item={n} pathname={pathname} />)}
          </div>
        )}

        <div className="mz-label px-2 pb-2 pt-5">Workspace</div>
        <Link
          href="/projects"
          className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition
            ${pathname.startsWith("/projects") ? "bg-raised text-ink" : "text-ink-mid hover:bg-raised/60"}`}
        >
          <svg viewBox="0 0 16 14" className="h-[13px] w-[14px] shrink-0 text-ink-dim" aria-hidden>
            <path d="M1.5 3.2c0-.7.5-1.2 1.2-1.2h3.1l1.5 1.6h5.9c.7 0 1.2.5 1.2 1.2v6.5c0 .7-.5 1.2-1.2 1.2H2.7c-.7 0-1.2-.5-1.2-1.2z"
                  fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          Projects
        </Link>

        <div className="flex items-center justify-between px-2 pb-2 pt-4">
          <span className="mz-label">Chats</span>
          <Link
            href="/chat"
            className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] tracking-[0.08em] transition
              ${pathname === "/chat" ? "bg-raised text-ink" : "text-ink-dim hover:bg-raised/60 hover:text-cloud"}`}
          >
            + NEW
          </Link>
        </div>

        {conversations.length === 0 ? (
          <div className="flex flex-col items-center px-2.5 py-3 text-center">
            <img
              src="/illustrations/assistant-ready.png"
              alt=""
              aria-hidden
              loading="lazy"
              className="mb-2 h-[76px] w-[76px] object-contain opacity-90 select-none"
              draggable={false}
            />
            <p className="text-[12px] leading-relaxed text-ink-faint">No chats yet. Start one above.</p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((c) => {
              const active = pathname === `/chat/${c.id}`;
              return (
                <li key={c.id}>
                  <Link
                    href={`/chat/${c.id}`}
                    className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition
                      ${active ? "bg-raised text-ink" : "text-ink-dim hover:bg-raised/60 hover:text-ink-mid"}`}
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${LEVEL_DOT[c.sealLevel]}`}
                          title={`Thread sealed at ${c.sealLevel}`} />
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    <span className="shrink-0 font-mono text-[10px] text-ink-faint">{relative(c.updatedAt)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <div className="flex items-center gap-1.5 border-t border-line px-2.5 py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full
                         bg-cloud-soft font-mono text-[11px] font-semibold text-cloud">
          {user.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] text-ink">{user.name}</span>
          <span className="mz-label block truncate text-[9px]">Admin · {user.clearance}</span>
        </span>
        <NavToggle placement="footer" />
        <form action="/api/auth/logout" method="post">
          <button type="submit" aria-label="Sign out" title="Sign out"
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition hover:bg-raised hover:text-deny">
            <svg viewBox="0 0 14 14" aria-hidden className="h-[13px] w-[13px]">
              <path d="M5.5 2.5H3a1 1 0 00-1 1v7a1 1 0 001 1h2.5M9 4.5L11.5 7 9 9.5M11.5 7H5.5"
                    fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </form>
      </div>
    </aside>
  );
}
