import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import ChatView from "@/components/ChatView";

export default async function NewChatPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <ChatView
      conversationId={null}
      initialMessages={[]}
      sealLevel="PUBLIC"
      clearance={user.clearance}
    />
  );
}
