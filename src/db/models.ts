import Database from "better-sqlite3"
import { v4 as uuid } from "uuid"
import { OrganizationRow, ApiKeyRow, UsageLogRow, CreateApiKeyInput, RouteLimitRow, AdminTokenRow, AdminAuditLogRow } from "../types"
import { IDatabaseBackend } from "./types"

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
  last_used_at           TEXT,
  rotates_to_id          TEXT REFERENCES api_keys(id)
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

CREATE TABLE IF NOT EXISTS route_limits (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organizations(id),
  path           TEXT NOT NULL,
  method         TEXT NOT NULL DEFAULT 'ALL',
  max_requests   INTEGER NOT NULL DEFAULT 60,
  window_seconds INTEGER NOT NULL DEFAULT 60,
  UNIQUE(org_id, path, method)
);

CREATE TABLE IF NOT EXISTS admin_tokens (
  id           TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  role         TEXT NOT NULL DEFAULT 'org_admin' CHECK(role IN ('owner', 'org_admin')),
  org_id       TEXT REFERENCES organizations(id),
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT DEFAULT (datetime('now')),
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id             TEXT PRIMARY KEY,
  admin_token_id TEXT REFERENCES admin_tokens(id),
  action         TEXT NOT NULL,
  target_type    TEXT NOT NULL,
  target_id      TEXT NOT NULL,
  ip_address     TEXT NOT NULL,
  timestamp      TEXT DEFAULT (datetime('now'))
);
`

export class KeyGuardDb implements IDatabaseBackend {
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

  private migrate(): void {
    const columns = this.db.pragma("table_info(api_keys)") as any[]
    const hasColumn = (name: string) => columns.some((c: any) => c.name === name)

    if (!hasColumn("rotates_to_id")) {
      this.db.exec("ALTER TABLE api_keys ADD COLUMN rotates_to_id TEXT REFERENCES api_keys(id)")
    }
    if (!hasColumn("key_salt")) {
      this.db.exec("ALTER TABLE api_keys ADD COLUMN key_salt TEXT")
    }
    if (!hasColumn("key_hash_stretched")) {
      this.db.exec("ALTER TABLE api_keys ADD COLUMN key_hash_stretched TEXT")
    }
    if (!hasColumn("allowed_ips")) {
      this.db.exec("ALTER TABLE api_keys ADD COLUMN allowed_ips TEXT")
    }
    if (!hasColumn("is_active")) {
      const adminCols = this.db.pragma("table_info(admin_tokens)") as any[]
      if (!adminCols.some((c: any) => c.name === "is_active")) {
        this.db.exec("ALTER TABLE admin_tokens ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1")
      }
    }
  }

  async init(): Promise<void> {
    this.db.exec(SCHEMA)
    this.migrate()
  }

  async createOrganization(name: string): Promise<OrganizationRow> {
    const id = uuid()
    this.db.prepare("INSERT INTO organizations (id, name) VALUES (?, ?)").run(id, name)
    return (await this.getOrganization(id))!
  }

  async getOrganization(id: string): Promise<OrganizationRow | undefined> {
    return this.db.prepare("SELECT * FROM organizations WHERE id = ?").get(id) as any
  }

  async findOrganizationByName(name: string): Promise<OrganizationRow | undefined> {
    return this.db.prepare("SELECT * FROM organizations WHERE name = ?").get(name) as any
  }

  async listOrganizations(): Promise<(OrganizationRow & { key_count: number })[]> {
    return this.db
      .prepare(`SELECT o.*, (SELECT COUNT(*) FROM api_keys WHERE org_id = o.id) AS key_count FROM organizations o ORDER BY o.created_at`)
      .all() as any
  }

  async createApiKey(row: CreateApiKeyInput): Promise<ApiKeyRow> {
    const id = uuid()
    this.db
      .prepare(`INSERT INTO api_keys (id, org_id, label, prefix, key_hash, rate_limit_per_minute, scopes, monthly_limit, expires_at, rotates_to_id, key_salt, key_hash_stretched, allowed_ips) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, row.org_id, row.label, row.prefix, row.key_hash, row.rate_limit_per_minute, JSON.stringify(row.scopes), row.monthly_limit ?? null, row.expires_at ?? null, row.rotates_to_id ?? null, row.key_salt ?? null, row.key_hash_stretched ?? null, row.allowed_ips ?? null)
    return (await this.getApiKey(id))!
  }

  async setRotation(oldKeyId: string, newKeyId: string): Promise<void> {
    this.db.prepare("UPDATE api_keys SET rotates_to_id = ? WHERE id = ?").run(newKeyId, oldKeyId)
  }

  async getMonthlyUsage(keyId: string): Promise<number> {
    const row = this.db.prepare("SELECT COUNT(*) as c FROM usage_logs WHERE key_id = ? AND timestamp >= date('now', 'start of month', '0 months')").get(keyId) as any
    return row?.c ?? 0
  }

  async getApiKey(id: string): Promise<ApiKeyRow | undefined> {
    return this.db.prepare("SELECT * FROM api_keys WHERE id = ?").get(id) as any
  }

  async findApiKeyByHash(keyHash: string): Promise<ApiKeyRow | undefined> {
    return this.db.prepare("SELECT * FROM api_keys WHERE key_hash = ?").get(keyHash) as any
  }

  async findApiKeyByPrefix(prefix: string): Promise<ApiKeyRow | undefined> {
    return this.db.prepare("SELECT * FROM api_keys WHERE prefix LIKE ? || '%'").get(prefix) as any
  }

  async listApiKeys(): Promise<ApiKeyRow[]> {
    return this.db.prepare("SELECT * FROM api_keys ORDER BY created_at").all() as any
  }

  async revokeApiKey(id: string): Promise<void> {
    this.db.prepare("UPDATE api_keys SET is_active = 0 WHERE id = ?").run(id)
  }

  async updateLastUsed(id: string): Promise<void> {
    this.db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(id)
  }

  async logUsage(keyId: string, path: string, method: string, statusCode: number, latencyMs: number, ipAddress: string): Promise<void> {
    this.db.prepare("INSERT INTO usage_logs (id, key_id, path, method, status_code, latency_ms, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)").run(uuid(), keyId, path, method, statusCode, latencyMs, ipAddress)
  }

  async getStats(): Promise<{ orgCount: number; totalKeys: number; activeKeys: number; totalRequests: number; recentRequests: number; errorCount: number; topKeys: { label: string; prefix: string; requests: number }[] }> {
    const orgCount = (this.db.prepare("SELECT COUNT(*) as c FROM organizations").get() as any).c
    const totalKeys = (this.db.prepare("SELECT COUNT(*) as c FROM api_keys").get() as any).c
    const activeKeys = (this.db.prepare("SELECT COUNT(*) as c FROM api_keys WHERE is_active = 1").get() as any).c
    const totalRequests = (this.db.prepare("SELECT COUNT(*) as c FROM usage_logs").get() as any).c
    const d = new Date(Date.now() - 3600 * 1000)
    const pad = (n: number) => String(n).padStart(2, "0")
    const oneHourAgo = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
    const recentRequests = (this.db.prepare("SELECT COUNT(*) as c FROM usage_logs WHERE timestamp >= ?").get(oneHourAgo) as any).c
    const errorCount = (this.db.prepare("SELECT COUNT(*) as c FROM usage_logs WHERE status_code >= 400").get() as any).c
    const topKeys = this.db.prepare("SELECT ak.label, ak.prefix, COUNT(ul.id) as requests FROM usage_logs ul JOIN api_keys ak ON ak.id = ul.key_id GROUP BY ak.id, ak.label, ak.prefix ORDER BY requests DESC LIMIT 5").all() as any
    return { orgCount, totalKeys, activeKeys, totalRequests, recentRequests, errorCount, topKeys }
  }

  async listRouteLimits(orgId: string): Promise<RouteLimitRow[]> {
    return this.db.prepare("SELECT * FROM route_limits WHERE org_id = ? ORDER BY path").all(orgId) as any
  }

  async getRouteLimit(orgId: string, path: string, method: string): Promise<RouteLimitRow | undefined> {
    return this.db.prepare("SELECT * FROM route_limits WHERE org_id = ? AND path = ? AND (method = ? OR method = 'ALL') ORDER BY method DESC LIMIT 1").get(orgId, path, method) as any
  }

  async upsertRouteLimit(orgId: string, path: string, method: string, maxRequests: number, windowSeconds: number): Promise<RouteLimitRow> {
    const existing = this.db.prepare("SELECT id FROM route_limits WHERE org_id = ? AND path = ? AND method = ?").get(orgId, path, method) as any
    if (existing) {
      this.db.prepare("UPDATE route_limits SET max_requests = ?, window_seconds = ? WHERE id = ?").run(maxRequests, windowSeconds, existing.id)
      return this.db.prepare("SELECT * FROM route_limits WHERE id = ?").get(existing.id) as any
    }
    const id = uuid()
    this.db.prepare("INSERT INTO route_limits (id, org_id, path, method, max_requests, window_seconds) VALUES (?, ?, ?, ?, ?, ?)").run(id, orgId, path, method, maxRequests, windowSeconds)
    return this.db.prepare("SELECT * FROM route_limits WHERE id = ?").get(id) as any
  }

  async deleteRouteLimit(id: string): Promise<void> {
    this.db.prepare("DELETE FROM route_limits WHERE id = ?").run(id)
  }

  async createAdminToken(label: string, tokenHash: string, role: string, orgId?: string): Promise<AdminTokenRow> {
    const id = uuid()
    this.db.prepare("INSERT INTO admin_tokens (id, label, token_hash, role, org_id) VALUES (?, ?, ?, ?, ?)").run(id, label, tokenHash, role, orgId ?? null)
    return this.db.prepare("SELECT * FROM admin_tokens WHERE id = ?").get(id) as any
  }

  async findAdminTokenByHash(tokenHash: string): Promise<AdminTokenRow | undefined> {
    return this.db.prepare("SELECT * FROM admin_tokens WHERE token_hash = ?").get(tokenHash) as any
  }

  async listAdminTokens(): Promise<AdminTokenRow[]> {
    return this.db.prepare("SELECT * FROM admin_tokens ORDER BY created_at").all() as any
  }

  async revokeAdminToken(id: string): Promise<void> {
    this.db.prepare("UPDATE admin_tokens SET is_active = 0 WHERE id = ?").run(id)
  }

  async updateAdminTokenLastUsed(id: string): Promise<void> {
    this.db.prepare("UPDATE admin_tokens SET last_used_at = datetime('now') WHERE id = ?").run(id)
  }

  async logAdminAction(adminTokenId: string | null, action: string, targetType: string, targetId: string, ipAddress: string): Promise<void> {
    this.db.prepare("INSERT INTO admin_audit_log (id, admin_token_id, action, target_type, target_id, ip_address) VALUES (?, ?, ?, ?, ?, ?)").run(uuid(), adminTokenId, action, targetType, targetId, ipAddress)
  }

  async getAdminAuditLog(limit = 50): Promise<AdminAuditLogRow[]> {
    return this.db.prepare("SELECT * FROM admin_audit_log ORDER BY timestamp DESC LIMIT ?").all(limit) as any
  }

  async close(): Promise<void> {
    this.db.close()
  }
}
