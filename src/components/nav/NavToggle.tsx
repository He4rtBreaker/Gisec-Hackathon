"use client";

import { navSet, useNav } from "./useNav";

function PanelIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none"
            stroke="currentColor" strokeWidth="1.4" />
      <line x1="6.5" y1="2.5" x2="6.5" y2="13.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/**
 * - "header": the collapse control inside the open sidebar. Hidden while collapsed.
 * - "edge":   collapsed-mode chrome — a button that peeks the sidebar open on hover
 *             and pins it open on click, plus an off-sidebar catcher that dismisses
 *             the peek the moment the pointer moves away.
 */
export default function NavToggle({ placement }: { placement: "header" | "edge" }) {
  const { collapsed, peek } = useNav();

  if (placement === "header") {
    if (collapsed) return null;
    return (
      <button
        type="button"
        onClick={() => navSet({ collapsed: true })}
        aria-label="Collapse navigation"
        title="Collapse navigation"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-base
                   text-ink-dim transition hover:border-ink-faint hover:text-ink"
      >
        <PanelIcon className="h-[15px] w-[15px]" />
      </button>
    );
  }

  // placement === "edge"
  if (!collapsed) return null;
  return (
    <>
      {/* While peeked, anywhere off the sidebar dismisses it. Sits below the aside (z-40). */}
      {peek && (
        <div
          onMouseEnter={() => navSet({ peek: false })}
          className="fixed inset-0 z-30"
          aria-hidden
        />
      )}
      {/* Hover to peek, click to pin open. Always reachable at the top-left. */}
      <button
        type="button"
        onClick={() => navSet({ collapsed: false })}
        onMouseEnter={() => navSet({ peek: true })}
        aria-label="Open navigation"
        title="Open navigation"
        className={`fixed left-2.5 top-2.5 z-50 flex h-8 w-8 items-center justify-center rounded-full
                    border border-line bg-base text-ink-dim shadow-sm transition
                    hover:border-ink-faint hover:text-ink ${peek ? "opacity-0" : "opacity-100"}`}
      >
        <PanelIcon className="h-[15px] w-[15px]" />
      </button>
    </>
  );
}
