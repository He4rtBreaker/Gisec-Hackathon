"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Re-render the server page on an interval so the topology tracks live load. */
export default function AutoRefresh({ ms = 4000 }: { ms?: number }) {
  const router = useRouter();
  const [on, setOn] = useState(true);

  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, ms);
    return () => clearInterval(t);
  }, [on, ms, router]);

  return (
    <button
      type="button"
      onClick={() => setOn((v) => !v)}
      className="flex items-center gap-2 rounded-full border border-line bg-overlay px-3 py-1.5
                 font-mono text-[10.5px] tracking-[0.08em] text-ink-mid transition hover:border-ink-faint"
      title={on ? "Auto-refreshing every few seconds — click to pause" : "Paused — click to resume"}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-ok mz-anim-pulse" : "bg-ink-faint"}`} />
      {on ? "LIVE" : "PAUSED"}
    </button>
  );
}
