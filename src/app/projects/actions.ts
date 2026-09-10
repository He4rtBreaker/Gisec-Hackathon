"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import {
  ProjectError, addProjectFile, createProject, deleteProject, deleteProjectFile, updateProject,
} from "@/lib/projects";
import type { Level } from "@/lib/domain";

export type ProjectResult = { ok: boolean; message: string } | null;
export type UploadResult = { ok: boolean; message: string; level?: Level };

async function me() {
  const user = await currentUser();
  if (!user) throw new Error("Not signed in.");
  return user;
}

export async function createProjectAction(_prev: ProjectResult, fd: FormData): Promise<ProjectResult> {
  const user = await me();
  let pid: string;
  try {
    pid = createProject(user, {
      name: String(fd.get("name") ?? ""),
      description: String(fd.get("description") ?? ""),
    });
  } catch (err) {
    if (err instanceof ProjectError) return { ok: false, message: err.message };
    throw err;
  }
  revalidatePath("/projects");
  redirect(`/projects/${pid}`);
}

/** Updates whichever of name, description and instructions the form carries. */
export async function updateProjectAction(_prev: ProjectResult, fd: FormData): Promise<ProjectResult> {
  const user = await me();
  const projectId = String(fd.get("projectId") ?? "");
  const field = (k: string) => (fd.has(k) ? String(fd.get(k) ?? "") : undefined);
  try {
    updateProject(user, projectId, {
      name: field("name"), description: field("description"), instructions: field("instructions"),
    });
  } catch (err) {
    if (err instanceof ProjectError) return { ok: false, message: err.message };
    throw err;
  }
  revalidatePath(`/projects/${projectId}`);
  return { ok: true, message: "Saved." };
}

export async function deleteProjectAction(fd: FormData): Promise<void> {
  const user = await me();
  deleteProject(user, String(fd.get("projectId") ?? ""));
  revalidatePath("/projects");
  redirect("/projects");
}

/** One file per call keeps each request well under the server-action body limit. */
export async function uploadProjectFileAction(
  projectId: string, file: { filename: string; mime: string; text: string },
): Promise<UploadResult> {
  const user = await me();
  try {
    const r = await addProjectFile(user, projectId, file);
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, message: `Classified ${r.level}`, level: r.level };
  } catch (err) {
    if (err instanceof ProjectError) return { ok: false, message: err.message };
    throw err;
  }
}

export async function deleteProjectFileAction(fd: FormData): Promise<void> {
  const user = await me();
  const projectId = deleteProjectFile(user, String(fd.get("fileId") ?? ""));
  if (projectId) revalidatePath(`/projects/${projectId}`);
}
