import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listConversations } from "@/lib/conversations";
import AdminNav from "@/components/admin/AdminNav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/chat");

  const conversations = listConversations(user.id).map((c) => ({
    id: c.id, title: c.title, sealLevel: c.seal_level, updatedAt: c.updated_at,
  }));

  return (
    <div className="flex h-screen overflow-hidden">
      <AdminNav user={{ name: user.name, clearance: user.clearance }} conversations={conversations} />
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
