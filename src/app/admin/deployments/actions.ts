"use server";

import { revalidatePath } from "next/cache";
import { currentUser } from "@/lib/auth";
import {
  DeployError, activate, diodeExport, diodeTransfer, diodeVerify, registerArtefact,
} from "@/lib/deployments";
import type { EnvKey } from "@/lib/domain";

export type ActionResult = { ok: boolean; message: string } | null;

/** Physical steps take time; a short pause keeps the demo honest about that. */
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run(fn: (actor: string) => string | Promise<string>): Promise<ActionResult> {
  const user = await currentUser();
  if (!user || user.role !== "admin") return { ok: false, message: "Admin role required." };
  try {
    const message = await fn(user.email);
    revalidatePath("/admin/deployments");
    return { ok: true, message };
  } catch (err) {
    if (err instanceof DeployError) return { ok: false, message: err.message };
    throw err;
  }
}

export async function deployAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const op = String(fd.get("op"));
  const artefactId = String(fd.get("artefactId"));
  const env = String(fd.get("env")) as EnvKey;

  return run(async (actor) => {
    switch (op) {
      case "activate": await pause(700);  return activate(actor, artefactId, env);
      case "export":   await pause(800);  return diodeExport(actor, artefactId);
      case "transfer": await pause(1200); return diodeTransfer(actor, artefactId);
      case "verify":   await pause(1000); return diodeVerify(actor, artefactId);
      default: throw new DeployError(`Unknown operation "${op}".`);
    }
  });
}

export async function registerAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run((actor) =>
    registerArtefact(actor, String(fd.get("version") ?? ""), String(fd.get("notes") ?? "")));
}
