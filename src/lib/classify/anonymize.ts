import { analyzeWithPresidio, isAnonymisable, type PresidioHit } from "./presidio";

/**
 * Reversible anonymisation, backed by Microsoft Presidio's anonymizer
 * (https://github.com/microsoft/presidio) running beside the analyzer.
 *
 * Presidio decides what to replace and where; this module decides what to put
 * in its place and remembers the swap, so a reply can be put back together
 * afterwards. The request that leaves for a public model carries only the
 * placeholders; the table mapping them back to real values stays on this side
 * of the boundary and is never sent anywhere.
 *
 * We ask Presidio for `replace` rather than its own `encrypt` operator on
 * purpose. Encryption is reversible too, but it puts "gAAAAABn7x2k…" in front
 * of the model, which reads as noise — it cannot tell two ciphertexts apart as
 * people, and it will not carry them into a sentence. <PERSON_1> it can reason
 * about, refer to, and hand back in its answer, which is what makes the
 * round trip work.
 *
 * Only talks to a container on loopback, the same posture as the analyzer.
 */

const ANONYMIZER_URL = process.env.PRESIDIO_ANONYMIZER_URL || "http://127.0.0.1:5003";
const TIMEOUT_MS = 2000;

export interface Replacement {
  /** The token the model sees, e.g. <PERSON_1>. */
  placeholder: string;
  /** What it stands for. Never leaves this process. */
  original: string;
  entityType: string;
}

export interface AnonymizeResult {
  /** Safe to send onward. Equals the input when nothing was found. */
  text: string;
  replacements: Replacement[];
  /** False when the container could not be reached. The caller must then
   *  treat the text as un-anonymised and route it accordingly — a failure
   *  here must never be read as "nothing sensitive found". */
  available: boolean;
}

/** Presidio returns overlapping spans when two recognisers agree (an IBAN is
 *  often also a generic number). Keep the longest, then the better scoring,
 *  and drop anything that overlaps a span already kept. */
function dedupe(hits: PresidioHit[]): PresidioHit[] {
  const ordered = [...hits].sort((a, b) => {
    const span = (b.end - b.start) - (a.end - a.start);
    return span !== 0 ? span : b.score - a.score;
  });
  const kept: PresidioHit[] = [];
  for (const h of ordered) {
    if (kept.some((k) => h.start < k.end && k.start < h.end)) continue;
    kept.push(h);
  }
  return kept.sort((a, b) => a.start - b.start);
}

/**
 * Presidio's anonymizers map is keyed by entity type, so every PERSON would
 * collapse to one token and two different people would become indis-
 * tinguishable — fatal for putting the answer back together. We give each
 * distinct value its own synthetic type (PERSON_1, PERSON_2…) and one
 * operator per type, so Presidio still performs every replacement while the
 * tokens stay one-to-one with real values.
 *
 * The same value appearing twice keeps the same token, which is what makes a
 * sentence like "Omar's salary … pay Omar" still read coherently.
 */
function plan(text: string, hits: PresidioHit[]) {
  const byValue = new Map<string, { placeholder: string; entityType: string }>();
  const counters = new Map<string, number>();
  const analyzerResults: Array<PresidioHit & { entity_type: string }> = [];
  const operators: Record<string, { type: "replace"; new_value: string }> = {};

  for (const h of dedupe(hits)) {
    // Presidio reports everything it recognises, including DATE_TIME, which
    // fires on words like "monthly". Replacing those costs the model real
    // meaning and protects nothing, so only redact what we call sensitive.
    if (!isAnonymisable(h.entity_type)) continue;
    const original = text.slice(h.start, h.end);
    if (!original.trim()) continue;

    const key = `${h.entity_type}:${original}`;
    let entry = byValue.get(key);
    if (!entry) {
      const n = (counters.get(h.entity_type) ?? 0) + 1;
      counters.set(h.entity_type, n);
      entry = { placeholder: `<${h.entity_type}_${n}>`, entityType: h.entity_type };
      byValue.set(key, entry);
      operators[`${h.entity_type}_${n}`] = { type: "replace", new_value: entry.placeholder };
    }
    // Presidio keys operators by entity_type, so the synthetic type is what
    // routes this span to its own replacement value.
    analyzerResults.push({ ...h, entity_type: entry.placeholder.slice(1, -1) });
  }

  const replacements: Replacement[] = [...byValue.entries()].map(([key, v]) => ({
    placeholder: v.placeholder,
    original: key.slice(v.entityType.length + 1),
    entityType: v.entityType,
  }));

  return { analyzerResults, operators, replacements };
}

