# How to Use KeyGuard Express

> A drop-in security suite for Express APIs — authentication, rate limiting, abuse prevention, and hardening in one dependency.

---

## Installation

```bash
npm install express keyguard-express better-sqlite3
```

Three packages:
- **express** — your web framework
- **keyguard-express** — this library
- **better-sqlite3** — database for storing keys (SQLite, default)

### For PostgreSQL

```bash
npm install express keyguard-express pg
```

### For distributed rate limiting (Redis)

```bash
npm install express keyguard-express better-sqlite3 ioredis
```

---

## Minimal Setup

```js
import "dotenv/config"
import express from "express"
import { KeyGuard, KeyGuardConfig, keyGuardMiddleware } from "keyguard-express"

const config = new KeyGuardConfig()          // keys auto-generate on first run
const kg = new KeyGuard(config)
await kg.initDb()

const app = express()
app.use(express.json())
app.use(keyGuardMiddleware(kg, "/api"))      // protects all /api routes
app.listen(3000)
```

That's it. Every route under `/api` now requires a valid `X-API-KEY` header. Missing or invalid keys get a 401 response. Rate limits, expiry checks, abuse tracking, and usage logging all happen automatically.

### What happens on first run

1. A `keyguard.db` file is created in your project directory
2. `KG_SECRET_KEY` and `KG_ADMIN_KEY` are automatically generated and saved to `.env`
3. These keys are loaded automatically on subsequent starts

---

## Configuration

### Environment variables

| Variable | Purpose |
|----------|---------|
| `KG_SECRET_KEY` | Hashes API keys (auto-generated) |
| `KG_ADMIN_KEY` | Protects `/admin/*` endpoints (auto-generated) |
| `REDIS_URL` | Enables distributed rate limiting and blocklist sync |

Set these in `.env` or pass them explicitly:

```js
const config = new KeyGuardConfig({
  secretKey: process.env.KG_SECRET_KEY,
  adminKey: process.env.KG_ADMIN_KEY,
})
```

### Config options

```js
const config = new KeyGuardConfig({
  databaseUrl: "sqlite://./data/keyguard.db",        // default
  // databaseUrl: "postgres://user:pass@localhost:5432/db",

  redisUrl: "redis://localhost:6379/0",              // optional

  defaultRateLimitPerMinute: 60,                     // default
  ipBlockThreshold: 100,                              // IPs blocked after this many failures/hour
  rateLimitBackend: "sliding-window",                 // or "token-bucket"
})
```

---

## Protecting Routes

### Require API key for all routes under a path

```js
app.use(keyGuardMiddleware(kg, "/api"))
```

All routes under `/api` require `X-API-KEY` header. Invalid, missing, expired, or rate-limited keys get an error response.

### Public routes (no API key needed)

Mount routes before the middleware:

```js
app.get("/healthz", healthHandler(kg))            // public
app.post("/login", rateLimitByIp(kg, 5, 60), handler) // public, IP rate-limited
app.use(keyGuardMiddleware(kg, "/api"))            // everything below is protected
app.use("/api", router)
```

### Attached request properties

Inside protected route handlers, you can access:

```js
app.get("/api/orders", (req, res) => {
  const { apiKey, organization } = req
  apiKey.label        // the key's label
  apiKey.scopes       // JSON string of allowed scopes
  apiKey.rate_limit_per_minute
  organization.name
  organization.status
})
```

---

## Admin API — Managing Keys

Mount the admin router to manage everything:

```js
import { createAdminRouter } from "keyguard-express"
app.use("/admin", createAdminRouter(kg))
```

All admin requests require the `X-Admin-Key` header containing the value from your `.env`'s `KG_ADMIN_KEY`.

### Create an organization

```bash
curl -X POST http://localhost:3000/admin/orgs \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: $(grep KG_ADMIN_KEY .env | cut -d= -f2)" \
  -d '{"name": "Acme Corp"}'
```

### Create an API key

```bash
curl -X POST http://localhost:3000/admin/keys \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: $(grep KG_ADMIN_KEY .env | cut -d= -f2)" \
  -d '{
    "org_name": "Acme Corp",
    "label": "production",
    "scopes": ["read", "write"],
    "rate_limit_per_minute": 60,
    "monthly_limit": 50000,
    "expires_at": "2027-12-31T23:59:59Z"
  }'
```

The response includes `raw_key` — this is the only time the full key is shown. Save it securely.

### List all keys

```bash
curl http://localhost:3000/admin/keys \
  -H "X-Admin-Key: $(grep KG_ADMIN_KEY .env | cut -d= -f2)"
```

### Revoke a key

```bash
curl -X DELETE http://localhost:3000/admin/keys/<key-id> \
  -H "X-Admin-Key: $(grep KG_ADMIN_KEY .env | cut -d= -f2)"
```

### Key rotation (zero-downtime)

