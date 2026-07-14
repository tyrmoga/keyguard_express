import { Request, Response } from "express"
import { KeyGuard } from "./core"

export function healthHandler(kg: KeyGuard) {
  return async (_req: Request, res: Response): Promise<void> => {
    const checks: Record<string, string> = {}
    let healthy = true

    try {
      await kg.db.getOrganization("__health__")
      checks.database = "ok"
    } catch (e: any) {
      checks.database = `error: ${e.message}`
      healthy = false
    }

    if (kg.config.isRedisEnabled) {
      try {
        const redis = (kg.rateLimiting as any).redis
        if (redis) {
          await redis.ping()
        }
        checks.redis = "ok"
      } catch (e: any) {
        checks.redis = `error: ${e.message}`
        healthy = false
      }
    }

    res.status(healthy ? 200 : 503).json({ status: healthy ? "healthy" : "unhealthy", checks })
  }
}
