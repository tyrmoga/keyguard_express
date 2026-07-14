import Database from "better-sqlite3"
import { v4 as uuid } from "uuid"
import { OrganizationRow, ApiKeyRow, UsageLogRow, CreateApiKeyInput } from "../types"

const SCHEMA = `
CREATE TABLE IF NOT EXISTS organizations (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_keys (
  id                     TEXT PRIMARY KEY,
  org_id                 TEXT NOT NULL REFERENCES organizations(id),
  label                  TEXT NOT NULL,
  prefix                 TEXT NOT NULL,
  key_hash               TEXT NOT NULL UNIQUE,
  is_active              INTEGER NOT NULL DEFAULT 1,
  scopes                 TEXT DEFAULT '["read"]',
  rate_limit_per_minute  INTEGER NOT NULL DEFAULT 60,
  monthly_limit          INTEGER,
  created_at             TEXT DEFAULT (datetime('now')),
  expires_at             TEXT,
  last_used_at           TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS usage_logs (
  id          TEXT PRIMARY KEY,
  key_id      TEXT NOT NULL REFERENCES api_keys(id),
  path        TEXT NOT NULL,
  method      TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  latency_ms  INTEGER NOT NULL,
  ip_address  TEXT NOT NULL,
  timestamp   TEXT DEFAULT (datetime('now'))
);
`

export class KeyGuardDb {
  private db: Database.Database

  constructor(databaseUrl: string) {
    const isSqlite = databaseUrl.startsWith("sqlite")
    if (!isSqlite) {
      throw new Error(`Only sqlite:// is supported in this version. Got: ${databaseUrl}`)
    }
    const dbPath = databaseUrl.replace("sqlite://", "") || "keyguard.db"
    this.db = new Database(dbPath)
    this.db.pragma("journal_mode = WAL")
    this.db.pragma("foreign_keys = ON")
  }

  init(): void {
    this.db.exec(SCHEMA)
  }

  // ── Organizations ──

  createOrganization(name: string): OrganizationRow {
    const id = uuid()
    this.db.prepare("INSERT INTO organizations (id, name) VALUES (?, ?)").run(id, name)
    return this.getOrganization(id)!
  }

  getOrganization(id: string): OrganizationRow | undefined {
    return this.db.prepare("SELECT * FROM organizations WHERE id = ?").get(id) as any
  }

  findOrganizationByName(name: string): OrganizationRow | undefined {
    return this.db.prepare("SELECT * FROM organizations WHERE name = ?").get(name) as any
  }

  listOrganizations(): (OrganizationRow & { key_count: number })[] {
    return this.db
      .prepare(
        `SELECT o.*, (SELECT COUNT(*) FROM api_keys WHERE org_id = o.id) AS key_count
         FROM organizations o ORDER BY o.created_at`
      )
      .all() as any
  }

  // ── API Keys ──

  createApiKey(row: CreateApiKeyInput): ApiKeyRow {
    const id = uuid()
    this.db
      .prepare(
        `INSERT INTO api_keys (id, org_id, label, prefix, key_hash, rate_limit_per_minute, scopes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, row.org_id, row.label, row.prefix, row.key_hash, row.rate_limit_per_minute, JSON.stringify(row.scopes))
    return this.getApiKey(id)!
  }

  getApiKey(id: string): ApiKeyRow | undefined {
    return this.db.prepare("SELECT * FROM api_keys WHERE id = ?").get(id) as any
  }

  findApiKeyByHash(keyHash: string): ApiKeyRow | undefined {
    return this.db.prepare("SELECT * FROM api_keys WHERE key_hash = ?").get(keyHash) as any
  }

  findApiKeyByPrefix(prefix: string): ApiKeyRow | undefined {
    return this.db
      .prepare("SELECT * FROM api_keys WHERE prefix LIKE ? || '%'")
      .get(prefix) as any
  }

  listApiKeys(): ApiKeyRow[] {
    return this.db.prepare("SELECT * FROM api_keys ORDER BY created_at").all() as any
  }

  revokeApiKey(id: string): void {
    this.db.prepare("UPDATE api_keys SET is_active = 0 WHERE id = ?").run(id)
  }

  updateLastUsed(id: string): void {
    this.db
      .prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?")
      .run(id)
  }

  // ── Usage Logs ──

  logUsage(
    keyId: string,
    path: string,
    method: string,
    statusCode: number,
    latencyMs: number,
    ipAddress: string
  ): void {
    const id = uuid()
    this.db
      .prepare(
        `INSERT INTO usage_logs (id, key_id, path, method, status_code, latency_ms, ip_address)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, keyId, path, method, statusCode, latencyMs, ipAddress)
  }

  // ── Stats ──

  getStats(): {
    orgCount: number
    totalKeys: number
    activeKeys: number
    totalRequests: number
    recentRequests: number
    errorCount: number
    topKeys: { label: string; prefix: string; requests: number }[]
  } {
    const orgCount = (this.db.prepare("SELECT COUNT(*) as c FROM organizations").get() as any).c
    const totalKeys = (this.db.prepare("SELECT COUNT(*) as c FROM api_keys").get() as any).c
    const activeKeys = (this.db.prepare("SELECT COUNT(*) as c FROM api_keys WHERE is_active = 1").get() as any).c
    const totalRequests = (this.db.prepare("SELECT COUNT(*) as c FROM usage_logs").get() as any).c

    const d = new Date(Date.now() - 3600 * 1000)
    const pad = (n: number) => String(n).padStart(2, "0")
    const oneHourAgo = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    const recentRequests = (
      this.db.prepare("SELECT COUNT(*) as c FROM usage_logs WHERE timestamp >= ?").get(oneHourAgo) as any
    ).c
    const errorCount = (
      this.db.prepare("SELECT COUNT(*) as c FROM usage_logs WHERE status_code >= 400").get() as any
    ).c

    const topKeys = this.db
      .prepare(
        `SELECT ak.label, ak.prefix, COUNT(ul.id) as requests
         FROM usage_logs ul
         JOIN api_keys ak ON ak.id = ul.key_id
         GROUP BY ak.id, ak.label, ak.prefix
         ORDER BY requests DESC
         LIMIT 5`
      )
      .all() as any

    return { orgCount, totalKeys, activeKeys, totalRequests, recentRequests, errorCount, topKeys }
  }

  close(): void {
    this.db.close()
  }
}
