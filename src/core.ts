import { Request } from "express"
import { KeyGuardConfig } from "./config"
import { AuthService } from "./services/auth.service"
import { MemoryRateLimitService } from "./services/memory-rate-limit.service"
import { HybridRateLimitService } from "./services/hybrid-rate-limit.service"
import { createDb, IDatabaseBackend } from "./db"
import { IRateLimitBackend } from "./types"
import { clientIp, secondsUntilTime } from "./utils"

export class KeyGuard {
  readonly config: KeyGuardConfig
  readonly auth: AuthService
  readonly db: IDatabaseBackend
  readonly rateLimiting: IRateLimitBackend

  constructor(config: KeyGuardConfig) {
    this.config = config
    this.auth = new AuthService(config.secretKey)
    this.db = createDb(config.databaseUrl)

    if (config.isRedisEnabled) {
      this.rateLimiting = new HybridRateLimitService(config.redisUrl!)
    } else {
      this.rateLimiting = new MemoryRateLimitService()
    }
  }

  async initDb(): Promise<void> {
    await this.db.init()
  }

  blockRequest(request: Request, duration: number | string, scope: "path" | "global" = "path"): Promise<void> {
    const ip = clientIp(request)
    const dSeconds = typeof duration === "number" ? duration : secondsUntilTime(duration)
    const identifier = scope === "global" ? ip : `ip_limit:${ip}:${request.path}`
    return this.rateLimiting.block(identifier, dSeconds)
  }

  async shutdown(): Promise<void> {
    await this.db.close()
    if ("disconnect" in this.rateLimiting) {
      await (this.rateLimiting as any).disconnect?.()
    }
  }
}
