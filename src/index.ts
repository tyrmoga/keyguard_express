export { KeyGuardConfig } from "./config"
export { KeyGuard } from "./core"
export { keyGuardMiddleware, rateLimitByIp } from "./middleware"
export { AuthService } from "./services/auth.service"
export { MemoryRateLimitService } from "./services/memory-rate-limit.service"
export { RateLimitService } from "./services/rate-limit.service"
export { createAdminRouter } from "./api/admin.router"
export { KeyGuardDb } from "./db/models"

export type {
  KeyGuardConfigOptions,
  OrganizationRow,
  ApiKeyRow,
  CreateApiKeyInput,
  UsageLogRow,
  RateLimitResult,
  IRateLimitBackend,
  OrgResponse,
  KeyResponse,
  StatsResponse,
} from "./types"
