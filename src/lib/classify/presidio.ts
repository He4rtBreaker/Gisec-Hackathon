import type { Level } from "../domain";
import { mask, type Signal } from "./detectors";

/**
 * Optional NER-backed signal source, backed by Microsoft Presidio's analyzer
 * (https://github.com/microsoft/presidio) running as a local container.
 *
 * The regex detectors in detectors.ts are the classifier's floor and never
 * depend on this: they are fast, dependency-free, and work identically in an
 * air-gapped enclave. Presidio is a *recall* upgrade layered on top of that —
 * it catches identifying information no fixed pattern can, because it reads
 * meaning (named-entity recognition) rather than matching shapes. When it is
 * unreachable — not deployed, or the container is down — classify() simply
 * falls back to the regex floor alone, exactly like the mock/degraded path
 * for the adjudicator model.
 *
 * Never called with an outbound network hop: this only ever talks to a
 * container on loopback (see docker-compose.yml), matching the same
 * network-boundary posture as every other on-prem binding.
 */

const PRESIDIO_URL = process.env.PRESIDIO_URL || "http://127.0.0.1:5002";
const TIMEOUT_MS = 2000;
const SCORE_THRESHOLD = 0.55;

/** Presidio's own entity types we have an opinion on. Types we don't
 *  recognise (e.g. DATE_TIME) are ignored — not everything NER finds is
 *  sensitive on its own. */
const ENTITY_LEVEL: Record<string, Level> = {
  CREDIT_CARD: "CONFIDENTIAL",
  IBAN_CODE: "CONFIDENTIAL",
  CRYPTO: "CONFIDENTIAL",
  US_BANK_NUMBER: "CONFIDENTIAL",
  US_SSN: "CONFIDENTIAL",
  US_ITIN: "CONFIDENTIAL",
  US_PASSPORT: "CONFIDENTIAL",
  US_DRIVER_LICENSE: "CONFIDENTIAL",
  MEDICAL_LICENSE: "CONFIDENTIAL",
  UK_NHS: "CONFIDENTIAL",
  UK_NINO: "CONFIDENTIAL",
  IN_AADHAAR: "CONFIDENTIAL",
  IN_PAN: "CONFIDENTIAL",
  SG_NRIC_FIN: "CONFIDENTIAL",
  AU_TFN: "CONFIDENTIAL",
  AU_MEDICARE: "CONFIDENTIAL",
  ES_NIF: "CONFIDENTIAL",
  IT_FISCAL_CODE: "CONFIDENTIAL",
  PL_PESEL: "CONFIDENTIAL",
  FI_PERSONAL_IDENTITY_CODE: "CONFIDENTIAL",
  IP_ADDRESS: "OFFICIAL",
  PHONE_NUMBER: "OFFICIAL",
  EMAIL_ADDRESS: "OFFICIAL",
  URL: "OFFICIAL",
  LOCATION: "OFFICIAL",
  NRP: "OFFICIAL",
};

const ENTITY_LABEL: Record<string, string> = {
  CREDIT_CARD: "Payment card number (NER)",
  IBAN_CODE: "Bank account (NER)",
  CRYPTO: "Cryptocurrency wallet address",
  US_BANK_NUMBER: "Bank account number (NER)",
  US_SSN: "National ID / SSN (NER)",
  US_ITIN: "Tax identification number (NER)",
  US_PASSPORT: "Passport number (NER)",
  US_DRIVER_LICENSE: "Driver's license number",
  MEDICAL_LICENSE: "Medical license number",
  UK_NHS: "National health service ID",
  UK_NINO: "National insurance number",
  IN_AADHAAR: "National ID number (NER)",
  IN_PAN: "National ID number (NER)",
  SG_NRIC_FIN: "National ID number (NER)",
  AU_TFN: "National ID number (NER)",
  AU_MEDICARE: "National ID number (NER)",
  ES_NIF: "National ID number (NER)",
  IT_FISCAL_CODE: "National ID number (NER)",
  PL_PESEL: "National ID number (NER)",
  FI_PERSONAL_IDENTITY_CODE: "National ID number (NER)",
  IP_ADDRESS: "Network address",
  PHONE_NUMBER: "Telephone number (NER)",
  EMAIL_ADDRESS: "Personal email address (NER)",
  URL: "URL",
  LOCATION: "Location",
  NRP: "Nationality, religion or political affiliation",
};

interface PresidioHit {
  entity_type: string;
  start: number;
  end: number;
  score: number;
}

export interface PresidioResult {
  signals: Signal[];
  /** False when the container could not be reached in time. Not a security
   *  failure — the regex floor still holds — just a recall layer being off. */
  available: boolean;
}

function accumulate(map: Map<string, Signal>, code: string, label: string, level: Level, sample: string) {
  const existing = map.get(code);
  if (existing) { existing.count += 1; return; }
  map.set(code, { code, label, level, count: 1, sample, source: "ner" });
}

function toSignals(text: string, hits: PresidioHit[]): Signal[] {
  const found = new Map<string, Signal>();
  const persons: PresidioHit[] = [];
  let sawIdentifying = false;

  for (const h of hits) {
    if (h.entity_type === "PERSON") { persons.push(h); continue; }
    const level = ENTITY_LEVEL[h.entity_type];
    if (!level) continue;
    sawIdentifying = true;
    accumulate(
      found,
      `NER_${h.entity_type}`,
      ENTITY_LABEL[h.entity_type] ?? `${h.entity_type} (NER)`,
      level,
      mask(text.slice(h.start, h.end)),
    );
  }

  // A bare name is not by itself sensitive — it's the combination of a name
  // with another identifying attribute that privacy law actually means by
  // "personal data". Flagging PERSON alone would make almost every message
  // about a real person CONFIDENTIAL, which is far too noisy to be useful.
  if (persons.length && sawIdentifying) {
    accumulate(
      found,
      "NER_PERSON_IDENTIFIED",
      "Named individual alongside an identifying attribute",
      "CONFIDENTIAL",
      mask(text.slice(persons[0].start, persons[0].end)),
    );
  }

  return [...found.values()];
}

export async function analyzeWithPresidio(text: string): Promise<PresidioResult> {
  if (!text.trim()) return { signals: [], available: true };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${PRESIDIO_URL}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        language: "en",
        score_threshold: SCORE_THRESHOLD,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { signals: [], available: false };
    const hits = (await res.json()) as PresidioHit[];
    return { signals: toSignals(text, hits), available: true };
  } catch {
    // Not deployed, container still starting, or genuinely down. classify()
    // treats this exactly like the adjudicator being unreachable: fall back,
    // don't fail the request.
    return { signals: [], available: false };
  } finally {
    clearTimeout(timer);
  }
}
