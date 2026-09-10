import type { Level } from "../domain";

/**
 * Deterministic pre-inspection.
 *
 * These run before any model sees the text, and they are the floor of the
 * classification: the adjudicating model may raise a verdict but never lower
 * it below what a detector positively matched. That ordering is what makes
 * the inspector safe to rely on — a model that is wrong, jailbroken or simply
 * unavailable cannot talk the platform into sending regulated data offshore.
 */

export interface Signal {
  /** Stable identifier, used in the audit trail. */
  code: string;
  label: string;
  /** Minimum classification this signal forces. */
  level: Level;
  /** How many times it fired. */
  count: number;
  /** Redacted evidence, safe to display in the UI and store in the ledger. */
  sample: string;
}

interface Detector {
  code: string;
  label: string;
  level: Level;
  pattern: RegExp;
  /** Optional second-stage check to suppress false positives. */
  confirm?: (match: string) => boolean;
  /** How the evidence is shown once matched. */
  redact?: (match: string) => string;
}

/** Mask all but the last two characters. */
const mask = (s: string) => {
  const tail = s.slice(-2);
  return `${"•".repeat(Math.max(3, Math.min(s.length - 2, 12)))}${tail}`;
};

/** Luhn check — keeps ordinary long numbers from reading as payment cards. */
function luhn(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

const DETECTORS: Detector[] = [
  /* ---- explicit handling markings ------------------------------------- */
  {
    code: "MARK_TOP_SECRET",
    label: "Top Secret handling marking",
    level: "SECRET",
    pattern: /\b(?:TOP[\s-]?SECRET|TS\/SCI)\b/gi,
  },
  {
    code: "MARK_SECRET",
    label: "Secret handling marking",
    level: "SECRET",
    pattern: /\b(?:SECRET|CLASSIFIED)\b(?!\s+(?:key|token|manager|santa))/gi,
  },
  {
    code: "MARK_CONFIDENTIAL",
    label: "Confidential handling marking",
    level: "CONFIDENTIAL",
    pattern: /\b(?:CONFIDENTIAL|RESTRICTED|OFFICIAL[\s-]SENSITIVE)\b/gi,
  },

  /* ---- national security ---------------------------------------------- */
  {
    code: "DEFENCE_OPS",
    label: "Defence or operational planning language",
    level: "SECRET",
    pattern:
      /\b(?:troop\s+(?:movement|deployment)s?|force\s+posture|order\s+of\s+battle|munitions?|weapons?\s+system|rules\s+of\s+engagement|target\s+package|sortie|airstrike)\b/gi,
  },
  {
    code: "INTEL_SOURCES",
    label: "Intelligence sourcing or surveillance activity",
    level: "SECRET",
    pattern:
      /\b(?:human\s+intelligence|HUMINT|SIGINT|covert\s+(?:source|operation)|informant|asset\s+handler|surveillance\s+(?:operation|target))\b/gi,
  },
  {
    code: "CRITICAL_INFRA",
    label: "Critical national infrastructure detail",
    level: "SECRET",
    pattern:
      /\b(?:SCADA|grid\s+control|water\s+treatment\s+control|substation\s+topology|pipeline\s+control\s+system)\b/gi,
  },

  /* ---- identity documents --------------------------------------------- */
  {
    code: "EMIRATES_ID",
    label: "Emirates ID number",
    level: "CONFIDENTIAL",
    pattern: /\b784[-\s]?\d{4}[-\s]?\d{7}[-\s]?\d\b/g,
    redact: mask,
  },
  {
    code: "PASSPORT",
    label: "Passport number",
    level: "CONFIDENTIAL",
    pattern: /\b(?:passport\s*(?:no\.?|number|#)?\s*:?\s*)([A-Z]{1,2}\d{6,9})\b/gi,
    redact: mask,
  },

  /* ---- financial instruments ------------------------------------------ */
  {
    code: "IBAN",
    label: "Bank account (IBAN)",
    level: "CONFIDENTIAL",
    pattern: /\b[A-Z]{2}\d{2}[\s]?(?:[A-Z0-9]{4}[\s]?){3,7}[A-Z0-9]{1,4}\b/g,
    redact: mask,
  },
  {
    code: "PAYMENT_CARD",
    label: "Payment card number",
    level: "CONFIDENTIAL",
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    confirm: luhn,
    redact: mask,
  },
  {
    code: "PAYROLL",
    label: "Salary or payroll data",
    level: "CONFIDENTIAL",
    pattern:
      /\b(?:salary|payroll|remuneration|gratuity|net\s+pay|gross\s+pay|compensation\s+band)\b/gi,
  },

  /* ---- personal data --------------------------------------------------- */
  {
    code: "HEALTH",
    label: "Health or medical record data",
    level: "CONFIDENTIAL",
    pattern:
      /\b(?:diagnosis|medical\s+record|patient\s+(?:id|record|history)|prescription|blood\s+type|HIV|oncolog)\w*\b/gi,
  },
  {
    code: "EMAIL",
    label: "Personal email address",
    level: "OFFICIAL",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    redact: (s) => {
      const [u, d] = s.split("@");
      return `${u.slice(0, 2)}${"•".repeat(Math.max(2, u.length - 2))}@${d}`;
    },
  },
  {
    code: "PHONE",
    label: "Telephone number",
    level: "OFFICIAL",
    pattern: /(?:\+971|00971|\b0)(?:[\s-]?\d){8,9}\b/g,
    redact: mask,
  },

  /* ---- internal business ----------------------------------------------- */
  {
    code: "PROCUREMENT",
    label: "Procurement or contract commercial detail",
    level: "OFFICIAL",
    pattern:
      /\b(?:tender|procurement|bid\s+(?:price|evaluation)|contract\s+value|supplier\s+quote|purchase\s+order)\b/gi,
  },
  {
    code: "CREDENTIAL",
    label: "Credential or secret material",
    level: "CONFIDENTIAL",
    pattern:
      /\b(?:api[_\s-]?key|access[_\s-]?token|private[_\s-]?key|password\s*[:=]|BEGIN\s+(?:RSA|OPENSSH|PRIVATE))\b/gi,
  },
];

/** Run every detector over the supplied text. */
export function detect(text: string): Signal[] {
  const found = new Map<string, Signal>();

  for (const d of DETECTORS) {
    // Each detector carries the /g flag; reset so repeated calls are safe.
    d.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;

    while ((m = d.pattern.exec(text)) !== null) {
      // Zero-length matches would spin forever.
      if (m[0].length === 0) { d.pattern.lastIndex++; continue; }

      const hit = m[1] ?? m[0];
      if (d.confirm && !d.confirm(hit)) continue;

      const existing = found.get(d.code);
      if (existing) {
        existing.count += 1;
      } else {
        found.set(d.code, {
          code: d.code,
          label: d.label,
          level: d.level,
          count: 1,
          sample: (d.redact ?? ((s: string) => s))(hit.trim()),
        });
      }
    }
  }

  return [...found.values()];
}
