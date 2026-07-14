import { Request } from "express"
import { KeyGuardConfig } from "./config"
import { AuthService } from "./services/auth.service"
import { MemoryRateLimitService } from "./services/memory-rate-limit.service"
import { RateLimitService } from "./services/rate-limit.service"
import { KeyGuardDb } from "./db/models"
import { IRateLimitBackend } from "./types"
import { secondsUntilTime } from "./utils"

export class KeyGuard {
  readonly config: KeyGuardConfig
  readonly auth: AuthService
  readonly db: KeyGuardDb
  readonly rateLimiting: IRateLimitBackend

  constructor(config: KeyGuardConfig) {
    this.config = config
    this.auth = new AuthService(config.secretKey)
    this.db = new KeyGuardDb(config.databaseUrl)

    if (config.isRedisEnabled) {
      this.rateLimiting = new RateLimitService(config.redisUrl!)
    } else {
      this.rateLimiting = new MemoryRateLimitService()
    }
  }

  initDb(): void {
    this.db.init()
  }

  blockRequest(request: Request, duration: number | string, scope: "path" | "global" = "path"): Promise<void> {
    const ip = request.ip || request.socket.remoteAddress || "unknown"
    const dSeconds = typeof duration === "number" ? duration : secondsUntilTime(duration)
    const identifier = scope === "global" ? ip : `ip_limit:${ip}:${request.path}`
    return this.rateLimiting.block(identifier, dSeconds)
  }
}
