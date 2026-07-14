import "dotenv/config"
import express, { Request, Response } from "express"
import { z } from "zod"
import {
  KeyGuard, KeyGuardConfig, keyGuardMiddleware, rateLimitByIp,
  requireScope, headers, corsMiddleware, validateBody, requireHmac,
  healthHandler,
} from "../src"
import { createAdminRouter } from "../src/api/admin.router"

// 1. Configure (keys auto-generated and persisted to .env if not provided)
const config = new KeyGuardConfig({
  // databaseUrl: "sqlite://keyguard.db",  // default
  // redisUrl: "redis://localhost:6379/0", // optional
})

const kg = new KeyGuard(config)

const PORT = parseInt(process.env.PORT || "8000", 10)

const app = express()
app.use(express.json({ limit: "10kb" }))

// Tier 2: Security headers + CORS (opt-in Express hardening)
app.use(headers())
app.use(corsMiddleware(kg))

// 2. Initialize database and seed data
;(async () => {
  await kg.initDb()
  await seedTestData(kg)
})()

// 3. Health check (outside auth — for load balancers)
app.get("/healthz", healthHandler(kg))

// 4. Protect all routes under /api
app.use(keyGuardMiddleware(kg, "/api"))

// 4. Mount admin router
app.use("/admin", createAdminRouter(kg))

// 5. Routes
app.get("/public", (_req: Request, res: Response) => {
  res.json({ message: "This is public data. No API key needed." })
})

app.post("/login", rateLimitByIp(kg, 3, 60, 86400), (_req: Request, res: Response) => {
  res.json({ message: "Login successful! (Allowed by IP rate limit)" })
})

app.post("/signup", rateLimitByIp(kg, 2, 3600, "11:59 PM", "global"), (_req: Request, res: Response) => {
  res.json({ message: "Signup successful! (Allowed by strict IP rate limit)" })
})

app.post("/heavy-task", rateLimitByIp(kg, 1, 60, 3600, "path"), (_req: Request, res: Response) => {
  res.json({ message: "Heavy task completed successfully!" })
})

// Tier 2: Body validation with Zod
const ContactSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  message: z.string().min(1).max(1000),
})
app.post("/contact", validateBody(ContactSchema), (req: Request, res: Response) => {
  res.json({ received: req.body })
})

// Tier 2: HMAC-signed webhook endpoint
app.post("/webhook",
  requireHmac({ secret: config.secretKey }),
  (req: Request, res: Response) => {
    res.json({ status: "verified", payload: req.body })
  })

app.get("/api/data", requireScope("read"), (req: Request, res: Response) => {
  const key = (req as any).apiKey
  res.json({
    message: "You accessed protected data!",
    your_key_label: key.label,
    scopes: JSON.parse(key.scopes || "[]"),
  })
})

app.get("/api/profile", requireScope("read"), (req: Request, res: Response) => {
  const key = (req as any).apiKey
  res.json({
    key_id: key.id,
    org_id: key.org_id,
    label: key.label,
    rate_limit: key.rate_limit_per_minute,
    scopes: JSON.parse(key.scopes || "[]"),
  })
})

app.listen(PORT, () => {
  console.log(`\nKeyGuard is running!`)
  console.log(`   Public:    http://localhost:${PORT}/public`)
  console.log(`   Protected: http://localhost:${PORT}/api/data`)
  console.log(`   Login:     http://localhost:${PORT}/login`)
  console.log(`   Admin:     http://localhost:${PORT}/admin/keys`)
  console.log(`   Docs:      http://localhost:${PORT}/docs\n`)
})

// Graceful shutdown
process.on("SIGTERM", async () => { console.log("\nShutting down..."); await kg.shutdown(); process.exit(0) })
process.on("SIGINT", async () => { console.log("\nShutting down..."); await kg.shutdown(); process.exit(0) })

// ── Seed Helper ──

async function seedTestData(kg: KeyGuard): Promise<void> {
  const existingOrgs = await kg.db.listOrganizations()
  if (existingOrgs.length > 0) return

  const org = await kg.db.createOrganization("Demo Org")

  const [rawKey, keyHash, keySalt, stretchedHash] = kg.auth.generateApiKey()
  await kg.db.createApiKey({
    org_id: org.id,
    label: "demo-key",
    prefix: rawKey.slice(0, 20),
    key_hash: keyHash,
    rate_limit_per_minute: 30,
    scopes: ["read", "write"],
    key_salt: keySalt,
    key_hash_stretched: stretchedHash,
  })

  console.log(`\n  🔑 Demo API Key (use this in your requests)`)
  console.log(`  ${rawKey}`)
  console.log(`  curl http://localhost:${PORT}/api/data -H 'X-API-KEY: ${rawKey}'\n`)
}
