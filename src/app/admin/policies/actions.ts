"use server";

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import { PolicyError, deletePolicy, savePolicy, togglePolicy } from "@/lib/policies";
import { evaluate, type RoutingDecision } from "@/lib/policy/engine";
import { LEVELS, type EnvKey, type Level } from "@/lib/domain";
import type { Signal } from "@/lib/classify";

export type SaveResult = { ok: boolean; message: string } | null;
export type SimResult = { decision: RoutingDecision } | { error: string } | null;

async function admin() {
  const user = await currentUser();
  return user && user.role === "admin" ? user : null;
}

export async function savePolicyAction(_prev: SaveResult, fd: FormData): Promise<SaveResult> {
  const user = await admin();
  if (!user) return { ok: false, message: "Admin role required." };
  try {
    savePolicy(user.email, {
      id: String(fd.get("id") ?? "") || undefined,
      name: String(fd.get("name") ?? ""),
      description: String(fd.get("description") ?? ""),
      priority: Number(fd.get("priority")),
      action: String(fd.get("action") ?? ""),
      envKey: String(fd.get("envKey") ?? ""),
      ctype: String(fd.get("ctype") ?? ""),
      levels: fd.getAll("levels").map(String),
      minLevel: String(fd.get("minLevel") ?? ""),
      signals: fd.getAll("signals").map(String),
    });
    revalidatePath("/admin/policies");
    return { ok: true, message: "Rule saved." };
  } catch (err) {
    if (err instanceof PolicyError) return { ok: false, message: err.message };
    throw err;
  }
}

export async function togglePolicyAction(fd: FormData): Promise<void> {
  const user = await admin();
  if (!user) return;
  togglePolicy(user.email, String(fd.get("id")));
  revalidatePath("/admin/policies");
}

export async function deletePolicyAction(fd: FormData): Promise<void> {
  const user = await admin();
  if (!user) return;
  deletePolicy(user.email, String(fd.get("id")));
  revalidatePath("/admin/policies");
}

/** Dry-run the live policy set against a hypothetical request. Nothing is dispatched or logged. */
export async function simulateAction(_prev: SimResult, fd: FormData): Promise<SimResult> {
  if (!(await admin())) return { error: "Admin role required." };
  const level = String(fd.get("level")) as Level;
  const clearance = String(fd.get("clearance")) as Level;
  if (!LEVELS.includes(level) || !LEVELS.includes(clearance)) return { error: "Pick a level and a clearance." };

  const pinned = String(fd.get("pinned") ?? "auto");
  // The engine only reads signal codes.
  const signals = fd.getAll("signals").map((code) => ({
    code: String(code), label: String(code), level: "PUBLIC", count: 1, sample: "",
  })) as unknown as Signal[];

  return {
    decision: evaluate({
      level, clearance, signals,
      pinned: pinned === "auto" ? null : (pinned as EnvKey),
    }),
  };
}