```bash
# 1. Create a new key
# 2. Link old → new key:
curl -X POST http://localhost:3000/admin/keys/<old-key-id>/rotate \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: $(grep KG_ADMIN_KEY .env | cut -d= -f2)" \
  -d '{"target_key_id": "<new-key-id>"}'
```

Both keys work during the transition. The old key returns `X-Key-Deprecated: rotates-to=<new-id>` header. Revoke the old key once consumers have switched.

### Usage statistics

```bash
curl http://localhost:3000/admin/stats \
  -H "X-Admin-Key: $(grep KG_ADMIN_KEY .env | cut -d= -f2)"
```

Returns total organizations, keys, requests, and top keys by usage.

### Admin tokens (scoped access)

```bash
# Owner tokens (created via KG_ADMIN_KEY env var) — full access
# Org_admin tokens — limited to one organization:

curl -X POST http://localhost:3000/admin/admin-tokens \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: $(grep KG_ADMIN_KEY .env | cut -d= -f2)" \
  -d '{"label":"acme-admin","role":"org_admin","org_name":"Acme Corp"}'
```

Use the returned `raw_token` as the `X-Admin-Key` header for org-scoped operations.

### Audit log

```bash
curl http://localhost:3000/admin/audit-log \
  -H "X-Admin-Key: $(grep KG_ADMIN_KEY .env | cut -d= -f2)"
```

Shows all admin actions with timestamp, IP, action type, and target.

---

## Route-Level Guards

### Scope enforcement

```js
import { requireScope } from "keyguard-express"

app.post("/api/orders", requireScope("write"), handler)
app.get("/api/orders", requireScope("read"), handler)
app.put("/api/orders/:id", requireScope("write", "admin"), handler)
```

Keys without the required scope get a 403 response.

### IP rate limiting (no API key needed)

Use for public endpoints like login, signup, or heavy tasks:

```js
import { rateLimitByIp } from "keyguard-express"

// 3 requests/minute, 1-hour lockout on breach
app.post("/login", rateLimitByIp(kg, 3, 60, 3600), handler)

// 2 requests/hour, lockout until 11:59 PM (global, not per-path)
app.post("/signup", rateLimitByIp(kg, 2, 3600, "11:59 PM", "global"), handler)

// 1 request/minute, 1-hour path-scoped lockout
app.post("/heavy-task", rateLimitByIp(kg, 1, 60, 3600, "path"), handler)
```

### Blocking a client manually

```js
app.post("/login", async (req, res) => {
  const user = await authenticate(req.body)
  if (!user) {
    await kg.blockRequest(req, 3600, "global")  // block IP for 1 hour
    return res.status(401).json({ error: "Invalid credentials" })
  }
})
```

### Configuring per-route limits (from database)

```bash
curl -X PUT http://localhost:3000/admin/orgs/<org-id>/route-limits \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: $(grep KG_ADMIN_KEY .env | cut -d= -f2)" \
  -d '{"path":"/api/heavy-task","method":"POST","max_requests":5,"window_seconds":60}'
```

---

## Request Validation

```js
import { validateBody, validateQuery } from "keyguard-express"
import { z } from "zod"

// Body validation
const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(["user", "admin"]).default("user"),
})
app.post("/users", validateBody(CreateUserSchema), handler)

// Query parameter validation
const PaginationSchema = z.object({
  page: z.coerce.number().int().default(1),
  limit: z.coerce.number().int().max(100).default(20),
})
app.get("/items", validateQuery(PaginationSchema), handler)
```

---

## Security Headers & CORS

```js
import { headers, corsMiddleware } from "keyguard-express"

app.use(headers())                     // helmet preset — HSTS, X-Frame-Options, etc.
app.use(corsMiddleware(kg))            // CORS — configure origins via options
app.use(corsMiddleware(kg, {            // with explicit origin
  origin: "https://myapp.com",
  credentials: true,
}))
```

---

## HMAC Webhook Verification

Verify incoming webhooks from external services (payment providers, webhook integrations, etc.):

```js
import { requireHmac } from "keyguard-express"

app.post("/webhook/payments",
  requireHmac({ secret: process.env.WEBHOOK_SECRET }),
  (req, res) => {
    // Payload is verified — process the webhook
    res.json({ received: true })
  })
```

**Signing a request from your client:**

```bash
TIMESTAMP=$(date +%s)
NONCE=$(uuidgen)
PAYLOAD='{"event":"test"}'
SIGNATURE=$(echo -n "$TIMESTAMP.$NONCE.POST./webhook.$PAYLOAD" | \
  openssl dgst -sha256 -hmac "your-secret" | cut -d' ' -f2)

curl -X POST https://api.example.com/webhook \
  -H "Content-Type: application/json" \
  -H "x-signature: $SIGNATURE" \
  -H "x-timestamp: $TIMESTAMP" \
  -H "x-nonce: $NONCE" \
  -d "$PAYLOAD"
```

