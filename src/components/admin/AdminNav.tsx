"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Level } from "@/lib/domain";

const NAV = [
  { href: "/admin",             label: "Overview",     hint: "Workload · users · demo", exact: true },
  { href: "/admin/policies",    label: "Policies",     hint: "Routing rules · simulator" },
  { href: "/admin/deployments", label: "Deployments",  hint: "Artefact versions · diode import" },
  { href: "/admin/audit",       label: "Audit ledger", hint: "Hash-chained decision log" },
];

export default function AdminNav({ user }: { user: { name: string; clearance: Level } }) {
  const pathname = usePathname();

  return (
    <aside className="flex w-[232px] shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-baseline gap-2.5 border-b border-line px-4 py-4">
        <span className="font-mono text-[15px] font-semibold tracking-[0.26em]">MIZAN</span>
        <span className="mz-label text-[9px]">Admin console</span>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="mz-label px-2 pb-2 pt-2">Console</div>
        {NAV.map((n) => {
          const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`block rounded-lg px-2.5 py-2 transition
                ${active ? "bg-raised" : "hover:bg-raised/60"}`}
            >
              <span className={`block text-[13px] ${active ? "text-ink" : "text-ink-mid"}`}>{n.label}</span>
              <span className="block text-[11px] text-ink-faint">{n.hint}</span>
            </Link>
          );
        })}

        <div className="mz-label px-2 pb-2 pt-5">Workspace</div>
        <Link href="/chat"
              className="block rounded-lg px-2.5 py-2 text-[13px] text-ink-mid transition hover:bg-raised/60">
          Open chat
        </Link>
      </nav>

      <div className="flex items-center gap-2.5 border-t border-line p-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full
                         bg-cloud-soft font-mono text-[11px] font-semibold text-cloud">
          {user.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] text-ink">{user.name}</span>
          <span className="mz-label block text-[9px]">Admin · {user.clearance}</span>
        </span>
        <form action="/api/auth/logout" method="post">
          <button type="submit" className="font-mono text-[10px] tracking-[0.08em] text-ink-dim hover:text-deny">
            SIGN OUT
          </button>
        </form>
      </div>
    </aside>
  );
}
