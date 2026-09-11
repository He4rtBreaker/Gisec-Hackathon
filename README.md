# Mizan — Hybrid Deployment Orchestrator

Mizan routes AI requests across three environments: public cloud, sovereign on-prem, and an air-gapped enclave.
It inspects every prompt and attachment on-prem before anything reaches a model.
It then sends the request to the one environment accredited to hold it, or refuses the request with a reason. Every decision is written to a hash-chained audit ledger.

---

## Run it

- **Requires:** Node 20+ and [Ollama](https://ollama.com) with the model pulled:
  ```bash
  ollama pull gemma4:e2b
  ```
- **Install, seed, start:**
  ```bash
  npm install
  npm run seed   # fresh dataset — wipes all users, threads and the audit ledger
  npm run dev    # http://localhost:3000
  ```
- **Offline without Ollama:** set `MIZAN_PROVIDER=mock` in `.env.local`. Only the detector rules classify, and replies are canned.
- **Optional — NER-backed PII recall:** `docker compose up -d presidio-analyzer` starts [Microsoft Presidio](https://github.com/microsoft/presidio)'s analyzer on loopback (`127.0.0.1:5002`). The classifier calls it alongside the regex detectors to catch identifying information no fixed pattern can (e.g. a name next to an address). It's additive, not required — unreachable is a normal, fully-supported state (see "How a request flows" below).

## Logins

| Identity | Password | Role | Clearance |
|---|---|---|---|
| `admin@mizan.gov.ae` | `admin123` | admin → `/admin` | SECRET |
| `defence@mizan.gov.ae` | `user123` | user | SECRET |
| `analyst@mizan.gov.ae` | `user123` | user | CONFIDENTIAL |
| `public@mizan.gov.ae` | `user123` | user | OFFICIAL |

---

## Stack

- **Next.js 15 (App Router) + React 19 + TypeScript.** One process serves the UI and the API.
- **Tailwind v4.** A light theme built from design tokens.
- **SQLite (`better-sqlite3`).** One file, `mizan.db`. Tables are created from `schema.sql`, and additive migrations run on boot.
- **Ollama (`gemma4:e2b`).** A local model reached over HTTP on `127.0.0.1`, with no API key.
- **Auth.** HMAC-signed session cookies. Passwords use salted SHA-256, which is demo-grade.

## How a request flows

1. The browser posts the prompt and any attachments to `/api/chat`. The server streams progress back as NDJSON.
2. **Inspect (on-prem):**
   - 16 regex detectors set a minimum level, the *floor*.
   - Microsoft Presidio's NER analyzer runs alongside them, if deployed, adding signals rules alone would miss — it can only add to the floor, never the other way round.
   - The local model then adjudicates. It can **raise** the level but never lower it.
3. **Seal:** a thread's level only ever goes up. Routing uses the seal, not just the current turn.
4. **Decide:** the policy engine walks the rules in priority order. The first match wins, and the engine records a full trace.
5. **Dispatch:** the request goes to the chosen environment's own model connection, within its network boundary. The reply streams back.
6. **Record:** the classification, routing decision, message cost, tokens and latency are saved, and an audit entry is written.

The code for this lives in `src/lib/pipeline.ts`. The chat API and the demo runner both use it.

---

## Classification scheme

| Level | Meaning | Examples | May run in |
|---|---|---|---|
| PUBLIC | Releasable | general questions | Cloud, On-Prem, Enclave |
| OFFICIAL | Routine government business | tenders, work emails and phones | On-Prem (Cloud fallback), Enclave |
| CONFIDENTIAL | Personal, financial or commercial data | Emirates ID, passport, IBAN, payroll, health | On-Prem, Enclave |
| SECRET | Defence, intelligence, critical infrastructure | `SECRET //` markings, troop movements | Enclave only |

- **Fails safe.** If the model is down, the detector rules decide alone and the UI marks the result `RULES ONLY`.
- **Attachments are inspected in full.** Only text files are accepted (txt, md, csv, json and similar), up to 3 files of 200 KB each.

## Routing policy

These are the default rules, editable in **Admin → Policies**:

| Priority | Rule | Action |
|---|---|---|
| 5 | Clearance ceiling (level above requester clearance) | REFUSE |
| 8 | No credential material (keys, tokens) | REFUSE |
| 10 | Secret stays sealed | ROUTE → Enclave |
| 20 | Confidential stays onshore | ROUTE → On-Prem |
| 40 | Official prefers on-prem | ROUTE → On-Prem |
| 45 | Official cloud fallback | ROUTE → Cloud |
| 50 | Public goes to cloud | ROUTE → Cloud |
| 99 | Default deny | REFUSE |

- **Two built-in guards run first** and cannot be edited:
  - A pinned target must be accredited for the thread's seal. **A sensitive thread cannot be downgraded.**
  - Only SECRET-cleared users may pin the Enclave.
- **A target must pass every check** before a ROUTE rule is used. If any check fails, the engine falls through to the next rule. The checks:
  - It is accredited for the level.
  - It is online.
  - It has a free slot.
  - It has an active model artefact.
  - Its model connection stays inside its network boundary.

---

## Environments

| | Public Cloud | Sovereign On-Prem | Air-Gapped Enclave |
|---|---|---|---|
| Accredited to | OFFICIAL | CONFIDENTIAL | SECRET |
| Slots | 8 | 4 | 2 |
| Cost / 1k tokens | $0.31 | $0.94 | $1.62 |
| Simulated network hop | 240 ms | 35 ms | 12 ms |
| Network boundary | anywhere | private addresses only | **loopback only** |
| Artefact channel | registry pull · TLS | internal mirror · TLS | data diode · manual import |

- **Each environment has its own model connection.** Settings follow the pattern `MIZAN_PROVIDER_<ENV>` and `OLLAMA_HOST_<ENV>` (see Configuration below).
- **Boundaries are enforced in code.** Each connection's HTTP client refuses hosts outside its boundary. If the Enclave is pointed at a hosted API, it fails closed and the router stops sending work there.
- **Capacity is live.** Running requests occupy slots. An admin can also **reserve** slots from the Overview page to simulate load.

## Model deployments & data diode

The deployments page lives at **Admin → Deployments**.

- **One signed artefact** (`mizan-assistant`) is versioned in all three environments.
- **Cloud and On-Prem:** one-click deploy or roll back.
- **Enclave, three manual steps:**
  1. Export to removable media.
  2. Pass the media through the one-way diode.
  3. Re-hash inside the enclave, compare with the manifest, then activate.
- **Custody:** every step records who performed it and when.
- **A new version supersedes the old one.** The old version stays in place for rollback.
- **Routing depends on deployment.** The router won't use an environment with no active artefact, and each chat answer shows which version served it.

## Audit ledger

The ledger lives at **Admin → Audit ledger**.

- **Everything is logged:** sign-ins, routing decisions, refusals, policy edits, deployments, and environment changes.
- **The ledger is hash-chained.** Each entry stores `SHA-256(previous hash + its own content)`.
- **VERIFY CHAIN** re-hashes the entire ledger and names the first broken entry.
- **Try tampering:**
  ```bash
  sqlite3 mizan.db "UPDATE audit_log SET summary = 'tampered' WHERE rowid = 5"
  ```
  Then click VERIFY CHAIN.

## Projects (knowledge + RAG)

- **Every user has Projects** (sidebar → Projects). A project has a name, a description, instructions and up to 25 text files, each up to 200 KB.
- **Uploads are classified on-prem**, using the same inspector as chat requests.
  - A file above the uploader's clearance is refused.
  - A file containing credentials is refused.
  - Either refusal is logged.
- **To use a project,** pick it with the **Project** pill in the chat composer, or start a chat from the project page. A chat stays bound to the project it has used.
- **How knowledge reaches the model:**
  - **Small projects** (up to 8k characters) go into context whole.
  - **Larger projects** are split into chunks. Each request retrieves the top excerpts using **BM25**, on-prem, before anything is dispatched.
- **Security:** each excerpt carries its file's classification. A chat that retrieves Confidential knowledge is marked Confidential, so it can never reach Public Cloud. The Reasoning panel lists which files and parts were used.

## Admin console

- **Overview:**
  - Live topology showing load, status, bindings, and the Enclave's diode.
  - Controls to change reserved load and take an environment offline.
  - Headline figures, the classification mix, cost by environment, refusals by rule, the detector signals seen, and recent decisions.
  - The **demo runner**.
- **Policies:**
  - A rule editor that warns about unreachable rules and targets that can't hold the material.
  - A **policy simulator** that dry-runs a hypothetical request and shows the full trace.
- **Deployments:** the version matrix, the diode import, and the deployment log.
- **Audit ledger:** filters, search, detail for each entry, and chain verification.

---

## Demo script (about 5 minutes)

1. Sign in as **admin**. The Overview page shows the topology.
2. Click **▶ Run demo sequence**. It runs eight scripted scenarios through the real pipeline:
   - Public goes to Cloud.
   - Official goes to On-Prem.
   - Confidential goes to On-Prem.
   - Secret goes to the Enclave.
   - Secret from an analyst without the clearance is **refused**.
   - A leaked API key is **refused**.
   - A downgrade attempt is **refused**.
   - With On-Prem saturated, Official **falls back to Cloud**.
3. Press **+** on On-Prem until it is full, then take the Enclave offline. Watch the topology change.
4. On **Policies**, simulate CONFIDENTIAL with On-Prem pinned, then with Cloud pinned, and read the trace.
5. On **Deployments**, register `v2.5.0`:
   1. Deploy it to Cloud and On-Prem. The page flags version drift.
   2. Walk it through the diode into the Enclave. All three are back in step.
6. On **Audit ledger**, click **Verify chain**. Tamper with a row using the command above, then verify again.
7. Sign in as **analyst** and open a Confidential thread. **Cloud is locked** in the Routing pill.

## How the deliverables are met

| Requirement | Where |
|---|---|
| Three simulated environments | `environments` table, `src/lib/environments.ts`, network boundaries in `src/lib/llm/provider.ts` |
| Classification scheme and routing policies | `src/lib/classify/`, `src/lib/policy/engine.ts`, Admin → Policies |
| Router with logged decision and justification | `routing_decisions` (full trace) plus the hash-chained `audit_log` |
| Same artefact versioned in all three, with data-diode import | Admin → Deployments, `src/lib/deployments.ts` |
| Blocked request with reason | the chat refusal card and the policy trace |

## Configuration (`.env.local`)

| Variable | Default | Purpose |
|---|---|---|
| `MIZAN_PROVIDER` | `ollama` | `ollama`, `anthropic` or `mock`, for every connection |
| `MIZAN_PROVIDER_<CLOUD\|ONPREM\|AIRGAP\|INSPECTOR>` | — | per-connection override |
| `OLLAMA_HOST`, `OLLAMA_MODEL` | `http://127.0.0.1:11434`, `gemma4:e2b` | add `_<BINDING>` to override one connection |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | — | only allowed on the cloud connection (the boundary rules block it elsewhere) |
| `MIZAN_SECRET` | `dev-secret-change-me` | session cookie signing key |
| `PRESIDIO_URL` | `http://127.0.0.1:5002` | optional NER analyzer for the classifier; unreachable degrades gracefully |

## Key files

- `src/lib/pipeline.ts`: inspect, decide, dispatch, record.
- `src/lib/classify/`: detectors, the Presidio NER adapter, and the model adjudicator.
- `src/lib/policy/engine.ts`: rule evaluation, admission checks and pin guards.
- `src/lib/llm/provider.ts`: model connections and network boundaries.
- `src/lib/environments.ts`: live capacity and status.
- `src/lib/deployments.ts`: artefact lifecycle and the diode.
- `src/lib/audit.ts`: the hash-chained ledger.
- `src/lib/demo.ts`: the scripted scenarios.
- `src/app/admin/*`: the console.
- `src/app/chat/*` and `src/components/*`: the chat.

## Limitations

- **One local model** serves all three environments. The separation between them is real in routing, network boundaries and capacity. Everything else about them is simulated.
- **Attachments are text only.** There is no PDF or Office parsing.
- **Auth is demo-grade.** Passwords use salted SHA-256, and there is no rate limiting.
- **The chain detects edits and deletions** anywhere before the latest entry. Silently cutting entries off the end needs the head hash anchored somewhere outside the database.
