import { db, id, now } from "./db";
import { writeAudit } from "./audit";
import { ENV_MAX_LEVEL, ENV_META, LEVEL_RANK, LEVELS, type EnvKey, type Level } from "./domain";
import { describeCondition, type PolicyCondition, type PolicyRow } from "./policy/engine";

/**
 * Policy administration: list with lint warnings, create, edit, toggle, delete.
 * Every change is written to the audit ledger with its before/after state.
 */

/** Detector codes the rule editor can reference. Mirrors classify/detectors.ts. */
export const SIGNAL_CATALOG: Array<{ code: string; level: Level }> = [
  { code: "MARK_TOP_SECRET",   level: "SECRET" },
  { code: "MARK_SECRET",       level: "SECRET" },
  { code: "DEFENCE_OPS",       level: "SECRET" },
  { code: "INTEL_SOURCES",     level: "SECRET" },
  { code: "CRITICAL_INFRA",    level: "SECRET" },
  { code: "MARK_CONFIDENTIAL", level: "CONFIDENTIAL" },
  { code: "EMIRATES_ID",       level: "CONFIDENTIAL" },
  { code: "PASSPORT",          level: "CONFIDENTIAL" },
  { code: "IBAN",              level: "CONFIDENTIAL" },
  { code: "PAYMENT_CARD",      level: "CONFIDENTIAL" },
  { code: "PAYROLL",           level: "CONFIDENTIAL" },
  { code: "HEALTH",            level: "CONFIDENTIAL" },
  { code: "CREDENTIAL",        level: "CONFIDENTIAL" },
  { code: "EMAIL",             level: "OFFICIAL" },
  { code: "PHONE",             level: "OFFICIAL" },
  { code: "PROCUREMENT",       level: "OFFICIAL" },
];

export type ConditionType = "level" | "minLevel" | "exceedsClearance" | "signals" | "always";

export interface PolicyView {
  id: string;
  name: string;
  description: string;
  priority: number;
  enabled: boolean;
  action: "ROUTE" | "REFUSE";
  envKey: EnvKey | null;
  cond: PolicyCondition;
  summary: string;
  /** Problems the editor should surface — unreachable rules, targets that cannot hold the material. */
  warnings: string[];
}

export class PolicyError extends Error {}

const isLevel = (v: string): v is Level => (LEVELS as string[]).includes(v);

/** Levels a condition can match, for accreditation linting. */
function levelsMatched(c: PolicyCondition): Level[] {
  if (c.level) return c.level;
  if (c.minLevel) return LEVELS.filter((l) => LEVEL_RANK[l] >= LEVEL_RANK[c.minLevel!]);
  return [...LEVELS];
}

export function listPolicies(): PolicyView[] {
  const rows = db().prepare(`SELECT * FROM policies ORDER BY priority ASC`).all() as PolicyRow[];
  let terminal: PolicyView | null = null;

  return rows.map((r) => {
    let cond: PolicyCondition = {};
    try { cond = JSON.parse(r.condition_json) as PolicyCondition; } catch { /* shown as invalid */ }

    const v: PolicyView = {
      id: r.id, name: r.name, description: r.description, priority: r.priority,
      enabled: !!r.enabled, action: r.action, envKey: r.env_key, cond,
      summary: describeCondition(cond), warnings: [],
    };

    if (terminal && v.enabled) {
      v.warnings.push(`Unreachable — "${terminal.name}" (priority ${terminal.priority}) matches every request first.`);
    }
    if (v.action === "ROUTE" && v.envKey) {
      const ceiling = ENV_MAX_LEVEL[v.envKey];
      const over = levelsMatched(cond).filter((l) => LEVEL_RANK[l] > LEVEL_RANK[ceiling]);
      if (over.length) {
        v.warnings.push(
          `${ENV_META[v.envKey].name} is accredited to ${ceiling}; ${over.join(", ")} requests ` +
          `matching this rule will fall through to the next rule.`);
      }
    }
    if (v.enabled && cond.always && !terminal) terminal = v;
    return v;
  });
}

export interface PolicyInput {
  id?: string;
  name: string;
  description: string;
  priority: number;
  action: string;
  envKey: string;
  ctype: string;
  levels: string[];
  minLevel: string;
  signals: string[];
}

