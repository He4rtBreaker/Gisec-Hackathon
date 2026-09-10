"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { Level } from "@/lib/domain";
import { navSet, useNav } from "@/components/nav/useNav";
import NavToggle from "@/components/nav/NavToggle";

interface ConvSummary {
  id: string;
  title: string;
  sealLevel: Level;
  updatedAt: number;
}

interface Props {
  user: { name: string; email: string; role: string; org: string; clearance: Level };
  conversations: ConvSummary[];
}

const LEVEL_DOT: Record<Level, string> = {
  PUBLIC: "bg-cloud",
  OFFICIAL: "bg-official",
  CONFIDENTIAL: "bg-onprem",
  SECRET: "bg-airgap",
};

function relative(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function Sidebar({ user, conversations }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { collapsed, peek, animate } = useNav();

  return (
    <aside
      onMouseLeave={collapsed ? () => navSet({ peek: false }) : undefined}
      className={`flex w-[264px] flex-col overflow-hidden bg-surface
        ${animate ? "transition-transform duration-200" : ""}
        ${collapsed
          ? `fixed inset-y-0 left-0 z-40 border-r border-line shadow-2xl ${peek ? "translate-x-0" : "-translate-x-full"}`
          : "relative shrink-0 border-r border-line"}`}
    >
      {/* Brand */}
      <div className="flex items-center gap-2 border-b border-line px-4 py-3.5">
        <span className="font-mono text-[15px] font-semibold tracking-[0.24em]">MIZAN</span>
        <span className="ml-auto shrink-0"><NavToggle placement="header" /></span>
      </div>

      <div className="p-3">
        <Link
          href="/chat"
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-line
                     bg-raised px-3 py-2 font-mono text-[11px] tracking-[0.10em] text-ink-mid
                     transition hover:border-cloud hover:text-ink"
        >
          <span className="text-[14px] leading-none">+</span> NEW REQUEST
        </Link>
        <Link
          href="/projects"
          className={`mt-1.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition
            ${pathname.startsWith("/projects") ? "bg-raised text-ink" : "text-ink-dim hover:bg-raised/60 hover:text-ink-mid"}`}
        >
          <svg viewBox="0 0 16 14" className="h-[13px] w-[14px] shrink-0" aria-hidden>
            <path d="M1.5 3.2c0-.7.5-1.2 1.2-1.2h3.1l1.5 1.6h5.9c.7 0 1.2.5 1.2 1.2v6.5c0 .7-.5 1.2-1.2 1.2H2.7c-.7 0-1.2-.5-1.2-1.2z"
                  fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          Projects
        </Link>
      </div>

      {/* Threads */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <div className="mz-label px-2 pb-2 pt-1">Threads</div>
        {conversations.length === 0 && (
          <div className="flex flex-col items-center px-2 py-3 text-center">
            <img
              src="/illustrations/assistant-ready.png"
              alt=""
              aria-hidden
              loading="lazy"
              className="mb-2 h-[76px] w-[76px] object-contain opacity-90 select-none"
              draggable={false}
            />
            <p className="text-[12px] leading-relaxed text-ink-faint">
              No requests yet. Start one above.
            </p>
          </div>
        )}
        <ul className="space-y-0.5">
          {conversations.map((c) => {
            const active = pathname === `/chat/${c.id}`;
            return (
              <li key={c.id}>
                <Link
                  href={`/chat/${c.id}`}
                  className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition
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
      </nav>

      {/* Identity */}
      <div className="relative border-t border-line p-3">
        {open && (
          <div className="mz-anim-in absolute bottom-full left-3 right-3 mb-2 overflow-hidden rounded-lg
                          mz-pop">
            {user.role === "admin" && (
              <Link href="/admin" className="block px-3 py-2.5 text-[13px] text-ink-mid hover:bg-raised hover:text-ink">
                Admin console
              </Link>
            )}
            <form action="/api/auth/logout" method="post">
              <button type="submit"
                className="w-full px-3 py-2.5 text-left text-[13px] text-ink-mid hover:bg-raised hover:text-deny">
                Sign out
              </button>
            </form>
          </div>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-raised"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full
                           bg-cloud-soft font-mono text-[11px] font-semibold text-cloud">
            {user.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] text-ink">{user.name}</span>
            <span className="mz-label block text-[9px]">{user.clearance}</span>
          </span>
          <span className="text-ink-faint">{open ? "▾" : "▸"}</span>
        </button>
      </div>
    </aside>
  );
}
