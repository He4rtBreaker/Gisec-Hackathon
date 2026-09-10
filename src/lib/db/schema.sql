-- Mizan · Hybrid Deployment Orchestrator
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('user','admin')),
  org           TEXT NOT NULL,
  clearance     TEXT NOT NULL CHECK (clearance IN ('PUBLIC','OFFICIAL','CONFIDENTIAL','SECRET')),
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  -- highest classification observed in this thread; pins future routing
  seal_level TEXT NOT NULL DEFAULT 'PUBLIC',
  -- project whose knowledge this thread draws on; fixed once set
  project_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content         TEXT NOT NULL,
  -- routing outcome for this turn
  status          TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','refused','error','pending')),
  env_key         TEXT,
  tokens          INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL NOT NULL DEFAULT 0,
  latency_ms      INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS attachments (
  id           TEXT PRIMARY KEY,
  message_id   TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  mime         TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  content_text TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS classifications (
  id            TEXT PRIMARY KEY,
  message_id    TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  level         TEXT NOT NULL CHECK (level IN ('PUBLIC','OFFICIAL','CONFIDENTIAL','SECRET')),
  confidence    REAL NOT NULL,
  rationale     TEXT NOT NULL,
  signals_json  TEXT NOT NULL DEFAULT '[]',
  inspector     TEXT NOT NULL,
  latency_ms    INTEGER NOT NULL DEFAULT 0,
  -- project knowledge that accompanied the request, if any
  context_json  TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cls_msg ON classifications(message_id);

CREATE TABLE IF NOT EXISTS routing_decisions (
  id                TEXT PRIMARY KEY,
  message_id        TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  classification_id TEXT REFERENCES classifications(id) ON DELETE SET NULL,
  verdict           TEXT NOT NULL CHECK (verdict IN ('ALLOW','REFUSE')),
  env_key           TEXT,
  matched_policy_id TEXT,
  reason            TEXT NOT NULL,
  trace_json        TEXT NOT NULL DEFAULT '[]',
  -- model artefact serving in the chosen environment at dispatch time
  artefact_ref      TEXT,
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_route_msg ON routing_decisions(message_id);

CREATE TABLE IF NOT EXISTS policies (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  priority       INTEGER NOT NULL,
  enabled        INTEGER NOT NULL DEFAULT 1,
  condition_json TEXT NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('ROUTE','REFUSE')),
  env_key        TEXT,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS environments (
  key          TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL,
  region       TEXT NOT NULL,
  capacity     INTEGER NOT NULL,
  in_flight    INTEGER NOT NULL DEFAULT 0,
  -- slots reserved by an operator to simulate pressure from other tenants
  sim_load     INTEGER NOT NULL DEFAULT 0,
  -- simulated network hop from the core to this environment
  net_ms       INTEGER NOT NULL DEFAULT 0,
  cost_per_1k  REAL NOT NULL,
  egress       TEXT NOT NULL,
  max_level    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'online',
  sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS artefacts (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  version    TEXT NOT NULL,
  digest     TEXT NOT NULL,
  size_mb    REAL NOT NULL DEFAULT 0,
  notes      TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS artefact_deployments (
  id           TEXT PRIMARY KEY,
  artefact_id  TEXT NOT NULL REFERENCES artefacts(id) ON DELETE CASCADE,
  env_key      TEXT NOT NULL REFERENCES environments(key) ON DELETE CASCADE,
  state        TEXT NOT NULL CHECK (state IN ('absent','staged','importing','active','superseded')),
  transport    TEXT NOT NULL,
  -- activation record, and for the enclave the data-diode chain of custody
  detail_json  TEXT NOT NULL DEFAULT '{}',
  updated_at   INTEGER NOT NULL,
  UNIQUE (artefact_id, env_key)
);

-- Projects: per-user knowledge bases that can be attached to a chat.
CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_files (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  mime         TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  content_text TEXT NOT NULL,
  -- classified on upload by the on-prem inspector; excerpts inherit it
  level        TEXT NOT NULL,
  signals_json TEXT NOT NULL DEFAULT '[]',
  rationale    TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);

-- Retrieval index: one row per chunk, with its term frequencies for BM25.
CREATE TABLE IF NOT EXISTS project_chunks (
  id          TEXT PRIMARY KEY,
  file_id     TEXT NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  text        TEXT NOT NULL,
  tokens_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_project ON project_chunks(project_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  ts          INTEGER NOT NULL,
  actor       TEXT NOT NULL,
  kind        TEXT NOT NULL,
  subject     TEXT NOT NULL DEFAULT '',
  summary     TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  -- hash chain: each entry commits to its content and to the entry before it
  prev_hash   TEXT,
  hash        TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);
