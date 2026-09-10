import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listConversations } from "@/lib/conversations";
import Sidebar from "./Sidebar";
import AdminNav from "./admin/AdminNav";
import SidebarToggle from "./nav/SidebarToggle";

/**
 * Left column and content area shared by chat and projects.
 * Admins keep the console's column, so their navigation stays consistent.
 */
export default async function WorkspaceShell({ children }: { children: React.ReactNode }) {
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
      {user.role === "admin" ? (
        <AdminNav user={{ name: user.name, clearance: user.clearance }} conversations={conversations} />
      ) : (
        <Sidebar user={user} conversations={conversations} />
      )}
      <SidebarToggle placement="rail" />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
