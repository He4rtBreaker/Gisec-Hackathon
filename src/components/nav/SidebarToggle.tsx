"use client";

import { useSidebarCollapsed } from "./useSidebarCollapsed";

/**
 * Collapse / expand control for the left navigation.
 * - "header": sits inside the open sidebar, hidden while collapsed.
 * - "rail":   floats at the top-left of the content area, shown only while collapsed.
 */
export default function SidebarToggle({ placement }: { placement: "header" | "rail" }) {
  const [collapsed, toggle] = useSidebarCollapsed();

  if (placement === "header" && collapsed) return null;
  if (placement === "rail" && !collapsed) return null;

  const base =
    "flex h-8 w-8 items-center justify-center rounded-full border border-line bg-base " +
    "text-ink-dim transition hover:border-ink-faint hover:text-ink";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={collapsed ? "Open navigation" : "Close navigation"}
      title={collapsed ? "Open navigation" : "Close navigation"}
      className={placement === "rail" ? `fixed left-3 top-3 z-30 ${base}` : base}
    >
      <svg viewBox="0 0 12 12" aria-hidden className="h-3 w-3">
        {collapsed ? (
          <path d="M4 2l5 4-5 4" fill="none" stroke="currentColor" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M8 2L3 6l5 4" fill="none" stroke="currentColor" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </button>
  );
}
