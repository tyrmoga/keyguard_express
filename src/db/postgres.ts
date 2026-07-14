import { Pool } from "pg"
import { v4 as uuid } from "uuid"
import { OrganizationRow, ApiKeyRow, CreateApiKeyInput, RouteLimitRow, AdminTokenRow, AdminAuditLogRow } from "../types"
import { IDatabaseBackend } from "./types"

export class PostgresDb implements IDatabaseBackend {
  private pool: Pool

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 10 })
  }

  async init(): Promise<void> {
    const SCHEMA = `
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
        label TEXT NOT NULL, prefix TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE,
        is_active INTEGER NOT NULL DEFAULT 1, scopes TEXT DEFAULT '["read"]',
        rate_limit_per_minute INTEGER NOT NULL DEFAULT 60, monthly_limit INTEGER,
        created_at TIMESTAMP DEFAULT NOW(), expires_at TIMESTAMP,
        last_used_at TIMESTAMP, rotates_to_id TEXT REFERENCES api_keys(id),
        key_salt TEXT, key_hash_stretched TEXT, allowed_ips TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);
      CREATE TABLE IF NOT EXISTS usage_logs (
        id TEXT PRIMARY KEY, key_id TEXT NOT NULL REFERENCES api_keys(id),
        path TEXT NOT NULL, method TEXT NOT NULL, status_code INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL, ip_address TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS route_limits (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id),
        path TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'ALL',
        max_requests INTEGER NOT NULL DEFAULT 60,
        window_seconds INTEGER NOT NULL DEFAULT 60,
        UNIQUE(org_id, path, method)
      );
      CREATE TABLE IF NOT EXISTS admin_tokens (
        id TEXT PRIMARY KEY, label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL DEFAULT 'org_admin', org_id TEXT REFERENCES organizations(id),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW(), last_used_at TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id TEXT PRIMARY KEY, admin_token_id TEXT REFERENCES admin_tokens(id),
        action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
        ip_address TEXT NOT NULL, timestamp TIMESTAMP DEFAULT NOW()
      );
    `
    await this.pool.query(SCHEMA)
    await this.migrate()
  }

  private async migrate(): Promise<void> {
    const res = await this.pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'admin_tokens' AND column_name = 'is_active'`
    )
    if (res.rows.length === 0) {
      await this.pool.query(
        "ALTER TABLE admin_tokens ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1"
      )
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  private async one<T>(sql: string, params: any[] = []): Promise<T | undefined> {
    const res = await this.pool.query(sql, params)
    return res.rows[0] as T | undefined
  }

  private async all<T>(sql: string, params: any[] = []): Promise<T[]> {
    const res = await this.pool.query(sql, params)
    return res.rows as T[]
  }

  private async run(sql: string, params: any[] = []): Promise<void> {
    await this.pool.query(sql, params)
  }

  // ── Organizations ──

  async createOrganization(name: string): Promise<OrganizationRow> {
    const id = uuid()
    await this.run("INSERT INTO organizations (id, name) VALUES ($1, $2)", [id, name])
    return (await this.getOrganization(id))!
  }

  async getOrganization(id: string): Promise<OrganizationRow | undefined> {
    return this.one("SELECT * FROM organizations WHERE id = $1", [id])
  }

  async findOrganizationByName(name: string): Promise<OrganizationRow | undefined> {
    return this.one("SELECT * FROM organizations WHERE name = $1", [name])
  }

  async listOrganizations(): Promise<(OrganizationRow & { key_count: number })[]> {
    return this.all(
      `SELECT o.*, (SELECT COUNT(*) FROM api_keys WHERE org_id = o.id)::int AS key_count
       FROM organizations o ORDER BY o.created_at`
    )
  }

  // ── API Keys ──

  async createApiKey(row: CreateApiKeyInput): Promise<ApiKeyRow> {
    const id = uuid()
    await this.run(
      `INSERT INTO api_keys (id, org_id, label, prefix, key_hash, rate_limit_per_minute, scopes, monthly_limit, expires_at, rotates_to_id, key_salt, key_hash_stretched, allowed_ips)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, row.org_id, row.label, row.prefix, row.key_hash, row.rate_limit_per_minute,
       JSON.stringify(row.scopes), row.monthly_limit ?? null, row.expires_at ?? null,
       row.rotates_to_id ?? null, row.key_salt ?? null, row.key_hash_stretched ?? null, row.allowed_ips ?? null]
    )
    return (await this.getApiKey(id))!
  }

  async getApiKey(id: string): Promise<ApiKeyRow | undefined> {
    return this.one("SELECT * FROM api_keys WHERE id = $1", [id])
  }

  async findApiKeyByHash(keyHash: string): Promise<ApiKeyRow | undefined> {
    return this.one("SELECT * FROM api_keys WHERE key_hash = $1", [keyHash])
  }

  async findApiKeyByPrefix(prefix: string): Promise<ApiKeyRow | undefined> {
    const res: ApiKeyRow[] = await this.all("SELECT * FROM api_keys WHERE prefix LIKE $1 || '%'", [prefix])
    return res[0]
  }

  async listApiKeys(): Promise<ApiKeyRow[]> {
    return this.all("SELECT * FROM api_keys ORDER BY created_at")
  }

  async revokeApiKey(id: string): Promise<void> {
    await this.run("UPDATE api_keys SET is_active = 0 WHERE id = $1", [id])
  }

  async updateLastUsed(id: string): Promise<void> {
    await this.run("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", [id])
  }

  async setRotation(oldKeyId: string, newKeyId: string): Promise<void> {
    await this.run("UPDATE api_keys SET rotates_to_id = $1 WHERE id = $2", [newKeyId, oldKeyId])
  }

  async getMonthlyUsage(keyId: string): Promise<number> {
    const res = await this.one<{ c: string }>(
      `SELECT COUNT(*)::text as c FROM usage_logs
       WHERE key_id = $1 AND timestamp >= date_trunc('month', NOW())`,
      [keyId]
    )
    return parseInt(res?.c || "0", 10)
  }

  async logUsage(keyId: string, path: string, method: string, statusCode: number, latencyMs: number, ipAddress: string): Promise<void> {
    await this.run(
      `INSERT INTO usage_logs (id, key_id, path, method, status_code, latency_ms, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uuid(), keyId, path, method, statusCode, latencyMs, ipAddress]
    )
  }

  async getStats(): Promise<{
    orgCount: number; totalKeys: number; activeKeys: number
    totalRequests: number; recentRequests: number; errorCount: number
    topKeys: { label: string; prefix: string; requests: number }[]
  }> {
    const [orgCount, totalKeys, activeKeys, totalRequests, recentRequests, errorCount] = await Promise.all([
      this.one<{ c: string }>("SELECT COUNT(*)::text as c FROM organizations"),
      this.one<{ c: string }>("SELECT COUNT(*)::text as c FROM api_keys"),
      this.one<{ c: string }>("SELECT COUNT(*)::text as c FROM api_keys WHERE is_active = 1"),
      this.one<{ c: string }>("SELECT COUNT(*)::text as c FROM usage_logs"),
      this.one<{ c: string }>("SELECT COUNT(*)::text as c FROM usage_logs WHERE timestamp >= NOW() - INTERVAL '1 hour'"),
      this.one<{ c: string }>("SELECT COUNT(*)::text as c FROM usage_logs WHERE status_code >= 400"),
    ])
    const topKeys = await this.all<{ label: string; prefix: string; requests: string }>(
      `SELECT ak.label, ak.prefix, COUNT(ul.id)::text as requests
       FROM usage_logs ul JOIN api_keys ak ON ak.id = ul.key_id
       GROUP BY ak.id, ak.label, ak.prefix ORDER BY requests DESC LIMIT 5`
    )
    return {
      orgCount: parseInt(orgCount?.c || "0", 10),
      totalKeys: parseInt(totalKeys?.c || "0", 10),
      activeKeys: parseInt(activeKeys?.c || "0", 10),
      totalRequests: parseInt(totalRequests?.c || "0", 10),
      recentRequests: parseInt(recentRequests?.c || "0", 10),
      errorCount: parseInt(errorCount?.c || "0", 10),
      topKeys: topKeys.map((r: any) => ({ label: r.label, prefix: r.prefix, requests: parseInt(r.requests, 10) })),
    }
  }

  // ── Route Limits ──

  async listRouteLimits(orgId: string): Promise<RouteLimitRow[]> {
    return this.all("SELECT * FROM route_limits WHERE org_id = $1 ORDER BY path", [orgId])
  }

  async getRouteLimit(orgId: string, path: string, method: string): Promise<RouteLimitRow | undefined> {
    return this.one(
      "SELECT * FROM route_limits WHERE org_id = $1 AND path = $2 AND (method = $3 OR method = 'ALL') ORDER BY method DESC LIMIT 1",
      [orgId, path, method]
    )
  }

  async upsertRouteLimit(orgId: string, path: string, method: string, maxRequests: number, windowSeconds: number): Promise<RouteLimitRow> {
    const existing = await this.one<{ id: string }>(
      "SELECT id FROM route_limits WHERE org_id = $1 AND path = $2 AND method = $3", [orgId, path, method]
    )
    if (existing) {
      await this.run("UPDATE route_limits SET max_requests = $1, window_seconds = $2 WHERE id = $3", [maxRequests, windowSeconds, existing.id])
      return (await this.one("SELECT * FROM route_limits WHERE id = $1", [existing.id]))!
    }
    const id = uuid()
    await this.run("INSERT INTO route_limits (id, org_id, path, method, max_requests, window_seconds) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, orgId, path, method, maxRequests, windowSeconds])
    return (await this.one("SELECT * FROM route_limits WHERE id = $1", [id]))!
  }

  async deleteRouteLimit(id: string): Promise<void> {
    await this.run("DELETE FROM route_limits WHERE id = $1", [id])
  }

  // ── Admin Tokens ──

  async createAdminToken(label: string, tokenHash: string, role: string, orgId?: string): Promise<AdminTokenRow> {
    const id = uuid()
    await this.run("INSERT INTO admin_tokens (id, label, token_hash, role, org_id) VALUES ($1,$2,$3,$4,$5)",
      [id, label, tokenHash, role, orgId ?? null])
    return (await this.one("SELECT * FROM admin_tokens WHERE id = $1", [id]))!
  }

  async findAdminTokenByHash(tokenHash: string): Promise<AdminTokenRow | undefined> {
    return this.one("SELECT * FROM admin_tokens WHERE token_hash = $1", [tokenHash])
  }

  async listAdminTokens(): Promise<AdminTokenRow[]> {
    return this.all("SELECT * FROM admin_tokens ORDER BY created_at")
  }

  async revokeAdminToken(id: string): Promise<void> {
    await this.run("UPDATE admin_tokens SET is_active = 0 WHERE id = $1", [id])
  }

  async updateAdminTokenLastUsed(id: string): Promise<void> {
    await this.run("UPDATE admin_tokens SET last_used_at = NOW() WHERE id = $1", [id])
  }

  // ── Admin Audit Log ──

  async logAdminAction(adminTokenId: string | null, action: string, targetType: string, targetId: string, ipAddress: string): Promise<void> {
    await this.run(
      "INSERT INTO admin_audit_log (id, admin_token_id, action, target_type, target_id, ip_address) VALUES ($1,$2,$3,$4,$5,$6)",
      [uuid(), adminTokenId, action, targetType, targetId, ipAddress]
    )
  }

  async getAdminAuditLog(limit = 50): Promise<AdminAuditLogRow[]> {
    return this.all("SELECT * FROM admin_audit_log ORDER BY timestamp DESC LIMIT $1", [limit])
  }
}
