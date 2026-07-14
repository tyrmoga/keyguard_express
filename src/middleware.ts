import { Request, Response, NextFunction } from "express"
import * as crypto from "crypto"
import { KeyGuard } from "./core"
import { clientIp, checkIpAllowlist } from "./utils"

export function keyGuardMiddleware(kg: KeyGuard, protectedPath = "/api") {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.path.startsWith(protectedPath)) {
      return next()
    }

    const startTime = Date.now()
    const ipAddress = clientIp(req)

    ;(async () => {
      // 1. IP Blacklist Check (Global)
      if (await kg.rateLimiting.isBlocked(ipAddress)) {
        return void res.status(403).json({ detail: "Access denied. Your IP address is blocked." })
      }

      // 2. Extract API Key
      const apiKeyRaw = req.headers["x-api-key"] as string | undefined
      if (!apiKeyRaw) {
        await kg.rateLimiting.trackIpAbuse(ipAddress, kg.config.ipBlockThreshold)
        if (kg.config.onAbuseThreshold) {
          setImmediate(() => kg.config.onAbuseThreshold!(ipAddress, ipAddress))
        }
        return void res.status(401).json({ detail: "Missing API Key. Include X-API-KEY header." })
      }

      // 3. Auth Check
      const keyHash = kg.auth.hashKey(apiKeyRaw)
      const keyObj = await kg.db.findApiKeyByHash(keyHash)
      const org = keyObj ? await kg.db.getOrganization(keyObj.org_id) : undefined

      if (!keyObj || !keyObj.is_active || !org || org.status !== "active") {
        await kg.rateLimiting.trackIpAbuse(ipAddress, kg.config.ipBlockThreshold)
        if (kg.config.onAbuseThreshold) {
          setImmediate(() => kg.config.onAbuseThreshold!(ipAddress, ipAddress))
        }
        return void res.status(401).json({ detail: "Invalid or inactive API Key." })
      }

      // 3a. IP allowlist check
      if (!checkIpAllowlist(ipAddress, keyObj.allowed_ips)) {
        return void res.status(403).json({ detail: "Access denied. IP not allowed for this key." })
      }

      // 3b. Salted hash verification (backward-compatible: old keys have no salt, skip this step)
      if (keyObj.key_salt) {
        const stretched = kg.auth.stretchKey(apiKeyRaw, keyObj.key_salt)
        const a = Buffer.from(stretched)
        const b = Buffer.from(keyObj.key_hash_stretched!)
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
          await kg.rateLimiting.trackIpAbuse(ipAddress, kg.config.ipBlockThreshold)
          return void res.status(401).json({ detail: "Invalid or inactive API Key." })
        }
      }

      // 3c. Expiry Check (fail closed — unparseable dates treated as expired)
      if (keyObj.expires_at) {
        const expiresAt = new Date(keyObj.expires_at)
        if (isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
          setImmediate(() => kg.db.logUsage(keyObj.id, req.path, req.method, 401, 0, ipAddress))
          return void res.status(401).json({ detail: "API Key has expired." })
        }
        // Alerting: key expiring within 7 days
        if (kg.config.onKeyExpiringSoon) {
          const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / 86400000)
          if (daysLeft <= 7) {
            setImmediate(() => kg.config.onKeyExpiringSoon!(keyObj, daysLeft))
          }
        }
      }

      // 3d. Per-route limit check
      if (org) {
        const routeLimit = await kg.db.getRouteLimit(org.id, req.path, req.method)
        if (routeLimit) {
          const { limited } = await kg.rateLimiting.isRateLimited(`route:${routeLimit.id}`, routeLimit.max_requests, routeLimit.window_seconds)
          if (limited) {
            return void res.status(429).json({ detail: "Route rate limit exceeded." })
          }
        }
      }

      // 4. Monthly Limit Check
      if (keyObj.monthly_limit) {
        const monthlyUsage = await kg.db.getMonthlyUsage(keyObj.id)
        if (monthlyUsage >= keyObj.monthly_limit) {
          setImmediate(() => kg.db.logUsage(keyObj.id, req.path, req.method, 429, 0, ipAddress))
          return void res.status(429).json({ detail: "Monthly request limit exceeded." })
        }
      }

      // 5. Rate Limiting
      const { limited, remaining } = await kg.rateLimiting.isRateLimited(keyHash, keyObj.rate_limit_per_minute)

      if (limited) {
        setImmediate(() => kg.db.logUsage(keyObj.id, req.path, req.method, 429, 0, ipAddress))
        res.set("X-RateLimit-Limit", String(keyObj.rate_limit_per_minute))
        res.set("X-RateLimit-Remaining", "0")
        return void res.status(429).json({ detail: "Rate limit exceeded." })
      }

      // 6. Attach key to request
      ;(req as any).apiKey = keyObj
      ;(req as any).organization = org

      // 6a. Deprecation header if key is being rotated
      if (keyObj.rotates_to_id) {
        res.set("X-Key-Deprecated", `rotates-to=${keyObj.rotates_to_id}`)
      }

      // 7. Capture response for logging (deferred — don't block the event loop)
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
    })().catch((err) => {
      if (!res.headersSent) {
        res.status(500).json({ detail: "Internal server error." })
      }
      console.error("keyGuardMiddleware error:", err)
    })
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
    const ip = clientIp(req)
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
