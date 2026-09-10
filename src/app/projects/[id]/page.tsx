import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { FULL_CONTEXT_CHARS, getProject, listProjectChats, listProjectFiles } from "@/lib/projects";
import { ENV_META, envAccepts, type EnvKey, type Level } from "@/lib/domain";
import ProjectHeader from "@/components/projects/ProjectHeader";
import ProjectStart from "@/components/projects/ProjectStart";
import ProjectKnowledge from "@/components/projects/ProjectKnowledge";

export const dynamic = "force-dynamic";

const LEVEL_DOT: Record<Level, string> = {
  PUBLIC: "bg-cloud", OFFICIAL: "bg-official", CONFIDENTIAL: "bg-onprem", SECRET: "bg-airgap",
};

function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const project = getProject(user.id, id);
  if (!project) notFound();

  const files = listProjectFiles(project.id);
  const chats = listProjectChats(project.id);
  const envs: EnvKey[] = ["cloud", "onprem", "airgap"];
  const reach = envs.filter((e) => !project.level || envAccepts(e, project.level)).map((e) => ENV_META[e].name);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-[1120px] grid-cols-1 gap-8 px-8 py-8 lg:grid-cols-[minmax(0,1fr)_350px]">
        <div className="min-w-0 space-y-7">
          <div>
            <Link href="/projects" className="text-[12px] text-ink-dim transition hover:text-ink-mid">← All projects</Link>
            <ProjectHeader projectId={project.id} name={project.name} description={project.description} />
          </div>

          <ProjectStart projectId={project.id} projectName={project.name} />

          <section>
            <div className="mz-label mb-2">Chats in this project</div>
            {chats.length === 0 ? (
              <p className="text-[12.5px] text-ink-faint">No chats yet. Start one above.</p>
            ) : (
              <ul className="mz-panel divide-y divide-line-soft overflow-hidden">
                {chats.map((c) => (
                  <li key={c.id}>
                    <Link href={`/chat/${c.id}`}
                          className="flex items-center gap-3 px-4 py-3 transition hover:bg-surface">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${LEVEL_DOT[c.sealLevel]}`}
                            title={`Thread sealed at ${c.sealLevel}`} />
                      <span className="min-w-0 flex-1 truncate text-[13px]">{c.title}</span>
                      <span className="shrink-0 font-mono text-[10.5px] text-ink-faint">{ago(c.updatedAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <ProjectKnowledge
          projectId={project.id}
          instructions={project.instructions}
          files={files}
          chars={project.chars}
          fullLimit={FULL_CONTEXT_CHARS}
          level={project.level}
          reach={reach}
          clearance={user.clearance}
        />
      </div>
    </main>
  );
}
