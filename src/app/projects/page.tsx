import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listProjects } from "@/lib/projects";
import type { Level } from "@/lib/domain";
import NewProjectButton from "@/components/projects/NewProjectButton";

export const dynamic = "force-dynamic";

const LEVEL_CHIP: Record<Level, string> = {
  PUBLIC:       "border-cloud/35 bg-cloud-soft text-cloud",
  OFFICIAL:     "border-official/35 bg-official-soft text-official",
  CONFIDENTIAL: "border-onprem/35 bg-onprem-soft text-onprem",
  SECRET:       "border-airgap/35 bg-airgap-soft text-airgap",
};

function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default async function ProjectsPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const projects = listProjects(user.id);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[980px] space-y-6 px-8 py-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mz-label">Workspace</div>
            <h1 className="mt-1 text-[21px] font-semibold tracking-tight">Projects</h1>
            <p className="mt-1.5 max-w-[620px] text-[13px] leading-relaxed text-ink-dim">
              Group chats around shared knowledge. Files are classified on upload, and any chat
              that draws on them inherits that classification.
            </p>
          </div>
          <NewProjectButton />
        </header>

        {projects.length === 0 ? (
          <div className="mz-panel flex flex-col items-center px-6 py-14 text-center">
            <svg viewBox="0 0 16 14" className="h-7 w-8 text-ink-faint" aria-hidden>
              <path d="M1.5 3.2c0-.7.5-1.2 1.2-1.2h3.1l1.5 1.6h5.9c.7 0 1.2.5 1.2 1.2v6.5c0 .7-.5 1.2-1.2 1.2H2.7c-.7 0-1.2-.5-1.2-1.2z"
                    fill="none" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
            </svg>
            <p className="mt-3 text-[14px] text-ink-mid">No projects yet</p>
            <p className="mt-1 max-w-[380px] text-[12.5px] leading-relaxed text-ink-dim">
              Create a project, add documents, and select it in any chat to answer with that knowledge.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="mz-panel block p-4 transition hover:border-ink-faint
                           hover:shadow-[0_2px_10px_oklch(0.55_0.02_260/0.08)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 truncate text-[14px] font-medium">{p.name}</span>
                  {p.level && (
                    <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9.5px] tracking-[0.10em] ${LEVEL_CHIP[p.level]}`}>
                      {p.level}
                    </span>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 min-h-[36px] text-[12.5px] leading-snug text-ink-dim">
                  {p.description || "No description."}
                </p>
                <div className="mt-3 flex flex-wrap gap-x-3 font-mono text-[10.5px] text-ink-faint">
                  <span>{p.files} file{p.files === 1 ? "" : "s"}</span>
                  <span>{p.chats} chat{p.chats === 1 ? "" : "s"}</span>
                  <span>updated {ago(p.updatedAt)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
