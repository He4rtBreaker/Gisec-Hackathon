import { NextResponse } from "next/server";
import { currentUser, destroySession } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export async function POST(req: Request) {
  const user = await currentUser();
  if (user) {
    writeAudit({ actor: user.email, kind: "auth.signout", subject: user.id, summary: `${user.name} signed out` });
  }
  await destroySession();
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
