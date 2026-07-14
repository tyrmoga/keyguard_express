import "dotenv/config"
import express, { Request, Response } from "express"
import { KeyGuard, KeyGuardConfig, keyGuardMiddleware, rateLimitByIp } from "../src"
import { createAdminRouter } from "../src/api/admin.router"

// 1. Configure (just a secret key — auto-generated if not set)
const config = new KeyGuardConfig({
  // databaseUrl: "sqlite://keyguard.db",  // default
  // redisUrl: "redis://localhost:6379/0", // optional
  secretKey: "my-secret",
})

const kg = new KeyGuard(config)

const PORT = parseInt(process.env.PORT || "8000", 10)

const app = express()
app.use(express.json())

// 2. Initialize database and seed data
kg.initDb()
seedTestData(kg)

// 3. Protect all routes under /api
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

app.get("/api/data", (req: Request, res: Response) => {
  const key = (req as any).apiKey
  res.json({
    message: "You accessed protected data!",
    your_key_label: key.label,
    scopes: JSON.parse(key.scopes || "[]"),
  })
})

app.get("/api/profile", (req: Request, res: Response) => {
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
  console.log(`\n🚀 KeyGuard is running!`)
  console.log(`   Public:    http://localhost:${PORT}/public`)
  console.log(`   Protected: http://localhost:${PORT}/api/data`)
  console.log(`   Login:     http://localhost:${PORT}/login`)
  console.log(`   Admin:     http://localhost:${PORT}/admin/keys`)
  console.log(`   Docs:      http://localhost:${PORT}/docs\n`)
})

// ── Seed Helper ──

function seedTestData(kg: KeyGuard): void {
  const existingOrgs = kg.db.listOrganizations()
  if (existingOrgs.length > 0) return

  const org = kg.db.createOrganization("Demo Org")

  const [rawKey] = kg.auth.generateApiKey()
  kg.db.createApiKey({
    org_id: org.id,
    label: "demo-key",
    prefix: rawKey.slice(0, 12),
    key_hash: kg.auth.hashKey(rawKey),
    rate_limit_per_minute: 30,
    scopes: ["read", "write"],
  })

  console.log(`\n  🔑 Demo API Key (use this in your requests)`)
  console.log(`  ${rawKey}`)
  console.log(`  curl http://localhost:${PORT}/api/data -H 'X-API-KEY: ${rawKey}'\n`)
}
