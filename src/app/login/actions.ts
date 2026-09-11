"use server";

import { redirect } from "next/navigation";
import { authenticate, createSession } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

export interface LoginState {
  error?: string;
}

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");

  if (!email || !password) return { error: "Enter both an identity and a passphrase." };

  const user = authenticate(email, password);
  if (!user) {
    writeAudit({ actor: email, kind: "auth.denied", subject: email, summary: "Failed authentication attempt" });
    return { error: "Identity not recognised, or passphrase incorrect." };
  }

  await createSession(user);
  writeAudit({
    actor: user.email, kind: "auth.granted", subject: user.id,
    summary: `${user.name} signed in · clearance ${user.clearance}`,
    detail: { role: user.role, org: user.org },
  });

  redirect(user.role === "admin" ? "/admin" : "/chat");
}