function buildCondition(i: PolicyInput): PolicyCondition {
  switch (i.ctype as ConditionType) {
    case "level": {
      const levels = i.levels.filter(isLevel);
      if (!levels.length) throw new PolicyError("Pick at least one classification level.");
      return { level: levels };
    }
    case "minLevel":
      if (!isLevel(i.minLevel)) throw new PolicyError("Pick a minimum level.");
      return { minLevel: i.minLevel };
    case "exceedsClearance":
      return { exceedsClearance: true };
    case "signals": {
      const signals = i.signals.filter((c) => SIGNAL_CATALOG.some((s) => s.code === c));
      if (!signals.length) throw new PolicyError("Pick at least one detector signal.");
      return { signals };
    }
    case "always":
      return { always: true };
    default:
      throw new PolicyError("Unknown condition type.");
  }
}

export function savePolicy(actor: string, input: PolicyInput): string {
  const name = input.name.trim();
  if (name.length < 3 || name.length > 60) throw new PolicyError("Name must be 3–60 characters.");

  const priority = Math.round(Number(input.priority));
  if (!Number.isFinite(priority) || priority < 1 || priority > 999) {
    throw new PolicyError("Priority must be between 1 and 999.");
  }

  const action = input.action === "ROUTE" || input.action === "REFUSE" ? input.action : null;
  if (!action) throw new PolicyError("Action must be ROUTE or REFUSE.");

  const envKey = action === "ROUTE" ? (input.envKey as EnvKey) : null;
  if (action === "ROUTE" && !(envKey && envKey in ENV_META)) {
    throw new PolicyError("A ROUTE rule needs a target environment.");
  }

  const cond = buildCondition(input);
  const description = input.description.trim().slice(0, 240);

  const clash = db().prepare(`SELECT name FROM policies WHERE priority = ? AND id != ?`)
    .get(priority, input.id ?? "") as { name: string } | undefined;
  if (clash) throw new PolicyError(`Priority ${priority} is already used by "${clash.name}".`);

  const after = { name, priority, action, envKey, condition: cond, description };

  if (input.id) {
    const before = db().prepare(`SELECT * FROM policies WHERE id = ?`).get(input.id) as PolicyRow | undefined;
    if (!before) throw new PolicyError("This rule no longer exists.");
    db().prepare(
      `UPDATE policies SET name = ?, description = ?, priority = ?, condition_json = ?, action = ?,
              env_key = ?, updated_at = ? WHERE id = ?`
    ).run(name, description, priority, JSON.stringify(cond), action, envKey, now(), input.id);
    writeAudit({
      actor, kind: "policy.updated", subject: input.id,
      summary: `Rule "${name}" updated (priority ${priority}, ${action}${envKey ? ` → ${envKey}` : ""})`,
      detail: {
        before: { name: before.name, priority: before.priority, action: before.action,
                  envKey: before.env_key, condition: JSON.parse(before.condition_json) },
        after,
      },
    });
    return input.id;
  }

  const pid = id("pol");
  db().prepare(
    `INSERT INTO policies (id, name, description, priority, enabled, condition_json, action, env_key, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`
  ).run(pid, name, description, priority, JSON.stringify(cond), action, envKey, now());
  writeAudit({
    actor, kind: "policy.created", subject: pid,
    summary: `Rule "${name}" created (priority ${priority}, ${action}${envKey ? ` → ${envKey}` : ""})`,
    detail: { after },
  });
  return pid;
}

export function togglePolicy(actor: string, pid: string): void {
  const row = db().prepare(`SELECT name, enabled FROM policies WHERE id = ?`)
    .get(pid) as { name: string; enabled: number } | undefined;
  if (!row) return;
  const enabled = row.enabled ? 0 : 1;
  db().prepare(`UPDATE policies SET enabled = ?, updated_at = ? WHERE id = ?`).run(enabled, now(), pid);
  writeAudit({
    actor, kind: enabled ? "policy.enabled" : "policy.disabled", subject: pid,
    summary: `Rule "${row.name}" ${enabled ? "enabled" : "disabled"}`,
  });
}

export function deletePolicy(actor: string, pid: string): void {
  const row = db().prepare(`SELECT * FROM policies WHERE id = ?`).get(pid) as PolicyRow | undefined;
  if (!row) return;
  db().prepare(`DELETE FROM policies WHERE id = ?`).run(pid);
  writeAudit({
    actor, kind: "policy.deleted", subject: pid, summary: `Rule "${row.name}" deleted`,
    detail: { name: row.name, priority: row.priority, action: row.action, envKey: row.env_key,
              condition: JSON.parse(row.condition_json) },
  });
}
