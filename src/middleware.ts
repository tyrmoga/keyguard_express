import { Request, Response, NextFunction } from "express"
import { KeyGuard } from "./core"
import { secondsUntilTime } from "./utils"

export function keyGuardMiddleware(kg: KeyGuard, protectedPath = "/api") {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.path.startsWith(protectedPath)) {
      return next()
    }

    const startTime = Date.now()
    const ipAddress = req.ip || req.socket.remoteAddress || "unknown"

    ;(async () => {
      // 1. IP Blacklist Check (Global)
      if (await kg.rateLimiting.isBlocked(ipAddress)) {
        return void res.status(403).json({ detail: "Access denied. Your IP address is blocked." })
      }

      // 2. Extract API Key
      const apiKeyRaw = req.headers["x-api-key"] as string | undefined
      if (!apiKeyRaw) {
        await kg.rateLimiting.trackIpAbuse(ipAddress, kg.config.ipBlockThreshold)
        return void res.status(401).json({ detail: "Missing API Key. Include X-API-KEY header." })
      }

      // 3. Auth Check
      const keyHash = kg.auth.hashKey(apiKeyRaw)
      const keyObj = kg.db.findApiKeyByHash(keyHash)
      const org = keyObj ? kg.db.getOrganization(keyObj.org_id) : undefined

      if (!keyObj || !keyObj.is_active || !org || org.status !== "active") {
        await kg.rateLimiting.trackIpAbuse(ipAddress, kg.config.ipBlockThreshold)
        return void res.status(401).json({ detail: "Invalid or inactive API Key." })
      }

      // 3a. Expiry Check
      if (keyObj.expires_at && new Date(keyObj.expires_at) <= new Date()) {
        return void res.status(401).json({ detail: "API Key has expired." })
      }

      // 3b. Monthly Limit Check
      if (keyObj.monthly_limit) {
        const monthlyUsage = kg.db.getMonthlyUsage(keyObj.id)
        if (monthlyUsage >= keyObj.monthly_limit) {
          return void res.status(429).json({ detail: "Monthly request limit exceeded." })
        }
      }

      // 4. Rate Limiting
      const { limited, remaining } = await kg.rateLimiting.isRateLimited(keyHash, keyObj.rate_limit_per_minute)

      if (limited) {
        res.set("X-RateLimit-Limit", String(keyObj.rate_limit_per_minute))
        res.set("X-RateLimit-Remaining", "0")
        return void res.status(429).json({ detail: "Rate limit exceeded." })
      }

      // 5. Attach key to request
      ;(req as any).apiKey = keyObj
      ;(req as any).organization = org

      // 6. Capture response for logging (deferred — don't block the event loop)
      const originalSend = res.send.bind(res)
      res.send = function (body: any): Response {
        const latency = Date.now() - startTime
        setImmediate(() => {
          kg.db.logUsage(keyObj.id, req.path, req.method, res.statusCode, latency, ipAddress)
          kg.db.updateLastUsed(keyObj.id)
        })

        res.set("X-RateLimit-Limit", String(keyObj.rate_limit_per_minute))
        res.set("X-RateLimit-Remaining", String(remaining))
        return originalSend(body)
      }

      next()
    })()
  }
}

export function rateLimitByIp(
  kg: KeyGuard,
  limit: number,
  window = 60,
  lockout: number | string = 0,
  scope: "path" | "global" = "path"
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = req.ip || req.socket.remoteAddress || "unknown"
    const pathIdentifier = `ip_limit:${ip}:${req.path}`

    if (await kg.rateLimiting.isBlocked(ip)) {
      return void res.status(403).json({ detail: "Access denied. Your IP address is blocked." })
    }

    if (scope === "path" && (await kg.rateLimiting.isBlocked(pathIdentifier))) {
      return void res.status(403).json({ detail: "Access to this specific resource is temporarily blocked." })
    }

    const { limited, remaining } = await kg.rateLimiting.isRateLimited(pathIdentifier, limit, window)

    if (limited) {
      if (lockout) {
        await kg.blockRequest(req, lockout, scope)
      }
      res.set("X-RateLimit-Limit", String(limit))
      res.set("X-RateLimit-Remaining", "0")
      return void res.status(429).json({ detail: "Rate limit exceeded. Please try again later." })
    }

    next()
  }
}
