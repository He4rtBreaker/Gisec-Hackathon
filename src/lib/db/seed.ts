/* Seed the Mizan demo dataset.  Run with: npm run seed */
import { createHash, randomBytes } from "node:crypto";
import { db, id, now, sealAuditChain } from "./index.ts";

function hash(password: string): string {
  const salt = randomBytes(12).toString("hex");
  return `${salt}$${createHash("sha256").update(`${salt}:${password}`).digest("hex")}`;
}

const conn = db();
const t = now();

// A reseed is a fresh dataset, so the audit ledger starts a fresh chain too.
conn.exec(`DELETE FROM sessions; DELETE FROM users; DELETE FROM environments;
           DELETE FROM policies; DELETE FROM artefact_deployments; DELETE FROM artefacts;
           DELETE FROM audit_log;`);

/* ---- users ------------------------------------------------------------- */
const users = [
  { email: "admin@mizan.gov.ae",  name: "Layla Al Mansoori", role: "admin", org: "Ministry of Finance",  clearance: "SECRET",       pw: "admin123" },
  { email: "analyst@mizan.gov.ae", name: "Omar Haddad",      role: "user",  org: "Ministry of Finance",  clearance: "CONFIDENTIAL", pw: "user123" },
  { email: "defence@mizan.gov.ae", name: "Sara Nouri",       role: "user",  org: "Defence Desk",         clearance: "SECRET",       pw: "user123" },
  { email: "public@mizan.gov.ae",  name: "Yusuf Rahman",     role: "user",  org: "Public Services",      clearance: "OFFICIAL",     pw: "user123" },
];
const insUser = conn.prepare(
  `INSERT INTO users (id, email, name, password_hash, role, org, clearance, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
for (const u of users) {
  insUser.run(id("usr"), u.email, u.name, hash(u.pw), u.role, u.org, u.clearance, t);
}

/* ---- execution environments -------------------------------------------- */
const envs = [
  { key: "cloud",  name: "Public Cloud",       kind: "external", region: "eu-west · multi-AZ",  cap: 8, cost: 0.31, egress: "unrestricted",      max: "OFFICIAL",     order: 0 },
  { key: "onprem", name: "Sovereign On-Prem",  kind: "internal", region: "Abu Dhabi · DC-1",    cap: 4, cost: 0.94, egress: "internal VRF only", max: "CONFIDENTIAL", order: 1 },
  { key: "airgap", name: "Air-Gapped Enclave", kind: "sealed",   region: "Facility K · sealed", cap: 2, cost: 1.62, egress: "none · diode in",   max: "SECRET",       order: 2 },
];
// Simulated network hop from the core: WAN to cloud, LAN to DC-1, same-site to the enclave.
const NET_MS: Record<string, number> = { cloud: 240, onprem: 35, airgap: 12 };
const insEnv = conn.prepare(
  `INSERT INTO environments (key, name, kind, region, capacity, in_flight, sim_load, net_ms, cost_per_1k, egress, max_level, status, sort_order)
   VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, 'online', ?)`
);
for (const e of envs) insEnv.run(e.key, e.name, e.kind, e.region, e.cap, NET_MS[e.key], e.cost, e.egress, e.max, e.order);

/* ---- routing policies (evaluated in priority order, first match wins) ---- */
const policies = [
  { name: "Clearance ceiling",          priority:  5, cond: { exceedsClearance: true },     action: "REFUSE", env: null,
    desc: "A request may not be executed at a classification above the requester's own clearance." },
  { name: "No credential material",     priority:  8, cond: { signals: ["CREDENTIAL"] },    action: "REFUSE", env: null,
    desc: "Keys, tokens and private key material must never be submitted to a model in any environment." },
  { name: "Secret stays sealed",        priority: 10, cond: { level: ["SECRET"] },          action: "ROUTE",  env: "airgap",
    desc: "Anything classified Secret must execute inside the air-gapped enclave. No exceptions." },
  { name: "Confidential stays onshore", priority: 20, cond: { level: ["CONFIDENTIAL"] },    action: "ROUTE",  env: "onprem",
    desc: "Personal, financial and commercial data remains on sovereign on-prem infrastructure." },
  { name: "Official prefers on-prem",   priority: 40, cond: { level: ["OFFICIAL"] },        action: "ROUTE",  env: "onprem",
    desc: "Routine government business defaults to on-prem; falls through to cloud under capacity pressure." },
  { name: "Official cloud fallback",    priority: 45, cond: { level: ["OFFICIAL"] },        action: "ROUTE",  env: "cloud",
    desc: "When on-prem is saturated, Official material may use public cloud." },
  { name: "Public goes to cloud",       priority: 50, cond: { level: ["PUBLIC"] },          action: "ROUTE",  env: "cloud",
    desc: "Unrestricted material uses elastic public cloud for cost efficiency." },
  { name: "Default deny",               priority: 99, cond: { always: true },               action: "REFUSE", env: null,
    desc: "No policy permitted this request in any available environment." },
];
const insPolicy = conn.prepare(
  `INSERT INTO policies (id, name, description, priority, enabled, condition_json, action, env_key, updated_at)
   VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`
);
for (const p of policies) {
  insPolicy.run(id("pol"), p.name, p.desc, p.priority, JSON.stringify(p.cond), p.action, p.env, t);
}

/* ---- model artefact, versioned across all three environments ------------ */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ADMIN = "admin@mizan.gov.ae";
const TRANSPORT = {
  cloud: "registry pull · TLS", onprem: "internal mirror · TLS", airgap: "data diode · manual import",
} as const;
const ENV_NAME = { cloud: "Public Cloud", onprem: "Sovereign On-Prem", airgap: "Air-Gapped Enclave" } as const;

const insArt = conn.prepare(
  `INSERT INTO artefacts (id, name, version, digest, size_mb, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const insDep = conn.prepare(
  `INSERT INTO artefact_deployments (id, artefact_id, env_key, state, transport, detail_json, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const insAudit = conn.prepare(
  `INSERT INTO audit_log (id, ts, actor, kind, subject, summary, detail_json) VALUES (?, ?, ?, ?, ?, ?, '{}')`
);

const releases = [
  { version: "v2.3.0", size: 9420, at: t - 21 * DAY, state: "superseded",
    notes: "Previous release. Retained in every environment for rollback." },
  { version: "v2.4.1", size: 9600, at: t - 3 * DAY, state: "active",
    notes: "Base instruction-tuned assistant. Identical weights in every environment." },
];

let previous: string | null = null;
for (const r of releases) {
  const artId = id("art");
  const digest = `sha256:${randomBytes(32).toString("hex")}`;
  insArt.run(artId, "mizan-assistant", r.version, digest, r.size, r.notes, r.at);
  insAudit.run(id("aud"), r.at, ADMIN, "artefact.registered", artId, `mizan-assistant ${r.version} signed and registered`);

  for (const env of ["cloud", "onprem", "airgap"] as const) {
    const depId = id("dep");
    const live = r.at + (env === "cloud" ? 1 : env === "onprem" ? 2 : 6) * HOUR;
    const detail: Record<string, unknown> = { activatedAt: live, activatedBy: ADMIN };
    if (env === "airgap") {
      const mediaRef = `MEDIA-${randomBytes(2).toString("hex").toUpperCase()}`;
      Object.assign(detail, {
        mediaRef,
        exportedAt: r.at + 3 * HOUR, exportedBy: ADMIN,
        crossedAt:  r.at + 5 * HOUR, crossedBy: ADMIN,
        verifiedAt: live,            verifiedBy: ADMIN, computedDigest: digest,
      });
      insAudit.run(id("aud"), r.at + 3 * HOUR, ADMIN, "diode.exported", depId,
                   `mizan-assistant ${r.version} written to ${mediaRef} at the low-side export station`);
      insAudit.run(id("aud"), r.at + 5 * HOUR, ADMIN, "diode.transferred", depId,
                   `${mediaRef} passed the one-way diode into Facility K`);
      insAudit.run(id("aud"), live - 60_000, ADMIN, "diode.verified", depId,
                   `${r.version} re-hashed inside the enclave — digest matches manifest`);
    }
    insAudit.run(id("aud"), live, ADMIN, "deploy.activated", depId,
                 `mizan-assistant ${r.version} active in ${ENV_NAME[env]}${previous ? ` (replaces ${previous})` : ""}`);
    insDep.run(depId, artId, env, r.state, TRANSPORT[env], JSON.stringify(detail), live);
  }
  previous = r.version;
}

// Seed entries were bulk-inserted; hash them into the ledger's chain.
sealAuditChain(conn);

console.log("Seeded:");
console.log(`  ${users.length} users, ${envs.length} environments, ${policies.length} policies, ${releases.length} artefact versions x 3 deployments`);
console.log("\n  admin@mizan.gov.ae / admin123");
console.log("  analyst@mizan.gov.ae / user123\n");
