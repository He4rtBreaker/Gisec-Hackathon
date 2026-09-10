import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect(user.role === "admin" ? "/admin" : "/chat");

  return (
    <main className="min-h-screen grid lg:grid-cols-[1.05fr_1fr]">
      {/* Left — identity brief */}
      <section className="relative hidden lg:flex flex-col justify-between p-12 border-r border-line overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle at 22% 18%, oklch(0.55 0.15 250 / 0.07), transparent 42%)," +
              "radial-gradient(circle at 78% 72%, oklch(0.50 0.18 300 / 0.06), transparent 45%)," +
              "linear-gradient(oklch(0.55 0.02 260 / 0.06) 1px, transparent 1px)," +
              "linear-gradient(90deg, oklch(0.55 0.02 260 / 0.06) 1px, transparent 1px)",
            backgroundSize: "100% 100%, 100% 100%, 44px 44px, 44px 44px",
          }}
        />
        <div className="relative">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[22px] font-semibold tracking-[0.30em] text-ink">MIZAN</span>
            <span className="mz-label">Hybrid Deployment Orchestrator</span>
          </div>
          <p className="mt-8 max-w-md text-[15px] leading-relaxed text-ink-mid">
            One assistant. Three environments. Every request is inspected on sovereign
            infrastructure <em className="text-ink not-italic">before</em> it is allowed to move.
          </p>
        </div>

        <div className="relative space-y-3">
          {[
            { k: "cloud",  n: "Public Cloud",       d: "Elastic · external egress · $0.31/1k", c: "text-cloud",  b: "bg-cloud" },
            { k: "onprem", n: "Sovereign On-Prem",  d: "Abu Dhabi DC-1 · fixed capacity",      c: "text-onprem", b: "bg-onprem" },
            { k: "airgap", n: "Air-Gapped Enclave", d: "Facility K · no outbound network",     c: "text-airgap", b: "bg-airgap" },
          ].map((e) => (
            <div key={e.k} className="mz-panel flex items-center gap-4 px-4 py-3">
              <span className={`h-2 w-2 rounded-full ${e.b}`} />
              <div className="min-w-0">
                <div className={`font-mono text-[11px] tracking-[0.12em] ${e.c}`}>{e.n.toUpperCase()}</div>
                <div className="text-[12px] text-ink-dim">{e.d}</div>
              </div>
            </div>
          ))}
        </div>

        <p className="relative mz-label">Authorised personnel only · all sessions are logged</p>
      </section>

      {/* Right — credential entry */}
      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-[380px]">
          <div className="lg:hidden mb-10 flex items-baseline gap-3">
            <span className="font-mono text-[20px] font-semibold tracking-[0.30em]">MIZAN</span>
            <span className="mz-label">Orchestrator</span>
          </div>

          <h1 className="text-[26px] font-semibold tracking-tight">Sign in</h1>
          <p className="mt-2 text-[13px] text-ink-dim">
            Your clearance determines which environments you may reach.
          </p>

          <LoginForm />

          <div className="mt-10 border-t border-line-soft pt-5">
            <div className="mz-label mb-3">Demo identities</div>
            <div className="space-y-1.5 font-mono text-[11px] text-ink-dim">
              <div className="flex justify-between gap-4">
                <span className="text-ink-mid">admin@mizan.gov.ae</span><span>admin123 · admin</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-ink-mid">analyst@mizan.gov.ae</span><span>user123 · confidential</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-ink-mid">defence@mizan.gov.ae</span><span>user123 · secret</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-ink-mid">public@mizan.gov.ae</span><span>user123 · official</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
