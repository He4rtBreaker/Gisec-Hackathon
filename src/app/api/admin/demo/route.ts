import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { runDemo } from "@/lib/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const g = globalThis as unknown as { __mizanDemoRunning?: boolean };

/** Runs the scripted sequence and streams per-scenario progress as NDJSON. */
export async function POST() {
  const user = await currentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Admin role required." }, { status: 403 });
  }
  if (g.__mizanDemoRunning) {
    return NextResponse.json({ error: "A demo sequence is already running." }, { status: 409 });
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(ctrl) {
      const emit = (e: object) => {
        if (closed) return;
        try { ctrl.enqueue(encoder.encode(JSON.stringify(e) + "\n")); } catch { closed = true; }
      };
      g.__mizanDemoRunning = true;
      try {
        await runDemo(user.email, emit);
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        g.__mizanDemoRunning = false;
        if (!closed) {
          closed = true;
          try { ctrl.close(); } catch { /* already closed */ }
        }
      }
    },
    // The sequence finishes server-side even if the viewer navigates away.
    cancel() { closed = true; },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  });
}
