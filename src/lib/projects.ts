import { db, id, now } from "./db";
import { writeAudit } from "./audit";
import { classify, type Classification, type Signal } from "./classify";
import { LEVEL_RANK, LEVELS, maxLevel, type Level } from "./domain";

/**
 * Projects: per-user knowledge bases that can be attached to a chat.
 *
 * - Every file is classified on upload by the same on-prem inspector as chat
 *   requests. A file above the uploader's clearance, or holding credentials,
 *   is refused. Excerpts inherit their file's classification, so a chat that
 *   draws on Confidential knowledge is sealed Confidential.
 * - A small project goes into context whole, as Claude projects do. A larger
 *   one is chunked, and each request retrieves the most relevant excerpts with
 *   BM25 — inside the boundary, before anything is dispatched.
 */

export const MAX_FILE_CHARS = 200_000;
export const MAX_FILES_PER_PROJECT = 25;
/** Up to this much text, the whole project is placed in context. */
export const FULL_CONTEXT_CHARS = 8_000;
const RETRIEVAL_BUDGET_CHARS = 6_000;
const RETRIEVAL_TOP_K = 6;
const CHUNK_SIZE = 1_200;
const CHUNK_OVERLAP = 200;

export class ProjectError extends Error {}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  instructions: string;
  createdAt: number;
  updatedAt: number;
  files: number;
  chars: number;
  /** Highest classification among its files. */
  level: Level | null;
  chats: number;
}

export interface ProjectFile {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  chars: number;
  level: Level;
  signals: Signal[];
  rationale: string;
  createdAt: number;
}

export interface ProjectOption {
  id: string;
  name: string;
  files: number;
  level: Level | null;
}

export interface ContextChunk {
  fileId: string;
  filename: string;
  part: number;
  text: string;
  level: Level;
}

export interface ProjectContext {
  project: { id: string; name: string; instructions: string };
  mode: "full" | "retrieval";
  chunks: ContextChunk[];
  files: Array<{ id: string; filename: string; level: Level; signals: Signal[] }>;
}

/** What is shown to the user and stored with the classification. */
export interface ContextSummary {
  projectId: string;
  project: string;
  mode: "full" | "retrieval";
  excerpts: Array<{ filename: string; part: number; level: Level }>;
}

type Actor = { id: string; email: string; clearance: Level };

const rankSql = (col: string) =>
  `CASE ${col} WHEN 'SECRET' THEN 3 WHEN 'CONFIDENTIAL' THEN 2 WHEN 'OFFICIAL' THEN 1 ELSE 0 END`;

/* ---- reads ------------------------------------------------------------- */

export function listProjects(userId: string): ProjectSummary[] {
  const rows = db().prepare(
    `SELECT p.id, p.name, p.description, p.instructions,
            p.created_at AS createdAt, p.updated_at AS updatedAt,
            (SELECT COUNT(*) FROM project_files f WHERE f.project_id = p.id) AS files,
            (SELECT COALESCE(SUM(LENGTH(f.content_text)), 0) FROM project_files f WHERE f.project_id = p.id) AS chars,
            (SELECT MAX(${rankSql("f.level")}) FROM project_files f WHERE f.project_id = p.id) AS levelRank,
            (SELECT COUNT(*) FROM conversations c WHERE c.project_id = p.id) AS chats
       FROM projects p WHERE p.user_id = ? ORDER BY p.updated_at DESC`
  ).all(userId) as Array<Omit<ProjectSummary, "level"> & { levelRank: number | null }>;
  return rows.map(({ levelRank, ...r }) => ({ ...r, level: levelRank == null ? null : LEVELS[levelRank] }));
}

export function getProject(userId: string, projectId: string): ProjectSummary | null {
  return listProjects(userId).find((p) => p.id === projectId) ?? null;
}

export function projectOptions(userId: string): ProjectOption[] {
  return listProjects(userId).map(({ id: pid, name, files, level }) => ({ id: pid, name, files, level }));
}

export function ownsProject(userId: string, projectId: string): boolean {
  return !!db().prepare(`SELECT 1 FROM projects WHERE id = ? AND user_id = ?`).get(projectId, userId);
}

export function listProjectFiles(projectId: string): ProjectFile[] {
  const rows = db().prepare(
    `SELECT id, filename, mime, size_bytes AS sizeBytes, LENGTH(content_text) AS chars, level,
            signals_json, rationale, created_at AS createdAt
       FROM project_files WHERE project_id = ? ORDER BY created_at DESC`
  ).all(projectId) as Array<Omit<ProjectFile, "signals"> & { signals_json: string }>;
  return rows.map(({ signals_json, ...r }) => ({ ...r, signals: JSON.parse(signals_json) as Signal[] }));
}

