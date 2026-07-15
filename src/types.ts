export interface KeyGuardConfigOptions {
  databaseUrl?: string
  redisUrl?: string | null
  secretKey?: string | null
  adminKey?: string | null
  defaultRateLimitPerMinute?: number
  rateLimitBackend?: "sliding-window" | "token-bucket"
  ipBlockThreshold?: number
  onAbuseThreshold?: (identifier: string, ipAddress: string) => void
  onKeyExpiringSoon?: (key: ApiKeyRow, daysLeft: number) => void
}

export interface OrganizationRow {
  id: string
  name: string
  status: "active" | "suspended"
  created_at: string | null
}

export interface ApiKeyRow {
  id: string
  org_id: string
  label: string
  prefix: string
  key_hash: string
  is_active: boolean
  scopes: string | null
  rate_limit_per_minute: number
  monthly_limit?: number | null
  created_at: string | null
  expires_at?: string | null
  last_used_at?: string | null
  rotates_to_id?: string | null
  key_salt?: string | null
  key_hash_stretched?: string | null
  allowed_ips?: string | null
}

export interface CreateApiKeyInput {
  org_id: string
  label: string
  prefix: string
  key_hash: string
  rate_limit_per_minute: number
  scopes: string[]
  monthly_limit?: number | null
  expires_at?: string | null
  rotates_to_id?: string | null
  key_salt?: string | null
  key_hash_stretched?: string | null
  allowed_ips?: string | null
}

export interface RouteLimitRow {
  id: string
  org_id: string
  path: string
  method: string
  max_requests: number
  window_seconds: number
}

export interface UsageLogRow {
  id: string
  key_id: string
  path: string
  method: string
  status_code: number
  latency_ms: number
  ip_address: string
  timestamp: string | null
}

export interface RateLimitResult {
  limited: boolean
  remaining: number
}

export interface IRateLimitBackend {
  isRateLimited(keyId: string, limit: number, windowSeconds?: number): Promise<RateLimitResult>
  isBlocked(identifier: string): Promise<boolean>
  block(identifier: string, durationSeconds: number): Promise<void>
  trackIpAbuse(ipAddress: string, threshold?: number): Promise<void>
}

export interface OrgResponse {
  id: string
  name: string
  status: string
  created_at: string | null
  key_count: number
}

export interface KeyResponse {
  id: string
  label: string
  prefix: string
  is_active: boolean
  rate_limit_per_minute: number
  scopes: string[]
  org_name: string
  created_at: string | null
  last_used_at: string | null
}

export interface StatsResponse {
  total_organizations: number
  total_keys: number
  active_keys: number
  total_requests: number
  recent_requests_1h: number
  top_keys: { label: string; prefix: string; requests: number }[]
  error_rate: number
}

export interface AdminTokenRow {
  id: string
  label: string
  token_hash: string
  role: "owner" | "org_admin"
  org_id?: string | null
  is_active: boolean
  created_at: string | null
  last_used_at: string | null
}

export interface AdminAuditLogRow {
  id: string
  admin_token_id?: string | null
  action: string
  target_type: string
  target_id: string
  ip_address: string
  timestamp: string | null
}