---

## Alerting Hooks

```js
const config = new KeyGuardConfig({
  onAbuseThreshold: (identifier, ip) => {
    console.warn(`Abuse threshold hit for ${identifier} from ${ip}`)
    // Send to Slack, PagerDuty, etc.
  },
  onKeyExpiringSoon: (key, daysLeft) => {
    console.warn(`Key ${key.label} expires in ${daysLeft} days`)
    // Send reminder email
  },
})
```

---

## IP Allowlisting

Restrict an API key to specific IPs or CIDR ranges:

```bash
curl -X POST http://localhost:3000/admin/keys \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: $(grep KG_ADMIN_KEY .env | cut -d= -f2)" \
  -d '{
    "org_name": "Acme Corp",
    "label": "internal",
    "scopes": ["read"],
    "allowed_ips": "[\"10.0.0.0/8\",\"192.168.1.100\"]"
  }'
```

Requests from IPs outside the allowlist get a 403. When `allowed_ips` is not set, all IPs are accepted.

---

## Production

### Health check

```js
import { healthHandler } from "keyguard-express"

app.get("/healthz", healthHandler(kg))
```

Returns `{"status":"healthy","checks":{"database":"ok"}}` or 503 if database/Redis is down. Mount this BEFORE any auth middleware.

### Graceful shutdown

```js
process.on("SIGTERM", async () => {
  await kg.shutdown()    // closes database and Redis connections
  process.exit(0)
})
process.on("SIGINT", async () => { await kg.shutdown(); process.exit(0) })
```

### PostgreSQL

```js
const config = new KeyGuardConfig({
  databaseUrl: "postgres://user:pass@localhost:5432/mydb",
})
```

Detected automatically — no code changes needed beyond the URL.

### Redis (distributed rate limiting)

```bash
# Set REDIS_URL in .env or pass via config:
const config = new KeyGuardConfig({
  redisUrl: "redis://localhost:6379/0",
})
```

With Redis, IP blocks are synced across all instances. Rate counting uses atomic Redis operations. Falls back to in-memory if Redis is temporarily unavailable.

---

## CLI

For servers without the admin API exposed:

```bash
# Initialize the database
npx keyguard init --db sqlite://./data/keyguard.db

# Create an organization
npx keyguard create-org "Acme Corp" --db sqlite://./data/keyguard.db

# Generate a key
npx keyguard create-key --org "Acme Corp" --label "prod" --db sqlite://./data/keyguard.db

# List keys
npx keyguard list-keys --db sqlite://./data/keyguard.db

# Revoke a key
npx keyguard revoke-key kg_live_abc123 --db sqlite://./data/keyguard.db

# View statistics
npx keyguard stats --db sqlite://./data/keyguard.db
```

---

## Full Example

```js
import "dotenv/config"
import express from "express"
import { z } from "zod"
import {
  KeyGuard, KeyGuardConfig, keyGuardMiddleware,
  createAdminRouter, requireScope, rateLimitByIp,
  headers, corsMiddleware, validateBody, requireHmac,
  healthHandler,
} from "keyguard-express"

const config = new KeyGuardConfig()
const kg = new KeyGuard(config)
await kg.initDb()

const app = express()
app.use(express.json())
app.use(headers())
app.use(corsMiddleware(kg))
app.get("/healthz", healthHandler(kg))
app.post("/login", rateLimitByIp(kg, 5, 60, 3600), handler)

app.use(keyGuardMiddleware(kg, "/api"))
app.use("/admin", createAdminRouter(kg))

app.get("/api/orders", requireScope("read"), handler)
app.post("/api/orders", requireScope("write"), handler)

const ContactSchema = z.object({
  name: z.string().min(1), email: z.string().email()
})
app.post("/api/contact", validateBody(ContactSchema), handler)

app.post("/webhook", requireHmac({ secret: process.env.WEBHOOK_SECRET }), handler)

process.on("SIGTERM", async () => { await kg.shutdown(); process.exit(0) })
process.on("SIGINT", async () => { await kg.shutdown(); process.exit(0) })

app.listen(3000)
```

---

## Common Questions

**Why do I get 401 on every request?** — You're missing the `X-API-KEY` header. Generate a key via the admin API or CLI first.

**My key stopped working** — Check if it expired (`expires_at`) or exceeded its monthly limit (`monthly_limit`). Create a new key if needed.

**How do I make a route public?** — Mount it before `keyGuardMiddleware`. Only routes below the middleware are protected.

**Can I use this without a database?** — No. Keys need to be stored and looked up. SQLite (default) requires no setup — it creates the file automatically.

**Do I need Redis?** — Only if you run multiple server instances. Without Redis, rate limits and IP blocks are per-process.

**How do I report a vulnerability?** — Open an issue on the GitHub repository. Do not disclose vulnerabilities publicly until addressed.
