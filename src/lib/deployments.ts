import { randomBytes } from "node:crypto";
import { db, id, now } from "./db";
import { writeAudit } from "./audit";
import { ENV_META, type EnvKey, type Level } from "./domain";

/**
 * Model artefact lifecycle.
 *
 * One signed artefact is promoted into each environment over the only channel
 * that environment's accreditation allows. Cloud and on-prem pull over TLS; the
 * enclave has no network path at all, so a build reaches it on removable media
 * through a one-way data diode and is re-hashed on the high side before it may
 * run. Every transition is written to the audit ledger.
 */

export type DeployState = "absent" | "staged" | "importing" | "active" | "superseded";

export interface DeployDetail {
  activatedAt?: number;
  activatedBy?: string;
  /** Data-diode chain of custody — enclave only. */
  mediaRef?: string;
  exportedAt?: number;
  exportedBy?: string;
  crossedAt?: number;
  crossedBy?: string;
  verifiedAt?: number;
  verifiedBy?: string;
  computedDigest?: string;
}

export interface Artefact {
  id: string;
  name: string;
  version: string;
  digest: string;
  sizeMb: number;
  notes: string;
  createdAt: number;
}

export interface Deployment {
  id: string;
  artefactId: string;
  envKey: EnvKey;
  state: DeployState;
  transport: string;
  updatedAt: number;
  detail: DeployDetail;
}

export interface EnvSummary {
  key: EnvKey;
  name: string;
  region: string;
  egress: string;
  maxLevel: Level;
}

export interface LedgerRow {
  id: string;
  ts: number;
  actor: string;
  kind: string;
  summary: string;
}

export const TRANSPORT: Record<EnvKey, string> = {
  cloud:  "registry pull · TLS",
  onprem: "internal mirror · TLS",
  airgap: "data diode · manual import",
};

/** A refused transition. The message is safe to show the operator. */
export class DeployError extends Error {}

/* ---- reads -------------------------------------------------------------- */

export function listEnvironments(): EnvSummary[] {
  return db().prepare(
    `SELECT key, name, region, egress, max_level AS maxLevel FROM environments ORDER BY sort_order`
  ).all() as EnvSummary[];
}

export function listArtefacts(): Artefact[] {
  return db().prepare(
    `SELECT id, name, version, digest, size_mb AS sizeMb, notes, created_at AS createdAt
       FROM artefacts ORDER BY created_at DESC`
  ).all() as Artefact[];
}

export function listDeployments(): Deployment[] {
  const rows = db().prepare(
    `SELECT id, artefact_id AS artefactId, env_key AS envKey, state, transport,
            updated_at AS updatedAt, detail_json
       FROM artefact_deployments`
  ).all() as Array<Omit<Deployment, "detail"> & { detail_json: string }>;
  return rows.map(({ detail_json, ...r }) => ({ ...r, detail: JSON.parse(detail_json || "{}") }));
}

/** What an environment is serving right now, if anything. */
export function activeArtefact(env: EnvKey): { ref: string; digest: string } | null {
  const row = db().prepare(
    `SELECT a.name, a.version, a.digest
       FROM artefact_deployments d JOIN artefacts a ON a.id = d.artefact_id
      WHERE d.env_key = ? AND d.state = 'active' LIMIT 1`
  ).get(env) as { name: string; version: string; digest: string } | undefined;
  return row ? { ref: `${row.name} ${row.version}`, digest: row.digest } : null;
}

export function deployLedger(limit = 20): LedgerRow[] {
  return db().prepare(
    `SELECT id, ts, actor, kind, summary FROM audit_log
      WHERE kind LIKE 'artefact.%' OR kind LIKE 'deploy.%' OR kind LIKE 'diode.%'
      ORDER BY ts DESC LIMIT ?`
  ).all(limit) as LedgerRow[];
}

/* ---- transitions -------------------------------------------------------- */

interface DepRow {
  id: string;
  state: DeployState;
  detail: DeployDetail;
  name: string;
  version: string;
  digest: string;
}

function load(artefactId: string, env: EnvKey): DepRow {
  const row = db().prepare(
    `SELECT d.id, d.state, d.detail_json, a.name, a.version, a.digest
       FROM artefact_deployments d JOIN artefacts a ON a.id = d.artefact_id
      WHERE d.artefact_id = ? AND d.env_key = ?`
  ).get(artefactId, env) as (Omit<DepRow, "detail"> & { detail_json: string }) | undefined;
  if (!row) throw new DeployError("Unknown artefact or environment.");
  const { detail_json, ...rest } = row;
  return { ...rest, detail: JSON.parse(detail_json || "{}") };
}

function save(depId: string, state: DeployState, detail: DeployDetail) {
  db().prepare(
    `UPDATE artefact_deployments SET state = ?, detail_json = ?, updated_at = ? WHERE id = ?`
  ).run(state, JSON.stringify(detail), now(), depId);
}

function audit(actor: string, kind: string, subject: string, summary: string, detail: object) {
  writeAudit({ actor, kind, subject, summary, detail });
}