export function listProjectChats(projectId: string): Array<{ id: string; title: string; sealLevel: Level; updatedAt: number }> {
  return db().prepare(
    `SELECT id, title, seal_level AS sealLevel, updated_at AS updatedAt
       FROM conversations WHERE project_id = ? ORDER BY updated_at DESC`
  ).all(projectId) as Array<{ id: string; title: string; sealLevel: Level; updatedAt: number }>;
}

/* ---- writes ------------------------------------------------------------ */

export function createProject(actor: Actor, input: { name: string; description: string }): string {
  const name = input.name.trim().slice(0, 80);
  if (name.length < 2) throw new ProjectError("Give the project a name.");
  const description = input.description.trim().slice(0, 500);

  const pid = id("prj");
  const t = now();
  db().prepare(
    `INSERT INTO projects (id, user_id, name, description, instructions, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', ?, ?)`
  ).run(pid, actor.id, name, description, t, t);
  writeAudit({ actor: actor.email, kind: "project.created", subject: pid, summary: `Project "${name}" created` });
  return pid;
}

export function updateProject(
  actor: Actor, projectId: string,
  input: { name?: string; description?: string; instructions?: string },
): void {
  if (!ownsProject(actor.id, projectId)) throw new ProjectError("Project not found.");
  const sets: string[] = [];
  const args: unknown[] = [];

  if (input.name !== undefined) {
    const name = input.name.trim().slice(0, 80);
    if (name.length < 2) throw new ProjectError("Give the project a name.");
    sets.push("name = ?"); args.push(name);
  }
  if (input.description !== undefined) {
    sets.push("description = ?"); args.push(input.description.trim().slice(0, 500));
  }
  if (input.instructions !== undefined) {
    if (input.instructions.length > 4000) throw new ProjectError("Instructions are limited to 4,000 characters.");
    sets.push("instructions = ?"); args.push(input.instructions.trim());
  }
  if (!sets.length) return;

  db().prepare(`UPDATE projects SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).run(...args, now(), projectId);
  writeAudit({
    actor: actor.email, kind: "project.updated", subject: projectId,
    summary: `Project updated (${Object.entries(input).filter(([, v]) => v !== undefined).map(([k]) => k).join(", ")})`,
  });
}

export function deleteProject(actor: Actor, projectId: string): void {
  const row = db().prepare(`SELECT name FROM projects WHERE id = ? AND user_id = ?`)
    .get(projectId, actor.id) as { name: string } | undefined;
  if (!row) return;
  db().transaction(() => {
    // Threads keep their history and their seal; they simply stop drawing on the project.
    db().prepare(`UPDATE conversations SET project_id = NULL WHERE project_id = ?`).run(projectId);
    db().prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
  })();
  writeAudit({ actor: actor.email, kind: "project.deleted", subject: projectId, summary: `Project "${row.name}" deleted` });
}

export async function addProjectFile(
  actor: Actor, projectId: string, file: { filename: string; mime: string; text: string },
): Promise<{ filename: string; level: Level }> {
  const project = db().prepare(`SELECT name FROM projects WHERE id = ? AND user_id = ?`)
    .get(projectId, actor.id) as { name: string } | undefined;
  if (!project) throw new ProjectError("Project not found.");

  const filename = file.filename.trim().slice(0, 120) || "untitled.txt";
  const text = file.text;
  if (!text.trim()) throw new ProjectError(`${filename} is empty.`);
  if (text.length > MAX_FILE_CHARS) throw new ProjectError(`${filename} is larger than 200 KB of text.`);
  if (text.includes("\u0000")) throw new ProjectError(`${filename} looks like a binary file.`);

  const count = (db().prepare(`SELECT COUNT(*) AS n FROM project_files WHERE project_id = ?`)
    .get(projectId) as { n: number }).n;
  if (count >= MAX_FILES_PER_PROJECT) throw new ProjectError(`A project holds up to ${MAX_FILES_PER_PROJECT} files.`);

  // Classified on-prem before it is stored, exactly like a chat request.
  const cls = await classify({ prompt: `Project knowledge file "${filename}".`, attachments: [{ filename, text }] });
  const codes = cls.signals.map((s) => s.code);

  const reject = (reason: string) => {
    writeAudit({
      actor: actor.email, kind: "project.file_rejected", subject: projectId,
      summary: `${filename} rejected from "${project.name}" — ${reason}`,
      detail: { filename, level: cls.level, signals: codes },
    });
    return new ProjectError(`${filename} was not added: ${reason}`);
  };
  if (codes.includes("CREDENTIAL")) {
    throw reject("it contains credential material (keys or tokens). Remove them and upload again.");
  }
  if (LEVEL_RANK[cls.level] > LEVEL_RANK[actor.clearance]) {
    throw reject(`it is classified ${cls.level}, above your ${actor.clearance} clearance.`);
  }

  const fileId = id("pf");
  const chunks = chunkText(text);
  const nameTokens = tokenize(filename.replace(/\.[a-z0-9]+$/i, ""));

  db().transaction(() => {
    db().prepare(
      `INSERT INTO project_files (id, project_id, filename, mime, size_bytes, content_text, level, signals_json, rationale, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(fileId, projectId, filename, file.mime || "text/plain", Buffer.byteLength(text), text,
          cls.level, JSON.stringify(cls.signals), cls.rationale, now());
    const ins = db().prepare(
      `INSERT INTO project_chunks (id, file_id, project_id, seq, text, tokens_json) VALUES (?, ?, ?, ?, ?, ?)`
    );
    chunks.forEach((c, i) => {
      ins.run(id("chk"), fileId, projectId, i, c, JSON.stringify(termFreq([...tokenize(c), ...nameTokens])));
    });
    db().prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(now(), projectId);
  })();

  writeAudit({
    actor: actor.email, kind: "project.file_added", subject: projectId,
    summary: `${filename} added to "${project.name}" · classified ${cls.level}`,
    detail: { filename, level: cls.level, signals: codes, chunks: chunks.length, chars: text.length },
  });
  return { filename, level: cls.level };
}

