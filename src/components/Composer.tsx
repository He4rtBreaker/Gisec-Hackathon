"use client";

import { useEffect, useRef, useState } from "react";
import EnvSelector from "./EnvSelector";
import ProjectPicker from "./ProjectPicker";
import type { EnvKey, Level } from "@/lib/domain";
import type { ProjectOption } from "@/lib/projects";

export interface DraftAttachment {
  filename: string;
  mime: string;
  size: number;
  text: string;
}

const MAX_FILES = 3;
const MAX_BYTES = 200_000;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|log|xml|html?|ya?ml|ini|conf|sql|eml)$/i;
const ACCEPT = ".txt,.md,.markdown,.csv,.tsv,.json,.log,.xml,.html,.htm,.yaml,.yml,.ini,.conf,.sql,.eml,text/*,application/json";

interface Props {
  onSend: (text: string, attachments: DraftAttachment[]) => void;
  onStop: () => void;
  busy: boolean;
  preferred: EnvKey | "auto";
  onPreferredChange: (v: EnvKey | "auto") => void;
  clearance: Level;
  seal: Level;
  /** Text pushed in from outside, e.g. a suggestion. `n` makes repeats distinct. */
  seed?: { text: string; n: number } | null;
  projects: ProjectOption[];
  projectId: string | null;
  onProjectChange: (id: string | null) => void;
  projectLocked: boolean;
}

function kb(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

export default function Composer({
  onSend, onStop, busy, preferred, onPreferredChange, clearance, seal, seed,
  projects, projectId, onProjectChange, projectLocked,
}: Props) {
  const [value, setValue] = useState("");
  const [files, setFiles] = useState<DraftAttachment[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function grow() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
  }

  useEffect(() => {
    if (!seed) return;
    setValue(seed.text);
    requestAnimationFrame(() => { grow(); taRef.current?.focus(); });
  }, [seed]);

  async function addFiles(list: FileList | null) {
    if (!list) return;
    setFileError(null);
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= MAX_FILES) { setFileError(`Up to ${MAX_FILES} files per request.`); break; }
      if (!(f.type.startsWith("text/") || f.type === "application/json" || TEXT_EXT.test(f.name))) {
        setFileError(`${f.name}: only text-based files (txt, md, csv, json…) are supported.`);
        continue;
      }
      if (f.size > MAX_BYTES) { setFileError(`${f.name} is over 200 KB.`); continue; }
      const text = await f.text();
      if (text.includes("\u0000")) { setFileError(`${f.name} looks like a binary file.`); continue; }
      next.push({ filename: f.name, mime: f.type || "text/plain", size: f.size, text });
    }
    setFiles(next);
    if (fileRef.current) fileRef.current.value = "";
  }

  function submit() {
    const text = value.trim();
    if ((!text && !files.length) || busy) return;
    onSend(text, files);
    setValue("");
    setFiles([]);
    setFileError(null);
    requestAnimationFrame(() => {
      if (taRef.current) taRef.current.style.height = "auto";
    });
  }

  return (
    <div className="shrink-0 px-5 pb-5 pt-2">
      <div className="mx-auto w-full max-w-[760px]">
        <div
          className="rounded-2xl border border-line bg-overlay p-2.5 transition
                     focus-within:border-cloud focus-within:shadow-[0_0_0_3px_var(--color-cloud-soft)]"
        >
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-1 pb-1.5">
              {files.map((f, i) => (
                <span key={`${f.filename}-${i}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-raised px-2 py-1
                                 text-[11.5px] text-ink-mid">
                  <FileGlyph />
                  <span className="max-w-[200px] truncate">{f.filename}</span>
                  <span className="font-mono text-[10px] text-ink-faint">{kb(f.size)}</span>
                  <button type="button" aria-label={`Remove ${f.filename}`}
                          onClick={() => setFiles(files.filter((_, j) => j !== i))}
                          className="text-ink-faint transition hover:text-deny">×</button>
                </span>
              ))}
            </div>
          )}

          <textarea
            ref={taRef}
            rows={1}
            value={value}
            onChange={(e) => { setValue(e.target.value); grow(); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
            placeholder="Describe your request…"
            className="max-h-[220px] min-h-[40px] w-full resize-none bg-transparent px-1.5 py-1.5
                       text-[14.5px] leading-relaxed outline-none placeholder:text-ink-faint"
          />

          {/* Control rail — attach + target pill on the left, dispatch on the right */}
          <div className="mt-1 flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy || files.length >= MAX_FILES}
                title="Attach text files — inspected on-prem together with the prompt"
                aria-label="Attach files"
                className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-line
                           bg-base text-ink-dim transition hover:border-ink-faint hover:text-ink
                           disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg viewBox="0 0 16 16" className="h-[14px] w-[14px]" aria-hidden>
                  <path d="M13.5 7.5 8 13a3.5 3.5 0 0 1-5-5l6-6a2.3 2.3 0 0 1 3.3 3.3L6.4 11.2a1.2 1.2 0 0 1-1.7-1.7L10 4.2"
                        fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <input ref={fileRef} type="file" multiple hidden accept={ACCEPT}
                     onChange={(e) => addFiles(e.target.files)} />
              <ProjectPicker
                projects={projects}
                value={projectId}
                onChange={onProjectChange}
                locked={projectLocked}
              />
              <EnvSelector
                value={preferred}
                onChange={onPreferredChange}
                clearance={clearance}
                seal={seal}
              />
            </div>

            {busy ? (
              <button
                type="button"
                onClick={onStop}
                className="shrink-0 rounded-full border border-line px-3 py-1.5 font-mono
                           text-[11px] tracking-[0.10em] text-ink-mid transition
                           hover:border-deny hover:text-deny"
              >
                STOP
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!value.trim() && !files.length}
                className="shrink-0 rounded-full bg-cloud px-4 py-1.5 font-mono text-[11px]
                           font-semibold tracking-[0.10em] text-white transition
                           hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-30"
              >
                SEND
              </button>
            )}
          </div>
        </div>

        {fileError && <p className="mt-1.5 text-[11.5px] text-deny">{fileError}</p>}

        <p className="mt-2 text-center text-[11px] text-ink-dim">
          Requests and attachments are classified before dispatch. Decisions are logged to the audit ledger.
        </p>
      </div>
    </div>
  );
}

function FileGlyph() {
  return (
    <svg viewBox="0 0 12 14" className="h-[12px] w-[10px] shrink-0 text-ink-faint" aria-hidden>
      <path d="M2 1h5l3 3v9H2z" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M7 1v3h3" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}
