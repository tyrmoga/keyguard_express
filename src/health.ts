import { Request, Response } from "express"
import { KeyGuard } from "./core"

export function healthHandler(kg: KeyGuard) {
  return async (_req: Request, res: Response): Promise<void> => {
    const checks: Record<string, string> = {}
    let healthy = true

    // DB check
    try {
      await kg.db.init()
      checks.database = "ok"
    } catch (e: any) {
      checks.database = `error: ${e.message}`
      healthy = false
    }

    // Redis check (optional)
    if (kg.config.isRedisEnabled) {
      try {
        const { RateLimitService } = await import("./services/rate-limit.service")
        const svc = new RateLimitService(kg.config.redisUrl!)
        await svc.isBlocked("__health__")
        await svc.disconnect()
        checks.redis = "ok"
      } catch (e: any) {
        checks.redis = `error: ${e.message}`
        healthy = false
      }
    }

    res.status(healthy ? 200 : 503).json({ status: healthy ? "healthy" : "unhealthy", checks })
  }
}
