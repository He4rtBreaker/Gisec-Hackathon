import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { runRequest, sanitizeAttachments } from "@/lib/pipeline";
import type { EnvKey } from "@/lib/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  conversationId?: string;
  content?: string;
  /** User's stated environment preference; policy decides whether it is honoured. */
  preferred?: EnvKey | "auto";
  attachments?: unknown;
  /** Project to draw knowledge from; ownership is checked in the pipeline. */
  projectId?: string | null;
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = (await req.json()) as Body;
  const attachments = sanitizeAttachments(body.attachments);
  const content = (body.content ?? "").trim() || (attachments.length ? "Review the attached file." : "");
  if (!content) return NextResponse.json({ error: "empty request" }, { status: 400 });

  const encoder = new TextEncoder();
  const abort = new AbortController();
  let closed = false;

  const stream = new ReadableStream({
    async start(ctrl) {
      const emit = (e: object) => {
        if (closed) return;
        try {
          ctrl.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          closed = true;
        }
      };
      try {
        await runRequest({
          user,
          conversationId: body.conversationId,
          content,
          preferred: body.preferred,
          attachments,
          projectId: typeof body.projectId === "string" ? body.projectId : null,
          signal: abort.signal,
        }, emit);
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        if (!closed) {
          closed = true;
          try { ctrl.close(); } catch { /* already closed */ }
        }
      }
    },
    // The client went away (STOP, navigation). Stop generating in the environment.
    cancel() {
      closed = true;
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  });
}
