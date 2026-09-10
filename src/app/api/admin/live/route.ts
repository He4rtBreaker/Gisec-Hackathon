import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { livePayload } from "@/lib/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Polled by the topology: environment load plus routing decisions since `since`. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Admin role required." }, { status: 403 });
  }
  const since = Number(new URL(req.url).searchParams.get("since")) || Date.now();
  return NextResponse.json(livePayload(since), { headers: { "cache-control": "no-store" } });
}