export function deleteProjectFile(actor: Actor, fileId: string): string | null {
  const row = db().prepare(
    `SELECT f.filename, f.project_id AS projectId, p.name FROM project_files f
       JOIN projects p ON p.id = f.project_id WHERE f.id = ? AND p.user_id = ?`
  ).get(fileId, actor.id) as { filename: string; projectId: string; name: string } | undefined;
  if (!row) return null;
  db().prepare(`DELETE FROM project_files WHERE id = ?`).run(fileId);
  db().prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(now(), row.projectId);
  writeAudit({
    actor: actor.email, kind: "project.file_removed", subject: row.projectId,
    summary: `${row.filename} removed from "${row.name}"`,
  });
  return row.projectId;
}

/* ---- retrieval ---------------------------------------------------------- */

const STOP = new Set(
  ("a an and are as at be but by for from has have in is it its of on or that the this to was were will with " +
   "you your i we our they their what which who how can do does please about into than then there these those " +
   "not no yes me my us all any also if so just").split(" "),
);

export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1 && !STOP.has(t));
}

function termFreq(tokens: string[]): Record<string, number> {
  const tf: Record<string, number> = {};
  for (const t of tokens) tf[t] = (tf[t] ?? 0) + 1;
  return tf;
}

/** Split text into overlapping chunks, preferring paragraph and sentence breaks. */
export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length <= CHUNK_SIZE) return clean ? [clean] : [];
  const out: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + CHUNK_SIZE);
    if (end < clean.length) {
      const slice = clean.slice(start, end);
      const brk = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"), slice.lastIndexOf(". "));
      if (brk > CHUNK_SIZE * 0.5) end = start + brk + 1;
    }
    out.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return out.filter(Boolean);
}

