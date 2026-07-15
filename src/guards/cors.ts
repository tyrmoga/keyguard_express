import cors from "cors"
import { KeyGuard } from "../core"
import { CorsOptions } from "cors"

export function corsMiddleware(_kg: KeyGuard, options?: CorsOptions) {
  const defaults: CorsOptions = {
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-KEY", "X-Admin-Key"],
    credentials: options?.origin ? true : undefined,
  }
  return cors({ ...defaults, ...options })
}
