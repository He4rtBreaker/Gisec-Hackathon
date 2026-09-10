import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { projectOptions } from "@/lib/projects";
import ChatView from "@/components/ChatView";

export default async function NewChatPage({
  searchParams,
}: { searchParams: Promise<{ project?: string; q?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const { project, q } = await searchParams;
  const projects = projectOptions(user.id);
  const projectId = project && projects.some((p) => p.id === project) ? project : null;
  const initialPrompt = q?.trim().slice(0, 4000) || undefined;

  return (
    <ChatView
      key={`${projectId ?? "none"}:${initialPrompt ?? ""}`}
      conversationId={null}
      initialMessages={[]}
      sealLevel="PUBLIC"
      clearance={user.clearance}
      projects={projects}
      projectId={projectId}
      projectLocked={false}
      initialPrompt={initialPrompt}
    />
  );
}
