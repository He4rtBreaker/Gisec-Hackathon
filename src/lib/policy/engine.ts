import { db } from "../db";
import { ENV_CLEARANCE, LEVEL_RANK, type EnvKey, type Level } from "../domain";
import type { Signal } from "../classify";
import { bindingInfo } from "../llm/provider";

/**
 * Policy evaluation.
 *
 * Policies are ordered by priority and the first match wins, so the table reads
 * top-to-bottom like a firewall rule set. Every policy considered is recorded in
 * the trace — including the ones that did not match and why — because "why was
 * this allowed" is as much an audit question as "why was this refused".
 */

export interface PolicyCondition {
  /** Classification is exactly one of these. */
  level?: Level[];
  /** Classification is at or above this level. */
  minLevel?: Level;
  /** Classification outranks the requester's own clearance. */
  exceedsClearance?: boolean;
  /** Any of these detector codes fired during inspection. */
  signals?: string[];
  /** Always matches. Used for the terminal default-deny. */
  always?: boolean;
}

export interface PolicyRow {
  id: string;
  name: string;
  description: string;
  priority: number;
  enabled: number;
  condition_json: string;
  action: "ROUTE" | "REFUSE";
  env_key: EnvKey | null;
}

export interface TraceEntry {
  policyId: string;
  name: string;
  priority: number;
  action: "ROUTE" | "REFUSE";
  envKey: EnvKey | null;
  matched: boolean;
  /** Why this policy did or did not apply. */
  note: string;
}

export interface RoutingDecision {
  verdict: "ALLOW" | "REFUSE";
  envKey: EnvKey | null;
  matchedPolicyId: string | null;
  matchedPolicyName: string | null;
  reason: string;
  trace: TraceEntry[];
}

export interface RoutingContext {
  /** The governing classification — the thread seal, not just this turn. */
  level: Level;
  clearance: Level;
  signals: Signal[];
  /** Environment the user pinned, if any. */
  pinned: EnvKey | null;
}

interface EnvRow {
  key: EnvKey;
  name: string;
  max_level: Level;
  capacity: number;
  in_flight: number;
  /** Operator-reserved slots simulating other tenants' load. */
  sim_load: number;
  status: string;
  /** Model artefact currently active here, e.g. "mizan-assistant v2.4.1". */
  artefact: string | null;
}

function describeCondition(c: PolicyCondition): string {
  if (c.always) return "applies to every request";
  const parts: string[] = [];
  if (c.level) parts.push(`classification in ${c.level.join(", ")}`);
  if (c.minLevel) parts.push(`classification at or above ${c.minLevel}`);
  if (c.exceedsClearance) parts.push("classification above requester clearance");
  if (c.signals) parts.push(`signal in ${c.signals.join(", ")}`);
  return parts.join(" and ") || "no condition";
}

/** Evaluate one condition, returning why it did or did not fire. */
function test(c: PolicyCondition, ctx: RoutingContext): { ok: boolean; note: string } {
  if (c.always) return { ok: true, note: "terminal rule" };

  if (c.exceedsClearance) {
    const ok = LEVEL_RANK[ctx.level] > LEVEL_RANK[ctx.clearance];
    return {
      ok,
      note: ok
        ? `${ctx.level} outranks requester clearance ${ctx.clearance}`
        : `requester clearance ${ctx.clearance} covers ${ctx.level}`,
    };
  }

  if (c.signals) {
    const hit = ctx.signals.find((s) => c.signals!.includes(s.code));
    return {
      ok: !!hit,
      note: hit ? `signal ${hit.code} present` : `none of ${c.signals.join(", ")} present`,
    };
  }

  if (c.minLevel) {
    const ok = LEVEL_RANK[ctx.level] >= LEVEL_RANK[c.minLevel];
    return { ok, note: ok ? `${ctx.level} ≥ ${c.minLevel}` : `${ctx.level} < ${c.minLevel}` };
  }

  if (c.level) {
    const ok = c.level.includes(ctx.level);
    return { ok, note: ok ? `classification is ${ctx.level}` : `classification ${ctx.level} not in set` };
  }

  return { ok: false, note: "empty condition" };
}

