import Link from "next/link";
import { AUDIT_GROUPS, chainHead, listAudit } from "@/lib/audit";
import ChainVerifier from "@/components/admin/ChainVerifier";

export const dynamic = "force-dynamic";

function stamp(ts: number): string {
  return new Date(ts).toLocaleString("en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

function kindTone(k: string): string {
  if (["auth.denied", "request.refused", "request.failed", "egress.blocked", "policy.deleted"].includes(k)) return "text-deny";
  if (["auth.granted", "request.routed", "deploy.activated"].includes(k)) return "text-ok";
  if (k.startsWith("diode.") || k.startsWith("artefact.")) return "text-airgap";
  if (k.startsWith("policy.")) return "text-official";
  if (k.startsWith("env.") || k.startsWith("demo.")) return "text-warn";
  return "text-ink-mid";
}

function pretty(json: string): string {
  try { return JSON.stringify(JSON.parse(json), null, 2); } catch { return json; }
}

export default async function AuditPage({
  searchParams,
}: { searchParams: Promise<{ group?: string; q?: string }> }) {
  const { group = "", q = "" } = await searchParams;
  const rows = listAudit({ group, q, limit: 250 });
  const head = chainHead();

  const href = (g: string) => {
    const p = new URLSearchParams();
    if (g) p.set("group", g);
    if (q) p.set("q", q);
    const s = p.toString();
    return `/admin/audit${s ? `?${s}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-[1180px] space-y-6 px-8 py-8">
      <header>
        <div className="mz-label">Audit ledger</div>
        <h1 className="mt-1 text-[21px] font-semibold tracking-tight">Every decision, with its justification</h1>
        <p className="mt-1.5 max-w-[700px] text-[13px] leading-relaxed text-ink-dim">
          Append-only and hash-chained. Each entry commits to its own content and to the entry before
          it, so editing, deleting or re-ordering any past entry breaks every link after it.
        </p>
      </header>

      {/* ---- integrity ------------------------------------------------- */}
      <section className="mz-panel flex flex-wrap items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <div className="mz-label">Chain head</div>
          <div className="mt-1 break-all font-mono text-[11.5px] text-ink-mid">{head.head}</div>
          <div className="mt-1 text-[12px] text-ink-dim">
            {head.count} entries · SHA-256 over (previous hash, id, time, actor, kind, subject, summary, detail)
          </div>
        </div>
        <ChainVerifier />
      </section>

      {/* ---- filters ---------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        {[["", "All"], ...Object.entries(AUDIT_GROUPS).map(([k, g]) => [k, g.label])].map(([k, label]) => (
          <Link key={k} href={href(k)}
                className={`rounded-full border px-3 py-1 text-[12px] transition
                  ${group === k ? "border-cloud bg-cloud-soft text-cloud" : "border-line text-ink-mid hover:border-ink-faint"}`}>
            {label}
          </Link>
        ))}
        <form method="get" className="ml-auto">
          {group && <input type="hidden" name="group" value={group} />}
          <input name="q" defaultValue={q} placeholder="Search actor, summary, kind…"
                 className="mz-field w-[280px] px-2.5 py-1.5 text-[12.5px]" />
        </form>
      </div>

      {/* ---- entries ---------------------------------------------------- */}
      <section className="mz-panel overflow-hidden">
        {rows.length === 0 ? (
          <p className="px-4 py-5 text-[12.5px] text-ink-faint">No entries match.</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[860px] divide-y divide-line-soft">
              {rows.map((r) => (
                <details key={r.id} className="group">
                  <summary className="grid cursor-pointer list-none grid-cols-[132px_190px_140px_1fr_14px] items-baseline
                                      gap-3 px-4 py-2 transition hover:bg-surface">
                    <span className="font-mono text-[10.5px] text-ink-faint">{stamp(r.ts)}</span>
                    <span className="truncate text-[12px] text-ink-mid">{r.actor}</span>
                    <span className={`font-mono text-[10.5px] ${kindTone(r.kind)}`}>{r.kind}</span>
                    <span className="truncate text-[12.5px]">{r.summary}</span>
                    <span className="text-[10px] text-ink-faint transition group-open:rotate-90">▸</span>
                  </summary>
                  <div className="grid grid-cols-1 gap-3 bg-surface px-4 pb-3 pt-1 md:grid-cols-[1fr_300px]">
                    <pre className="overflow-x-auto rounded-md border border-line-soft bg-overlay p-2.5 font-mono
                                    text-[10.5px] leading-relaxed text-ink-mid">{pretty(r.detail_json)}</pre>
                    <dl className="space-y-1 font-mono text-[10px]">
                      <div><dt className="text-ink-faint">subject</dt><dd className="break-all text-ink-mid">{r.subject || "—"}</dd></div>
                      <div><dt className="text-ink-faint">prev</dt><dd className="break-all text-ink-dim">{r.prev_hash}</dd></div>
                      <div><dt className="text-ink-faint">hash</dt><dd className="break-all text-ink-mid">{r.hash}</dd></div>
                    </dl>
                  </div>
                </details>
              ))}
            </div>
          </div>
        )}
      </section>
      {rows.length === 250 && (
        <p className="text-center text-[11.5px] text-ink-faint">Showing the latest 250 entries. Narrow with a filter or search.</p>
      )}
    </div>
  );
}
