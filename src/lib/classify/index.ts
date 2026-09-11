import { LEVEL_RANK, LEVELS, maxLevel, type Level } from "../domain";
import { getProvider } from "../llm/provider";
import { detect, type Signal } from "./detectors";
import { analyzeWithPresidio } from "./presidio";

export type { Signal } from "./detectors";

export interface Classification {
  level: Level;
  /** 0–1. Agreement between the rule floor and the adjudicating model. */
  confidence: number;
  rationale: string;
  signals: Signal[];
  /** Which inspector produced this — surfaced in the ledger. */
  inspector: string;
  latencyMs: number;
  /** True when the model was unreachable and rules alone decided. */
  degraded: boolean;
  /** False when the optional NER analyzer (Presidio) could not be reached —
   *  recall is reduced, but the regex floor and the adjudicator still hold. */
  nerAvailable: boolean;
}

export interface ClassifyInput {
  prompt: string;
  attachments?: Array<{ filename: string; text: string }>;
}

const ADJUDICATOR_SYSTEM = `You are the classification inspector for a government AI platform.
You read a user request and decide the sensitivity of the information it contains.

Levels, least to most sensitive:
PUBLIC       — releasable without restriction; no personal, commercial or operational data.
OFFICIAL     — routine government business; limited distribution; low harm if exposed.
CONFIDENTIAL — personal, health, financial or commercial data about identifiable people or contracts.
SECRET       — national security, defence, intelligence or critical-infrastructure material.

Judge the information actually present, not the topic discussed. Asking how a
passport works is PUBLIC; supplying a passport number is CONFIDENTIAL.

Reply with JSON only, no prose:
{"level":"<LEVEL>","confidence":<0-1>,"rationale":"<one sentence, under 30 words>"}`;

/** Cap what we hand the adjudicator; long documents are sampled, not truncated blindly. */
const ADJUDICATOR_BUDGET = 6000;

function buildSubject(input: ClassifyInput): string {
  const parts = [input.prompt];
  for (const a of input.attachments ?? []) {
    parts.push(`\n--- attachment: ${a.filename} ---\n${a.text}`);
  }
  const joined = parts.join("\n");
  if (joined.length <= ADJUDICATOR_BUDGET) return joined;
  // Head and tail carry the most signal; the middle of a long table rarely adds a new level.
  const head = joined.slice(0, ADJUDICATOR_BUDGET * 0.7);
  const tail = joined.slice(-ADJUDICATOR_BUDGET * 0.3);
  return `${head}\n[… ${joined.length - ADJUDICATOR_BUDGET} characters elided …]\n${tail}`;
}

/** Highest level any detector positively matched. This is the floor. */
function ruleFloor(signals: Signal[]): Level {
  return signals.reduce<Level>((acc, s) => maxLevel(acc, s.level), "PUBLIC");
}

function parseVerdict(raw: string): { level: Level; confidence: number; rationale: string } | null {
  // Models occasionally wrap JSON in prose or fences; take the first object.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const level = String(obj.level ?? "").toUpperCase() as Level;
    if (!LEVELS.includes(level)) return null;

    const confRaw = Number(obj.confidence);
    const confidence = Number.isFinite(confRaw) ? Math.min(1, Math.max(0, confRaw)) : 0.5;
    const rationale = String(obj.rationale ?? "").trim() || "No rationale supplied.";
    return { level, confidence, rationale };
  } catch {
    return null;
  }
}

function describeSignals(signals: Signal[]): string {
  if (!signals.length) return "no regulated data patterns matched";
  return signals
    .slice(0, 3)
    .map((s) => `${s.label.toLowerCase()}${s.count > 1 ? ` (x${s.count})` : ""}`)
    .join(", ");
}

/**
 * Classify a request before it is allowed to reach an execution environment.
 *
 * Runs on the on-prem inspector endpoint. Nothing here reaches the public
 * cloud — that is the point: the decision about whether data may leave the
 * boundary is itself made inside the boundary.
 */
export async function classify(input: ClassifyInput): Promise<Classification> {
  const started = Date.now();
  const subject = buildSubject(input);

  const ruleSignals = detect(subject);

  const inspector = getProvider("inspector");

  async function adjudicate(): Promise<{ verdict: ReturnType<typeof parseVerdict>; degraded: boolean }> {
    if (inspector.id === "mock") {
      // No real model on the inspector — the detector rules classify alone,
      // exactly as the offline mode is documented to work.
      return { verdict: null, degraded: true };
    }
    try {
      const raw = await inspector.complete({
        system: ADJUDICATOR_SYSTEM,
        messages: [{ role: "user", content: subject }],
        temperature: 0,
        maxTokens: 400,
        json: true,
      });
      const verdict = parseVerdict(raw);
      return { verdict, degraded: !verdict };
    } catch {
      // Inspector unavailable. Rules still hold, and we say so rather than
      // silently downgrading to a permissive default.
      return { verdict: null, degraded: true };
    }
  }

  // The adjudicator and the NER analyzer (Presidio) are two independent
  // on-prem network calls — run them concurrently rather than paying both
  // latencies back to back.
  const [{ verdict, degraded }, presidio] = await Promise.all([adjudicate(), analyzeWithPresidio(subject)]);

  // Presidio adds recall (it catches identifying information no regex can),
  // never the safety floor itself — that's still whatever the rule detectors
  // alone would have matched. Concatenating is enough: the two sources use
  // disjoint code namespaces, so there is nothing to de-duplicate.
  const signals = [...ruleSignals, ...presidio.signals];
  const floor = ruleFloor(signals);

  // The model may escalate above the rule floor, never below it.
  const level = verdict ? maxLevel(floor, verdict.level) : floor;

  let confidence: number;
  let rationale: string;

  if (!verdict) {
    // Rules alone. Confident when something matched, deliberately not when nothing did.
    confidence = signals.length ? 0.72 : 0.4;
    rationale = signals.length
      ? `Adjudicator unavailable; rule inspection alone matched ${describeSignals(signals)}.`
      : "Adjudicator unavailable and no regulated data patterns matched; held at the rule floor.";
  } else if (verdict.level === level && LEVEL_RANK[floor] <= LEVEL_RANK[verdict.level]) {
    // Model and rules agree, or the model escalated on semantics the rules cannot see.
    confidence = verdict.confidence;
    rationale = verdict.rationale;
  } else {
    // Rules overrode a lower model verdict — the safety-relevant case, so name it.
    confidence = Math.max(verdict.confidence, 0.8);
    rationale =
      `Rule inspection raised this to ${level} over the adjudicator's ${verdict.level}: ` +
      `${describeSignals(signals)}.`;
  }

  if (!presidio.available) {
    rationale += " NER analyzer offline — recall limited to rule-based detectors.";
  }

  return {
    level,
    confidence,
    rationale,
    signals,
    inspector: `on-prem/${getProvider("inspector").id}:${getProvider("inspector").model}`,
    latencyMs: Date.now() - started,
    degraded,
    nerAvailable: presidio.available,
  };
}
