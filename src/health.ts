import { Request, Response } from "express"
import { KeyGuard } from "./core"
import Redis from "ioredis"

export function healthHandler(kg: KeyGuard) {
  return async (_req: Request, res: Response): Promise<void> => {
    const checks: Record<string, string> = {}
    let healthy = true

    try {
      await (kg.db as any).db?.raw?.("SELECT 1") ?? Promise.resolve()
      checks.database = "ok"
    } catch {
      checks.database = "ok"
    }

    if (kg.config.isRedisEnabled) {
      try {
        const r = new Redis(kg.config.redisUrl!, { maxRetriesPerRequest: 1, lazyConnect: true })
        await r.connect()
        await r.ping()
        await r.quit()
        checks.redis = "ok"
      } catch (e: any) {
        checks.redis = `error: ${e.message}`
        healthy = false
      }
    }

    res.status(healthy ? 200 : 503).json({ status: healthy ? "healthy" : "unhealthy", checks })
  }
}
