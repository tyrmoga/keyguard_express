import cors from "cors"
import { KeyGuard } from "../core"
import { CorsOptions } from "cors"

export function corsMiddleware(kg: KeyGuard, options?: Partial<CorsOptions>) {
  const defaults: CorsOptions = {
    origin(origin, callback) {
      if (!origin) return callback(null, true)
      const orgs = kg.db.listOrganizations()
      const allowed = orgs.flatMap((o) => {
        try {
          const origins = JSON.parse((o as any).allowed_origins || "[]")
          return Array.isArray(origins) ? origins : []
        } catch {
          return []
        }
      })
      callback(null, allowed.length === 0 ? true : allowed.includes(origin))
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-KEY", "X-Admin-Key"],
    credentials: true,
  }
  return cors({ ...defaults, ...options })
}
