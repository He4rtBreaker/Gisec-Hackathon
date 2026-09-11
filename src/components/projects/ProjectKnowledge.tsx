"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteProjectFileAction, updateProjectAction, uploadProjectFileAction, type ProjectResult,
} from "@/app/projects/actions";
import type { ProjectFile } from "@/lib/projects";
import { LEVEL_RANK, type Level } from "@/lib/domain";

const LEVEL_CHIP: Record<Level, string> = {
  PUBLIC:       "border-cloud/35 bg-cloud-soft text-cloud",
  OFFICIAL:     "border-official/35 bg-official-soft text-official",
  CONFIDENTIAL: "border-onprem/35 bg-onprem-soft text-onprem",
  SECRET:       "border-airgap/35 bg-airgap-soft text-airgap",
};

const MAX_BYTES = 200_000;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|log|xml|html?|ya?ml|ini|conf|sql|eml)$/i;
const ACCEPT = ".txt,.md,.markdown,.csv,.tsv,.json,.log,.xml,.html,.htm,.yaml,.yml,.ini,.conf,.sql,.eml,text/*,application/json";

interface Upload {
  key: string;
  name: string;
  state: "reading" | "inspecting" | "added" | "rejected";
  message?: string;
  level?: Level;
}

function kb(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

/** The project's knowledge panel: level, context mode, instructions and files. */
export default function ProjectKnowledge({ projectId, instructions, files, chars, fullLimit, level, reach, clearance }: {
  projectId: string;
  instructions: string;
  files: ProjectFile[];
  chars: number;
  fullLimit: number;
  level: Level | null;
  reach: string[];
  clearance: Level;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [busy, setBusy] = useState(false);

  const patch = (key: string, u: Partial<Upload>) =>
    setUploads((list) => list.map((x) => (x.key === key ? { ...x, ...u } : x)));

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    const batch = Array.from(list).map((f, i) => ({ f, key: `${Date.now()}-${i}` }));
    setUploads((prev) => [...batch.map(({ f, key }) => ({ key, name: f.name, state: "reading" as const })), ...prev]);

    for (const { f, key } of batch) {
      if (!(f.type.startsWith("text/") || f.type === "application/json" || TEXT_EXT.test(f.name))) {
        patch(key, { state: "rejected", message: "Only text-based files (txt, md, csv, json…) are supported." });
        continue;
      }
      if (f.size > MAX_BYTES) {
        patch(key, { state: "rejected", message: "Larger than 200 KB." });
        continue;
      }
      const text = await f.text();
      patch(key, { state: "inspecting" });
      const r = await uploadProjectFileAction(projectId, { filename: f.name, mime: f.type || "text/plain", text });
      patch(key, r.ok ? { state: "added", level: r.level, message: r.message } : { state: "rejected", message: r.message });
    }

    if (inputRef.current) inputRef.current.value = "";
    setBusy(false);
    router.refresh();
  }

  const pct = Math.min(100, Math.round((chars / fullLimit) * 100));
  const full = chars <= fullLimit;

  return (
    <aside className="space-y-4 lg:sticky lg:top-8 lg:self-start">
      <section className="mz-panel overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <div className="mz-label">Project knowledge</div>
          {level ? (
            <p className="mt-1 text-[12px] leading-relaxed text-ink-dim">
              Classified up to{" "}
              <span className={`rounded border px-1 py-px font-mono text-[9.5px] tracking-[0.08em] ${LEVEL_CHIP[level]}`}>{level}</span>.
              {" "}Chats using it can run on {reach.join(", ")}.
            </p>
          ) : (
            <p className="mt-1 text-[12px] leading-relaxed text-ink-dim">
              Add documents for chats in this project to draw on. Each file is classified on-prem as it arrives.
            </p>
          )}
        </div>

        {/* context capacity */}
        {files.length > 0 && (
          <div className="border-b border-line-soft px-4 py-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-raised">
              <span className={`block h-full rounded-full ${full ? "bg-ok" : "bg-cloud"}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1.5 text-[11.5px] leading-snug text-ink-dim">
              {full
                ? <>{chars.toLocaleString()} characters — fits in context, so every request sees all files.</>
                : <>{chars.toLocaleString()} characters — larger than context, so each request retrieves the most relevant excerpts (BM25, on-prem).</>}
            </p>
          </div>
        )}

        <Instructions projectId={projectId} instructions={instructions} />

        {/* files */}
        <div className="px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="mz-label">Files · {files.length}</span>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="rounded-full border border-line px-2.5 py-1 font-mono text-[10px] text-ink-mid transition
                         hover:border-cloud hover:text-cloud disabled:cursor-wait disabled:opacity-50"
            >
              {busy ? "UPLOADING…" : "+ ADD FILES"}
            </button>
            <input ref={inputRef} type="file" multiple hidden accept={ACCEPT} onChange={(e) => onFiles(e.target.files)} />
          </div>

          {uploads.length > 0 && (
            <ul className="mb-2 space-y-1">
              {uploads.map((u) => (
                <li key={u.key} className={`rounded-md px-2 py-1.5 text-[11.5px] ${
                  u.state === "rejected" ? "bg-deny-soft text-deny"
                    : u.state === "added" ? "bg-onprem-soft text-ok" : "bg-raised text-ink-mid"}`}>
                  <span className="font-medium">{u.name}</span>
                  {" — "}
                  {u.state === "reading" && "reading…"}
                  {u.state === "inspecting" && <span className="mz-anim-pulse">inspecting on-prem…</span>}
                  {(u.state === "added" || u.state === "rejected") && u.message}
                </li>
              ))}
            </ul>
          )}

          {files.length === 0 ? (
            <div className="flex flex-col items-center py-4 text-center">
              <img
                src="/illustrations/knowledge-empty.png"
                alt=""
                aria-hidden
                loading="lazy"
                className="mb-2.5 h-[96px] w-[96px] object-contain opacity-90 select-none"
                draggable={false}
              />
              <p className="max-w-[320px] text-[12px] leading-relaxed text-ink-faint">
                No files yet. Text files up to 200 KB — anything above your {clearance} clearance is refused.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-line-soft">
              {files.map((f) => (
                <li key={f.id} className="group flex items-start gap-2.5 py-2">
                  <svg viewBox="0 0 12 14" className="mt-[3px] h-[13px] w-[11px] shrink-0 text-ink-faint" aria-hidden>
                    <path d="M2 1h5l3 3v9H2z" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
                    <path d="M7 1v3h3" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
                  </svg>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] text-ink" title={f.filename}>{f.filename}</div>
                    <div className="truncate font-mono text-[10px] text-ink-faint" title={f.rationale}>
                      {kb(f.sizeBytes)}
                      {f.signals.length > 0 && <> · {f.signals.map((s) => s.code).join(", ")}</>}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] tracking-[0.08em] ${LEVEL_CHIP[f.level]}`}>
                    {f.level}
                  </span>
                  <form action={deleteProjectFileAction}
                        onSubmit={(e) => { if (!confirm(`Remove ${f.filename} from this project?`)) e.preventDefault(); }}>
                    <input type="hidden" name="fileId" value={f.id} />
                    <button type="submit" aria-label={`Remove ${f.filename}`}
                            className="text-[12px] leading-none text-ink-faint opacity-0 transition hover:text-deny
                                       group-hover:opacity-100 focus:opacity-100">
                      ✕
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {level && LEVEL_RANK[level] >= LEVEL_RANK.CONFIDENTIAL && (
        <p className="px-1 text-[11.5px] leading-relaxed text-ink-dim">
          Because this knowledge is {level}, a chat that retrieves from it is sealed {level} and can never
          be routed to Public Cloud.
        </p>
      )}
    </aside>
  );
}

function Instructions({ projectId, instructions }: { projectId: string; instructions: string }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<ProjectResult, FormData>(updateProjectAction, null);

  useEffect(() => { if (state?.ok) setEditing(false); }, [state]);

  return (
    <div className="border-b border-line-soft px-4 py-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="mz-label">Instructions</span>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)}
                  className="font-mono text-[10px] text-ink-dim transition hover:text-cloud">
            {instructions ? "EDIT" : "+ SET"}
          </button>
        )}
      </div>

      {editing ? (
        <form action={action} className="space-y-2">
          <input type="hidden" name="projectId" value={projectId} />
          <textarea name="instructions" defaultValue={instructions} rows={5} maxLength={4000} autoFocus
                    placeholder="e.g. Answer as a finance policy analyst. Cite the section you rely on."
                    className="mz-field w-full resize-y px-2.5 py-2 text-[12.5px] leading-relaxed" />
          <div className="flex items-center gap-2">
            <button type="submit" disabled={pending}
                    className="rounded-full bg-primary px-3.5 py-1 font-mono text-[10.5px] font-semibold tracking-[0.08em]
                               text-white transition hover:bg-primary-active disabled:opacity-60">
              {pending ? "SAVING…" : "SAVE"}
            </button>
            <button type="button" onClick={() => setEditing(false)}
                    className="rounded-full border border-line px-3 py-1 font-mono text-[10.5px] text-ink-mid
                               transition hover:border-ink-faint">
              CANCEL
            </button>
            {state && !state.ok && <span className="text-[11.5px] text-deny">{state.message}</span>}
          </div>
        </form>
      ) : instructions ? (
        <p className="line-clamp-4 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-mid">{instructions}</p>
      ) : (
        <p className="text-[12px] leading-relaxed text-ink-faint">
          Tell the assistant how to behave in this project. Instructions are inspected with every request.
        </p>
      )}
    </div>
  );
}
