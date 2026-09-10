"use server";

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { getSimLoad, setEnvStatus, setSimLoad, type EnvStatus } from "@/lib/environments";
import { verifyChain, type ChainReport } from "@/lib/audit";
import { userHistory, type UserHistory } from "@/lib/users";
import type { EnvKey } from "@/lib/domain";

async function requireAdmin() {
  const user = await currentUser();
  if (!user || user.role !== "admin") throw new Error("Admin role required.");
  return user;
}

export async function setEnvStatusAction(env: EnvKey, status: EnvStatus): Promise<void> {
  const user = await requireAdmin();
  setEnvStatus(user.email, env, status);
  revalidatePath("/admin");
}

export async function adjustLoadAction(env: EnvKey, delta: number): Promise<void> {
  const user = await requireAdmin();
  setSimLoad(user.email, env, getSimLoad(env).simLoad + delta);
  revalidatePath("/admin");
}

export async function userHistoryAction(userId: string): Promise<UserHistory | null> {
  await requireAdmin();
  return userHistory(userId);
}

export async function verifyChainAction(_prev: ChainReport | null, _fd: FormData): Promise<ChainReport | null> {
  await requireAdmin();
  return verifyChain();
}