/** Select the project knowledge that will accompany a request. */
export function retrieve(projectId: string, query: string): ProjectContext | null {
  const project = db().prepare(`SELECT id, name, instructions FROM projects WHERE id = ?`)
    .get(projectId) as ProjectContext["project"] | undefined;
  if (!project) return null;

  const fileRows = db().prepare(
    `SELECT id, filename, level, signals_json, content_text FROM project_files
      WHERE project_id = ? ORDER BY created_at`
  ).all(projectId) as Array<{ id: string; filename: string; level: Level; signals_json: string; content_text: string }>;
  if (!fileRows.length) return { project, mode: "full", chunks: [], files: [] };

  const meta = new Map(fileRows.map((f) => [f.id, {
    id: f.id, filename: f.filename, level: f.level, signals: JSON.parse(f.signals_json) as Signal[],
  }]));

  // Small enough to read in full — no retrieval needed.
  const total = fileRows.reduce((a, f) => a + f.content_text.length, 0);
  if (total <= FULL_CONTEXT_CHARS) {
    return {
      project, mode: "full",
      chunks: fileRows.map((f) => ({ fileId: f.id, filename: f.filename, part: 1, text: f.content_text, level: f.level })),
      files: [...meta.values()],
    };
  }

  // BM25 over the chunk index.
  const docs = (db().prepare(
    `SELECT file_id AS fileId, seq, text, tokens_json FROM project_chunks WHERE project_id = ?`
  ).all(projectId) as Array<{ fileId: string; seq: number; text: string; tokens_json: string }>)
    .map((d) => ({ ...d, tf: JSON.parse(d.tokens_json) as Record<string, number> }));
  const lens = docs.map((d) => Object.values(d.tf).reduce((a, b) => a + b, 0));
  const avgdl = lens.reduce((a, b) => a + b, 0) / Math.max(1, docs.length);
  const terms = [...new Set(tokenize(query))];
  const N = docs.length;
  const K1 = 1.2;
  const B = 0.75;
  const idf = new Map(terms.map((t) => {
    const df = docs.filter((d) => d.tf[t]).length;
    return [t, Math.log(1 + (N - df + 0.5) / (df + 0.5))];
  }));

  const scored = docs
    .map((d, i) => ({
      d,
      score: terms.reduce((s, t) => {
        const f = d.tf[t] ?? 0;
        return f ? s + idf.get(t)! * (f * (K1 + 1)) / (f + K1 * (1 - B + (B * lens[i]) / avgdl)) : s;
      }, 0),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  // Nothing matched lexically (e.g. "summarise this project"): open each file instead.
  const ranked = scored.length ? scored.map((x) => x.d) : docs.filter((d) => d.seq === 0);

  const picked: typeof docs = [];
  let used = 0;
  for (const d of ranked) {
    if (picked.length >= RETRIEVAL_TOP_K) break;
    if (picked.length && used + d.text.length > RETRIEVAL_BUDGET_CHARS) continue;
    picked.push(d);
    used += d.text.length;
  }

  const chunks = picked.map((d) => {
    const f = meta.get(d.fileId)!;
    return { fileId: d.fileId, filename: f.filename, part: d.seq + 1, text: d.text, level: f.level };
  });
  const files = [...new Set(chunks.map((c) => c.fileId))].map((fid) => meta.get(fid)!);
  return { project, mode: "retrieval", chunks, files };
}

/** Knowledge excerpts inherit the classification their file received at upload. */
export function withProjectContext(cls: Classification, ctx: ProjectContext | null): Classification {
  if (!ctx || !ctx.files.length) return cls;
  const ctxLevel = ctx.files.reduce<Level>((a, f) => maxLevel(a, f.level), "PUBLIC");
  const level = maxLevel(cls.level, ctxLevel);

  const seen = new Set(cls.signals.map((s) => s.code));
  const extra: Signal[] = [];
  for (const s of ctx.files.flatMap((f) => f.signals)) {
    if (seen.has(s.code)) continue;
    seen.add(s.code);
    extra.push({ ...s, label: `${s.label} (project file)` });
  }

  return {
    ...cls,
    level,
    signals: [...cls.signals, ...extra],
    rationale: LEVEL_RANK[ctxLevel] > LEVEL_RANK[cls.level]
      ? `${cls.rationale} Project knowledge used for this answer is classified ${ctxLevel}, which governs.`
      : cls.rationale,
  };
}

export function summarizeContext(ctx: ProjectContext): ContextSummary {
  return {
    projectId: ctx.project.id,
    project: ctx.project.name,
    mode: ctx.mode,
    excerpts: ctx.chunks.map((c) => ({ filename: c.filename, part: c.part, level: c.level })),
  };
}

/** The knowledge block placed ahead of the user's request. */
export function knowledgeBlock(ctx: ProjectContext | null): string {
  if (!ctx?.chunks.length) return "";
  const intro = ctx.mode === "full"
    ? `Project knowledge — the complete files of project "${ctx.project.name}".`
    : `Project knowledge — the most relevant excerpts from project "${ctx.project.name}".`;
  const body = ctx.chunks
    .map((c) => `[${c.filename}${ctx.mode === "retrieval" ? ` · part ${c.part}` : ""}]\n${c.text}`)
    .join("\n\n");
  return `${intro} Use it when relevant and name the file you draw from.\n\n${body}\n\n---\nRequest:\n`;
}
