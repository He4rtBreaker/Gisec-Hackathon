import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import AdminNav from "@/components/admin/AdminNav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/chat");

  return (
    <div className="flex h-screen overflow-hidden">
      <AdminNav user={{ name: user.name, clearance: user.clearance }} />
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
