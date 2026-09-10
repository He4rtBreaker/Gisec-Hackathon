import { db } from "./db";
import { writeAudit } from "./audit";
import { bindingInfo, type BindingInfo } from "./llm/provider";
import { ENV_META, type EnvKey, type Level } from "./domain";

/**
 * Live state of the three execution environments.
 *
 * `in_flight` counts requests actually executing; `sim_load` is capacity an
 * operator has reserved to simulate pressure from other tenants. The router
 * treats both as occupied, which is how an on-prem saturation pushes Official
 * traffic onto its cloud fallback.
 */

export type EnvStatus = "online" | "offline";

export interface EnvRuntime {
  key: EnvKey;
  name: string;
  kind: string;
  region: string;
  capacity: number;
  inFlight: number;
  simLoad: number;
  costPer1k: number;
  egress: string;
  maxLevel: Level;
  status: EnvStatus;
  netMs: number;
  /** Version of the model artefact active here, if any. */
  artefact: string | null;
  binding: BindingInfo;
}

export function listEnvRuntime(): EnvRuntime[] {
  const rows = db().prepare(
    `SELECT e.key, e.name, e.kind, e.region, e.capacity, e.in_flight AS inFlight,
            e.sim_load AS simLoad, e.cost_per_1k AS costPer1k, e.egress, e.max_level AS maxLevel,
            e.status, e.net_ms AS netMs,
            (SELECT a.version FROM artefact_deployments d JOIN artefacts a ON a.id = d.artefact_id
              WHERE d.env_key = e.key AND d.state = 'active' LIMIT 1) AS artefact
       FROM environments e ORDER BY e.sort_order`
  ).all() as Array<Omit<EnvRuntime, "binding">>;
  return rows.map((r) => ({ ...r, binding: bindingInfo(r.key) }));
}

export function acquire(env: EnvKey): void {
  db().prepare(`UPDATE environments SET in_flight = in_flight + 1 WHERE key = ?`).run(env);
}

export function release(env: EnvKey): void {
  db().prepare(`UPDATE environments SET in_flight = MAX(in_flight - 1, 0) WHERE key = ?`).run(env);
}

export function setEnvStatus(actor: string, env: EnvKey, status: EnvStatus): void {
  if (status !== "online" && status !== "offline") throw new Error(`invalid status ${status}`);
  const res = db().prepare(`UPDATE environments SET status = ? WHERE key = ? AND status != ?`)
    .run(status, env, status);
  if (!res.changes) return;
  writeAudit({
    actor, kind: "env.status", subject: env,
    summary: `${ENV_META[env].name} set ${status}`, detail: { env, status },
  });
}

/** Reserve simulated capacity. Clamped to the environment's slot count. */
export function setSimLoad(actor: string, env: EnvKey, load: number): number {
  const row = db().prepare(`SELECT capacity, sim_load FROM environments WHERE key = ?`)
    .get(env) as { capacity: number; sim_load: number } | undefined;
  if (!row) throw new Error(`unknown environment ${env}`);

  const next = Math.max(0, Math.min(row.capacity, Math.round(load)));
  if (next === row.sim_load) return next;

  db().prepare(`UPDATE environments SET sim_load = ? WHERE key = ?`).run(next, env);
  writeAudit({
    actor, kind: "env.load", subject: env,
    summary: `${ENV_META[env].name} simulated load ${row.sim_load} → ${next} of ${row.capacity} slots`,
    detail: { env, from: row.sim_load, to: next },
  });
  return next;
}

export function getSimLoad(env: EnvKey): { simLoad: number; capacity: number } {
  return db().prepare(`SELECT sim_load AS simLoad, capacity FROM environments WHERE key = ?`)
    .get(env) as { simLoad: number; capacity: number };
}
