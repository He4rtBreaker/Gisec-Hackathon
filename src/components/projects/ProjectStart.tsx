"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Start a chat inside the project. The first request is sent as soon as the chat opens. */
export default function ProjectStart({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");

  function start() {
    const text = value.trim();
    if (!text) return;
    router.push(`/chat?project=${encodeURIComponent(projectId)}&q=${encodeURIComponent(text)}`);
  }

  return (
    <div className="rounded-2xl border border-line bg-overlay p-2.5 transition
                    focus-within:border-cloud focus-within:shadow-[0_0_0_3px_var(--color-cloud-soft)]">
      <textarea
        rows={2}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); start(); } }}
        placeholder={`How can I help with ${projectName}?`}
        className="w-full resize-none bg-transparent px-1.5 py-1.5 text-[14.5px] leading-relaxed outline-none
                   placeholder:text-ink-faint"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="px-1.5 text-[11px] text-ink-faint">Uses this project&apos;s knowledge and instructions.</span>
        <button
          type="button"
          onClick={start}
          disabled={!value.trim()}
          className="rounded-full bg-primary px-4 py-1.5 font-mono text-[11px] font-semibold tracking-[0.10em]
                     text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
        >
          START CHAT
        </button>
      </div>
    </div>
  );
}