function loadEnvs(): Map<EnvKey, EnvRow> {
  const rows = db().prepare(
    `SELECT e.key, e.name, e.max_level, e.capacity, e.in_flight, e.sim_load, e.status,
            (SELECT a.name || ' ' || a.version
               FROM artefact_deployments d JOIN artefacts a ON a.id = d.artefact_id
              WHERE d.env_key = e.key AND d.state = 'active' LIMIT 1) AS artefact
       FROM environments e`
  ).all() as EnvRow[];
  return new Map(rows.map((r) => [r.key, r]));
}

/**
 * Confirm an environment may lawfully and practically take the job.
 * Policy naming a target is not enough — the target has to be able to hold it.
 */
function admit(env: EnvRow | undefined, level: Level): { ok: boolean; reason: string } {
  if (!env) return { ok: false, reason: "target environment is not registered" };
  if (env.status !== "online") return { ok: false, reason: `${env.name} is ${env.status}` };
  if (LEVEL_RANK[env.max_level] < LEVEL_RANK[level]) {
    return {
      ok: false,
      reason: `${env.name} is accredited only to ${env.max_level} and cannot hold ${level} material`,
    };
  }
  const used = env.in_flight + env.sim_load;
  if (used >= env.capacity) {
    return { ok: false, reason: `${env.name} is at capacity (${used}/${env.capacity} slots in use)` };
  }
  // The binding must stay inside the environment's network boundary. An enclave
  // pointed at a hosted API is not an enclave, so it is not eligible at all.
  const binding = bindingInfo(env.key);
  if (!binding.egress.ok) {
    return { ok: false, reason: `${env.name} binding breaches its network boundary: ${binding.egress.reason}` };
  }
  if (!env.artefact) {
    return { ok: false, reason: `${env.name} has no active model artefact deployed` };
  }
  return {
    ok: true,
    reason: `${env.name} is accredited to ${env.max_level}, has capacity and serves ${env.artefact}`,
  };
}

