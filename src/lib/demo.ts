import { db } from "./db";
import { writeAudit } from "./audit";
import { runRequest, type PipelineUser, type RunResult } from "./pipeline";
import { getSimLoad, setSimLoad } from "./environments";
import type { EnvKey } from "./domain";

/**
 * Scripted demo sequence.
 *
 * Each scenario runs through the real pipeline as a seeded user — real
 * classification, real policy, real dispatch — so the topology, analytics and
 * audit ledger all move exactly as they would for live traffic.
 */

export interface DemoScenario {
  id: string;
  title: string;
  actor: string;
  expect: string;
  note: string;
  turns: Array<{ content: string; preferred?: EnvKey | "auto" }>;
  /** Fill on-prem to capacity for this scenario, then restore it. */
  saturateOnPrem?: boolean;
}

export const SCENARIOS: DemoScenario[] = [
  {
    id: "public", title: "Public question", actor: "public@mizan.gov.ae",
    expect: "PUBLIC → CLOUD",
    note: "Nothing sensitive — cheapest elastic capacity.",
    turns: [{ content: "What is the capital of the UAE? Answer in one sentence." }],
  },
  {
    id: "official", title: "Routine procurement", actor: "public@mizan.gov.ae",
    expect: "OFFICIAL → ON-PREM",
    note: "Government business stays on sovereign infrastructure by default.",
    turns: [{ content: "Draft a two-line note to the committee about tender PO-2291 for office supplies." }],
  },
  {
    id: "confidential", title: "Personal data", actor: "analyst@mizan.gov.ae",
    expect: "CONFIDENTIAL → ON-PREM",
    note: "Emirates ID and payroll detected by on-prem rules.",
    turns: [{ content: "Summarise in one line: employee Emirates ID 784-1990-1234567-1, monthly payroll AED 42,000." }],
  },
  {
    id: "secret", title: "Defence material", actor: "defence@mizan.gov.ae",
    expect: "SECRET → ENCLAVE",
    note: "Marked Secret — only the air-gapped enclave may execute it.",
    turns: [{ content: "SECRET // Summarise in one line: troop movements near the northern sector." }],
  },
  {
    id: "clearance", title: "Above clearance", actor: "analyst@mizan.gov.ae",
    expect: "REFUSED",
    note: "Same Secret request from a Confidential-cleared analyst.",
    turns: [{ content: "SECRET // Summarise in one line: troop movements near the northern sector." }],
  },
  {
    id: "credential", title: "Credential leak", actor: "defence@mizan.gov.ae",
    expect: "REFUSED",
    note: "Live API key in the prompt — refused in every environment.",
    turns: [{ content: "Why does this config fail? api_key = sk-live-8f3k2m9x7q1w5e4r" }],
  },
  {
    id: "downgrade", title: "Downgrade attempt", actor: "analyst@mizan.gov.ae",
    expect: "REFUSED",
    note: "Thread sealed Confidential, then a harmless follow-up pinned to Cloud.",
    turns: [
      { content: "Note for my records: Emirates ID 784-1985-7654321-2, salary AED 38,500." },
      { content: "Now give me one general tip on budgeting.", preferred: "cloud" },
    ],
  },
  {
    id: "capacity", title: "On-prem saturated", actor: "public@mizan.gov.ae",
    expect: "OFFICIAL → CLOUD",
    note: "On-prem slots filled; Official falls back to cloud by policy.",
    saturateOnPrem: true,
    turns: [{ content: "Draft a one-line reminder about the tender PO-3310 submission deadline." }],
  },
];

type Emit = (event: { type: string } & Record<string, unknown>) => void;

/** Keep generated answers short so the whole sequence runs in well under a minute. */
const DEMO_MAX_TOKENS = 80;

export async function runDemo(admin: string, emit: Emit): Promise<void> {
  writeAudit({
    actor: admin, kind: "demo.started",
    summary: `Scripted demo sequence started (${SCENARIOS.length} scenarios)`,
  });

  for (const s of SCENARIOS) {
    emit({ type: "scenario", id: s.id, status: "running" });

    const user = db().prepare(`SELECT id, email, clearance FROM users WHERE email = ?`)
      .get(s.actor) as PipelineUser | undefined;
    if (!user) {
      emit({ type: "scenario", id: s.id, status: "error", message: `${s.actor} not found — run npm run seed.` });
      continue;
    }

    const saved = s.saturateOnPrem ? getSimLoad("onprem") : null;
    const turns: RunResult[] = [];
    try {
      if (saved) setSimLoad(admin, "onprem", saved.capacity);
      let convId: string | null = null;
      for (const t of s.turns) {
        const r = await runRequest({
          user, conversationId: convId, content: t.content, preferred: t.preferred,
          title: `Demo · ${s.title}`, maxTokens: DEMO_MAX_TOKENS,
        }, () => {});
        convId = r.conversationId;
        turns.push(r);
      }
      emit({ type: "scenario", id: s.id, status: "done", result: turns[turns.length - 1], turns });
    } catch (err) {
      emit({ type: "scenario", id: s.id, status: "error",
             message: err instanceof Error ? err.message : String(err) });
    } finally {
      if (saved) setSimLoad(admin, "onprem", saved.simLoad);
    }
  }

  writeAudit({ actor: admin, kind: "demo.finished", summary: "Scripted demo sequence finished" });
  emit({ type: "finished" });
}
