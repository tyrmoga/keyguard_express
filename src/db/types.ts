import { OrganizationRow, ApiKeyRow, CreateApiKeyInput, RouteLimitRow, AdminTokenRow, AdminAuditLogRow } from "../types"

export interface IDatabaseBackend {
  init(): Promise<void>
  close(): Promise<void>

  createOrganization(name: string): Promise<OrganizationRow>
  getOrganization(id: string): Promise<OrganizationRow | undefined>
  findOrganizationByName(name: string): Promise<OrganizationRow | undefined>
  listOrganizations(): Promise<(OrganizationRow & { key_count: number })[]>

  createApiKey(row: CreateApiKeyInput): Promise<ApiKeyRow>
  getApiKey(id: string): Promise<ApiKeyRow | undefined>
  findApiKeyByHash(keyHash: string): Promise<ApiKeyRow | undefined>
  findApiKeyByPrefix(prefix: string): Promise<ApiKeyRow | undefined>
  listApiKeys(): Promise<ApiKeyRow[]>
  revokeApiKey(id: string): Promise<void>
  updateLastUsed(id: string): Promise<void>
  setRotation(oldKeyId: string, newKeyId: string): Promise<void>
  getMonthlyUsage(keyId: string): Promise<number>

  logUsage(keyId: string, path: string, method: string, statusCode: number, latencyMs: number, ipAddress: string): Promise<void>

  getStats(): Promise<{
    orgCount: number; totalKeys: number; activeKeys: number
    totalRequests: number; recentRequests: number; errorCount: number
    topKeys: { label: string; prefix: string; requests: number }[]
  }>

  listRouteLimits(orgId: string): Promise<RouteLimitRow[]>
  getRouteLimit(orgId: string, path: string, method: string): Promise<RouteLimitRow | undefined>
  upsertRouteLimit(orgId: string, path: string, method: string, maxRequests: number, windowSeconds: number): Promise<RouteLimitRow>
  deleteRouteLimit(id: string): Promise<void>

  createAdminToken(label: string, tokenHash: string, role: string, orgId?: string): Promise<AdminTokenRow>
  findAdminTokenByHash(tokenHash: string): Promise<AdminTokenRow | undefined>
  listAdminTokens(): Promise<AdminTokenRow[]>
  revokeAdminToken(id: string): Promise<void>
  updateAdminTokenLastUsed(id: string): Promise<void>

  logAdminAction(adminTokenId: string | null, action: string, targetType: string, targetId: string, ipAddress: string): Promise<void>
  getAdminAuditLog(limit?: number): Promise<AdminAuditLogRow[]>
}