export function evaluate(ctx: RoutingContext): RoutingDecision {
  const policies = db().prepare(
    `SELECT id, name, description, priority, enabled, condition_json, action, env_key
       FROM policies WHERE enabled = 1 ORDER BY priority ASC`
  ).all() as PolicyRow[];

  const envs = loadEnvs();
  const trace: TraceEntry[] = [];

  /* ---- pin guard ------------------------------------------------------ *
   * A pinned target may narrow the choice among lawful environments, never
   * widen it. Attempting to pin an environment that is not accredited for the
   * material is refused outright rather than quietly overridden: the UI already
   * prevents it, so reaching here means the client was bypassed, and that is
   * precisely the event an auditor needs to see.                            */
  const pin = ctx.pinned ? envs.get(ctx.pinned) : undefined;

  if (ctx.pinned) {
    if (!pin) {
      trace.push({
        policyId: "pin", name: "Pinned target accreditation", priority: 0,
        action: "REFUSE", envKey: ctx.pinned, matched: true,
        note: `${ctx.pinned} is not a registered environment`,
      });
      return {
        verdict: "REFUSE",
        envKey: null,
        matchedPolicyId: null,
        matchedPolicyName: "Pinned target accreditation",
        reason: `Pinned environment "${ctx.pinned}" is not registered.`,
        trace,
      };
    }

    const needs = ENV_CLEARANCE[pin.key];
    if (LEVEL_RANK[ctx.clearance] < LEVEL_RANK[needs]) {
      trace.push({
        policyId: "pin", name: "Pinned target access", priority: 0,
        action: "REFUSE", envKey: ctx.pinned, matched: true,
        note: `${pin.name} requires ${needs} clearance; requester holds ${ctx.clearance}`,
      });
      return {
        verdict: "REFUSE",
        envKey: null,
        matchedPolicyId: null,
        matchedPolicyName: "Pinned target access",
        reason:
          `Pinned target access: ${pin.name} may only be targeted by requesters ` +
          `holding ${needs} clearance. Your clearance is ${ctx.clearance}.`,
        trace,
      };
    }

    if (LEVEL_RANK[pin.max_level] < LEVEL_RANK[ctx.level]) {
      trace.push({
        policyId: "pin", name: "Pinned target accreditation", priority: 0,
        action: "REFUSE", envKey: ctx.pinned, matched: true,
        note: `${pin.name} is accredited to ${pin.max_level}; material is ${ctx.level}`,
      });
      return {
        verdict: "REFUSE",
        envKey: null,
        matchedPolicyId: null,
        matchedPolicyName: "Pinned target accreditation",
        reason:
          `Pinned target accreditation: ${pin.name} is accredited only to ` +
          `${pin.max_level} and cannot hold ${ctx.level} material. ` +
          `A conversation cannot be downgraded once it holds sensitive data.`,
        trace,
      };
    }

    trace.push({
      policyId: "pin", name: "Pinned target accreditation", priority: 0,
      action: "ROUTE", envKey: ctx.pinned, matched: false,
      note: `${pin.name} is accredited to ${pin.max_level}; permitted to hold ${ctx.level}`,
    });
  }

  for (const p of policies) {
    let cond: PolicyCondition;
    try {
      cond = JSON.parse(p.condition_json) as PolicyCondition;
    } catch {
      trace.push({
        policyId: p.id, name: p.name, priority: p.priority, action: p.action,
        envKey: p.env_key, matched: false, note: "condition is not valid JSON; skipped",
      });
      continue;
    }

    const { ok, note } = test(cond, ctx);
    if (!ok) {
      trace.push({
        policyId: p.id, name: p.name, priority: p.priority, action: p.action,
        envKey: p.env_key, matched: false, note,
      });
      continue;
    }

    /* ---- refusal ----------------------------------------------------- */
    if (p.action === "REFUSE") {
      trace.push({
        policyId: p.id, name: p.name, priority: p.priority, action: "REFUSE",
        envKey: null, matched: true, note,
      });
      return {
        verdict: "REFUSE",
        envKey: null,
        matchedPolicyId: p.id,
        matchedPolicyName: p.name,
        reason: `${p.name}: ${p.description || note}`,
        trace,
      };
    }

    /* ---- routing ------------------------------------------------------ */
    // The pin has already cleared accreditation above, so honouring it here
    // can only ever move the job to an equally or more protected environment.
    const policyTarget = p.env_key ? envs.get(p.env_key) : undefined;
    const usePin = !!pin && admit(pin, ctx.level).ok;
    const target = usePin ? pin : policyTarget;
    const check = admit(target, ctx.level);

    if (!check.ok) {
      // The policy matched but its target cannot take the job. Keep going —
      // a lower-priority rule may name a viable environment.
      trace.push({
        policyId: p.id, name: p.name, priority: p.priority, action: "ROUTE",
        envKey: p.env_key, matched: true,
        note: `${note}, but ${check.reason}`,
      });
      continue;
    }

    trace.push({
      policyId: p.id, name: p.name, priority: p.priority, action: "ROUTE",
      envKey: target!.key, matched: true,
      note: usePin && target!.key !== p.env_key
        ? `${note}; ${check.reason}; requester pinned ${target!.name} over the policy default`
        : `${note}; ${check.reason}`,
    });

    return {
      verdict: "ALLOW",
      envKey: target!.key,
      matchedPolicyId: p.id,
      matchedPolicyName: p.name,
      reason:
        usePin && target!.key !== p.env_key
          ? `${p.name}: ${ctx.level} material dispatched to ${target!.name} at the requester's request.`
          : `${p.name}: ${ctx.level} material dispatched to ${target!.name}.`,
      trace,
    };
  }

  // Nothing matched, or every match named an environment that could not take it.
  return {
    verdict: "REFUSE",
    envKey: null,
    matchedPolicyId: null,
    matchedPolicyName: null,
    reason:
      `No policy permits ${ctx.level} material in any available environment. ` +
      `Default deny applied.`,
    trace,
  };
}

export { describeCondition };
