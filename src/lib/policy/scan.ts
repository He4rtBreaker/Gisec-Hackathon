import { LEVEL_RANK, type Level } from "../domain";
import { getProvider } from "../llm/provider";
import { listPolicies } from "../policies";

/**
 * Reads a request against the policy set and says whether honouring it would
 * breach one.
 *
 * Deliberately a separate call from the classification adjudicator, on its own
 * binding. The two ask different questions — the adjudicator asks "how
 * sensitive is this", the scanner asks "does this break a rule we have
 * written down" — and keeping them apart means a policy change does not
 * require re-tuning the classifier, and a scanner outage cannot take
 * classification with it.
 *
 * It runs before anonymisation, on the text as written, because a rule about
 * personal data cannot be judged once the personal data has been replaced by
 * <PERSON_1>. That is also why the caller must not reach this with anything
 * above OFFICIAL: the scanner is a hosted model today, so the only material
 * it may see is material already cleared to leave. skipFor() is that gate and
 * the pipeline applies it before calling.
 */

export interface PolicyScan {
  /** False when the scanner believes a policy would be breached. */
  compatible: boolean;
  /** Names of the policies it believes are breached. */
  breached: string[];
  reason: string;
  /** Which model answered, for the ledger. */
  scanner: string;
  latencyMs: number;
  /** Set when no scan was performed, with why. Compatible is then true: a
   *  scan that did not happen is not a finding. */
  skipped?: "too-sensitive" | "unavailable";
}

/**
 * Material at or above Confidential never reaches the scanner, because the
 * scanner is off sovereign ground. Routing such a request on-prem afterwards
 * would not undo the call that already carried it out of the building.
 */
export function skipFor(level: Level): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK["CONFIDENTIAL"];
}

const SYSTEM = `You are the policy compliance scanner for a government AI platform.

You are given the platform's routing policies and one user request. Decide
whether sending that request onward would breach any of the listed policies.

Judge only what the request actually contains, not what it is about. Asking how
tender evaluation works breaches nothing; pasting a live tender's bid figures
may. A request breaches a policy only if the policy's own wording covers it.

Reply with JSON only, no prose:
{"compatible":<true|false>,"breached":["<exact policy name>"],"reason":"<one sentence, under 30 words>"}

"breached" lists exact names from the policy list, and is empty when compatible is true.`;

/** The rule set as the scanner sees it: what each rule is called, what it
 *  matches, and what it does about it. */
function policyBrief(): string {
  return listPolicies()
    .filter((p) => p.enabled)
    .sort((a, b) => a.priority - b.priority)
    .map((p) => {
      const outcome = p.action === "REFUSE" ? "refuse the request" : `route to ${p.envKey}`;
      const detail = p.description ? ` — ${p.description}` : "";
      return `- "${p.name}": when ${p.summary}, ${outcome}.${detail}`;
    })
    .join("\n");
}

function parse(raw: string, names: Set<string>): Omit<PolicyScan, "scanner" | "latencyMs"> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const o = JSON.parse(raw.slice(start, end + 1)) as {
      compatible?: unknown; breached?: unknown; reason?: unknown;
    };
    if (typeof o.compatible !== "boolean") return null;
    // Only names that exist. A model inventing a policy must not be able to
    // put a request on a path no written rule asked for.
    const breached = Array.isArray(o.breached)
      ? o.breached.filter((n): n is string => typeof n === "string" && names.has(n))
      : [];
    return {
      compatible: o.compatible && breached.length === 0,
      breached,
      reason: typeof o.reason === "string" ? o.reason.slice(0, 240) : "",
    };
  } catch {
    return null;
  }
}

export async function scanAgainstPolicies(
  subject: string,
  signal?: AbortSignal,
): Promise<PolicyScan> {
  const started = Date.now();
  const provider = getProvider("scanner");
  const scanner = `${provider.id}:${provider.model}`;
  const names = new Set(listPolicies().filter((p) => p.enabled).map((p) => p.name));

  try {
    const raw = await provider.complete({
      system: SYSTEM,
      messages: [{ role: "user", content: `Policies:\n${policyBrief()}\n\nRequest:\n${subject}` }],
      temperature: 0,
      maxTokens: 400,
      json: true,
      signal,
    });
    const verdict = parse(raw, names);
    if (!verdict) {
      return {
        compatible: true, breached: [], scanner, latencyMs: Date.now() - started,
        skipped: "unavailable",
        reason: "The scanner returned nothing usable; the written rules still apply.",
      };
    }
    return { ...verdict, scanner, latencyMs: Date.now() - started };
  } catch {
    // Unreachable or refused by the egress boundary. The policy engine is
    // deterministic and still runs — this layer adds judgement on top of it,
    // so losing it reduces insight rather than removing enforcement.
    return {
      compatible: true, breached: [], scanner, latencyMs: Date.now() - started,
      skipped: "unavailable",
      reason: "The scanner was unreachable; the written rules still apply.",
    };
  }
}
