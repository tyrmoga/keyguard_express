export { KeyGuardConfig } from "./config"
export { KeyGuard } from "./core"
export { keyGuardMiddleware, rateLimitByIp } from "./middleware"
export { requireScope } from "./guards/scopes"
export { headers } from "./guards/headers"
export { corsMiddleware } from "./guards/cors"
export { validateBody, validateQuery, bodyParser } from "./guards/validate"
export { requireHmac } from "./guards/hmac"
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