export async function anonymize(text: string, hits: PresidioHit[]): Promise<AnonymizeResult> {
  if (!text.trim() || hits.length === 0) {
    return { text, replacements: [], available: true };
  }

  const { analyzerResults, operators, replacements } = plan(text, hits);
  if (analyzerResults.length === 0) {
    return { text, replacements: [], available: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ANONYMIZER_URL}/anonymize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, analyzer_results: analyzerResults, anonymizers: operators }),
      signal: controller.signal,
    });
    if (!res.ok) return { text, replacements: [], available: false };
    const body = (await res.json()) as { text?: string };
    if (typeof body.text !== "string") return { text, replacements: [], available: false };
    return { text: body.text, replacements, available: true };
  } catch {
    // Unreachable or too slow. Fail closed: the caller sees available:false
    // and must keep the request on-prem rather than send the raw text out.
    return { text, replacements: [], available: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Put the real values back into a reply that came from outside.
 *
 * Longest placeholder first, so <PERSON_10> is never eaten by <PERSON_1>.
 */
export function restore(text: string, replacements: Replacement[]): string {
  if (!replacements.length) return text;
  let out = text;
  for (const r of [...replacements].sort((a, b) => b.placeholder.length - a.placeholder.length)) {
    out = out.split(r.placeholder).join(r.original);
  }
  return out;
}

/** Separator used to anonymise a whole conversation in one pass. A control
 *  picture character no recogniser claims, so no entity can span it. */
const JOIN = "\n␟\n";

export interface MultiResult {
  parts: string[];
  replacements: Replacement[];
  /** False when something needed redacting and we could not do it. */
  available: boolean;
  /** False when the analyzer itself was unreachable — recall is reduced, but
   *  that is the documented degraded mode, not a failure to protect. */
  analyzerUp: boolean;
}

/**
 * Anonymise every message heading outward under one shared map, so a person
 * named in turn one keeps the same token in turn nine. Analysing the turns
 * together rather than one by one is also what makes that possible — and it
 * costs one round trip instead of N.
 */
export async function anonymizeAll(parts: string[]): Promise<MultiResult> {
  const joined = parts.join(JOIN);
  const { hits, available: analyzerUp } = await analyzeWithPresidio(joined);
  if (!hits.length) return { parts, replacements: [], available: true, analyzerUp };

  const r = await anonymize(joined, hits);
  if (!r.available) return { parts, replacements: [], available: false, analyzerUp };

  const split = r.text.split(JOIN);
  // If the separator did not survive, the mapping between messages is no
  // longer trustworthy. Fail closed rather than send a scrambled payload.
  if (split.length !== parts.length) {
    return { parts, replacements: [], available: false, analyzerUp };
  }
  return { parts: split, replacements: r.replacements, available: true, analyzerUp };
}

/**
 * Puts real values back into a reply as it streams.
 *
 * A placeholder can arrive split across chunks — "<PER" then "SON_1>" — so a
 * plain per-chunk replace would miss it and leak the token to the reader.
 * Anything after an unclosed "<" is held back until its ">" turns up.
 */
export function createRestorer(replacements: Replacement[]) {
  if (!replacements.length) {
    return { push: (chunk: string) => chunk, flush: () => "" };
  }
  let held = "";
  return {
    push(chunk: string): string {
      held += chunk;
      const open = held.lastIndexOf("<");
      const cut = open !== -1 && held.indexOf(">", open) === -1 ? open : held.length;
      const ready = held.slice(0, cut);
      held = held.slice(cut);
      return restore(ready, replacements);
    },
    flush(): string {
      const out = restore(held, replacements);
      held = "";
      return out;
    },
  };
}