/** Retire whatever the environment is serving; returns its version, if any. */
function supersede(env: EnvKey): string | null {
  const prev = db().prepare(
    `SELECT d.id, a.version FROM artefact_deployments d JOIN artefacts a ON a.id = d.artefact_id
      WHERE d.env_key = ? AND d.state = 'active'`
  ).get(env) as { id: string; version: string } | undefined;
  if (!prev) return null;
  db().prepare(`UPDATE artefact_deployments SET state = 'superseded', updated_at = ? WHERE id = ?`)
    .run(now(), prev.id);
  return prev.version;
}

function goLive(actor: string, env: EnvKey, d: DepRow, extra: DeployDetail): string {
  const previous = supersede(env);
  save(d.id, "active", { ...d.detail, ...extra, activatedAt: now(), activatedBy: actor });
  const where = ENV_META[env].name;
  audit(actor, "deploy.activated", d.id,
        `${d.name} ${d.version} active in ${where}${previous ? ` (replaces ${previous})` : ""}`,
        { env, version: d.version, previous, transport: TRANSPORT[env] });
  return `${d.name} ${d.version} is live in ${where}${previous ? `, replacing ${previous}` : ""}.`;
}

export function registerArtefact(actor: string, version: string, notes: string): string {
  const v = version.trim();
  if (!/^v\d+\.\d+\.\d+$/.test(v)) throw new DeployError("Version must look like v2.5.0.");

  const latest = db().prepare(
    `SELECT name, size_mb FROM artefacts ORDER BY created_at DESC LIMIT 1`
  ).get() as { name: string; size_mb: number } | undefined;
  const name = latest?.name ?? "mizan-assistant";
  if (db().prepare(`SELECT 1 FROM artefacts WHERE name = ? AND version = ?`).get(name, v)) {
    throw new DeployError(`${name} ${v} is already registered.`);
  }

  const artId = id("art");
  const digest = `sha256:${randomBytes(32).toString("hex")}`;
  const sizeMb = Math.round((latest?.size_mb ?? 9600) + 40 + Math.random() * 200);
  const envs = db().prepare(`SELECT key FROM environments`).all() as { key: EnvKey }[];

  db().transaction(() => {
    db().prepare(
      `INSERT INTO artefacts (id, name, version, digest, size_mb, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(artId, name, v, digest, sizeMb, notes.trim() || "No release notes.", now());
    const ins = db().prepare(
      `INSERT INTO artefact_deployments (id, artefact_id, env_key, state, transport, detail_json, updated_at)
       VALUES (?, ?, ?, 'absent', ?, '{}', ?)`
    );
    for (const e of envs) ins.run(id("dep"), artId, e.key, TRANSPORT[e.key], now());
    audit(actor, "artefact.registered", artId, `${name} ${v} signed and registered`, { digest, sizeMb });
  })();

  return `${name} ${v} registered. Promote it into each environment.`;
}

/** Network promotion (cloud, on-prem), or reactivating a build already inside the enclave. */
export function activate(actor: string, artefactId: string, env: EnvKey): string {
  const d = load(artefactId, env);
  if (d.state === "active") {
    throw new DeployError(`${d.version} is already active in ${ENV_META[env].name}.`);
  }
  if (env === "airgap" && d.state !== "superseded") {
    throw new DeployError(
      "The enclave has no network route. This build must be imported through the data diode."
    );
  }
  return db().transaction(() => goLive(actor, env, d, {}))();
}

/** Diode step 1 — write the signed bundle to removable media on the low side. */
export function diodeExport(actor: string, artefactId: string): string {
  const d = load(artefactId, "airgap");
  if (d.state !== "absent") throw new DeployError(`${d.version} is already ${d.state} for the enclave.`);
  const mediaRef = `MEDIA-${randomBytes(2).toString("hex").toUpperCase()}`;
  save(d.id, "staged", { mediaRef, exportedAt: now(), exportedBy: actor });
  audit(actor, "diode.exported", d.id,
        `${d.name} ${d.version} written to ${mediaRef} at the low-side export station`,
        { mediaRef, digest: d.digest });
  return `${d.version} written to ${mediaRef}. Carry it to the diode.`;
}

/** Diode step 2 — one-way optical transfer into the enclave. */
export function diodeTransfer(actor: string, artefactId: string): string {
  const d = load(artefactId, "airgap");
  if (d.state !== "staged") throw new DeployError("Nothing is waiting at the diode for this build.");
  save(d.id, "importing", { ...d.detail, crossedAt: now(), crossedBy: actor });
  audit(actor, "diode.transferred", d.id,
        `${d.detail.mediaRef} passed the one-way diode into Facility K`,
        { mediaRef: d.detail.mediaRef, version: d.version });
  return `${d.detail.mediaRef} is inside the enclave. Verify its digest before activation.`;
}

/** Diode step 3 — re-hash on the high side, then activate. */
export function diodeVerify(actor: string, artefactId: string): string {
  const d = load(artefactId, "airgap");
  if (d.state !== "importing") throw new DeployError("This build has not crossed the diode yet.");
  // Simulated high-side re-hash of the media contents against the signed manifest.
  const computed = d.digest;
  return db().transaction(() => {
    audit(actor, "diode.verified", d.id,
          `${d.version} re-hashed inside the enclave — digest matches manifest`,
          { mediaRef: d.detail.mediaRef, digest: computed });
    return goLive(actor, "airgap", d, { verifiedAt: now(), verifiedBy: actor, computedDigest: computed });
  })();
}
