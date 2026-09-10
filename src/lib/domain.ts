export type Level = "PUBLIC" | "OFFICIAL" | "CONFIDENTIAL" | "SECRET";
export type EnvKey = "cloud" | "onprem" | "airgap";

export const LEVELS: Level[] = ["PUBLIC", "OFFICIAL", "CONFIDENTIAL", "SECRET"];

/** Higher rank = more sensitive. Used for dominance comparisons. */
export const LEVEL_RANK: Record<Level, number> = {
  PUBLIC: 0,
  OFFICIAL: 1,
  CONFIDENTIAL: 2,
  SECRET: 3,
};

export function maxLevel(a: Level, b: Level): Level {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

export const LEVEL_META: Record<Level, { label: string; blurb: string; token: string }> = {
  PUBLIC: {
    label: "Public",
    blurb: "Releasable without restriction. No personal or operational data.",
    token: "cloud",
  },
  OFFICIAL: {
    label: "Official",
    blurb: "Routine government business. Limited distribution, low harm if exposed.",
    token: "official",
  },
  CONFIDENTIAL: {
    label: "Confidential",
    blurb: "Personal, financial or commercial data. Must remain within sovereign infrastructure.",
    token: "onprem",
  },
  SECRET: {
    label: "Secret",
    blurb: "National security or defence material. Air-gapped execution only.",
    token: "airgap",
  },
};

export const ENV_META: Record<EnvKey, {
  name: string;
  short: string;
  token: string;
  tag: string;
}> = {
  cloud:  { name: "Public Cloud",         short: "CLOUD",   token: "cloud",  tag: "EXTERNAL" },
  onprem: { name: "Sovereign On-Prem",    short: "ON-PREM", token: "onprem", tag: "UAE" },
  airgap: { name: "Air-Gapped Enclave",   short: "ENCLAVE", token: "airgap", tag: "NO WAN" },
};

/**
 * Highest classification each environment is accredited to hold.
 *
 * The `environments` table is the source of truth server-side; this mirror
 * exists so the client can grey out targets it must not offer. The two are
 * kept deliberately in step — see the seed. A client that falls out of date
 * cannot cause a leak, because the policy engine re-checks accreditation
 * before dispatching anything.
 */
export const ENV_MAX_LEVEL: Record<EnvKey, Level> = {
  cloud:  "OFFICIAL",
  onprem: "CONFIDENTIAL",
  airgap: "SECRET",
};

/** Minimum requester clearance needed to target an environment directly. */
export const ENV_CLEARANCE: Record<EnvKey, Level> = {
  cloud:  "PUBLIC",
  onprem: "PUBLIC",
  airgap: "SECRET",
};

/** Whether an environment may lawfully hold material at this level. */
export function envAccepts(env: EnvKey, level: Level): boolean {
  return LEVEL_RANK[ENV_MAX_LEVEL[env]] >= LEVEL_RANK[level];
}
