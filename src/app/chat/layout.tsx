import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listConversations } from "@/lib/conversations";
import Sidebar from "@/components/Sidebar";

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");

  const conversations = listConversations(user.id).map((c) => ({
    id: c.id,
    title: c.title,
    sealLevel: c.seal_level,
    updatedAt: c.updated_at,
  }));

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar user={user} conversations={conversations} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
