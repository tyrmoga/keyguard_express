# KeyGuard Express

> Express.js port of [keyguard](https://github.com/The-honoured1/keyguard) (Python/FastAPI) — API key authentication, rate limiting, and abuse prevention as drop-in middleware.

This is a **TypeScript fork** of the original Python project. See [`migrations.md`](migrations.md) for the full porting context and architecture decisions.

## Features

- **API Key Auth** — validate `X-API-KEY` header against hashed keys in SQLite
- **Key Expiry** — reject expired keys with 401
- **Monthly Caps** — enforce per-key monthly usage limits (429 when exceeded)
- **Scope Guard** — `requireScope("write")` middleware gates routes by key scopes
- **Key Rotation** — overlapping active keys during rotation window via admin API
- **Rate Limiting** — sliding window via in-memory (default) or Redis backend
- **IP Abuse Detection** — track missing/invalid key attempts, auto-block at threshold
- **IP Blocking** — temporary or time-based blocks (global or per-path)
- **Salted Key Hashing** — per-key PBKDF2-SHA512 with 100k iterations (backward-compatible, old keys keep working)
- **Token Bucket** — burst-friendly rate limiting alongside sliding window
- **Per-Route Limits** — configure `/heavy-task` at 5/min and `/data` at 1000/min from DB
- **IP Allowlisting** — restrict keys to specific IPs or CIDR ranges
- **Distributed Blocklist** — hybrid backend: memory counters + Redis blocklist sync
- **Scoped Admin Roles** — `owner` (full access) and `org_admin` (single org) tokens
- **Admin Audit Log** — every admin action recorded with IP and timestamp
- **Alerting Hooks** — `onAbuseThreshold` and `onKeyExpiringSoon` callbacks
- **PostgreSQL Support** — pluggable backend via `IDatabaseBackend` (SQLite default, Postgres with `postgres://` URL)
- **Health Check** — `GET /healthz` returns DB/Redis status
- **Graceful Shutdown** — `kg.shutdown()` closes connections
- **Reverse Proxy Aware** — `X-Forwarded-For` respected when present
- **Admin API** — manage organizations, keys, stats, and rotations (protected by `X-Admin-Key`)
- **Security Headers** — `app.use(headers())` — helmet preset tuned for APIs
- **CORS** — `app.use(corsMiddleware(kg))` — per-org allowed origins from DB
- **Body Validation** — `validateBody(schema)` / `validateQuery(schema)` with Zod
- **HMAC Signing** — `requireHmac({ secret })` — webhook request verification
- **CLI** — `keyguard init`, `create-org`, `create-key`, `list-keys`, `revoke-key`, `stats`

## Install

```bash
npm install keyguard-express
```

## How to Use in Your Project

### 1. Configure and initialize

`KG_SECRET_KEY` (hashing pepper) and `KG_ADMIN_KEY` (admin auth) auto-generate and persist to `.env` if not set. Or provide them explicitly:

```ts
import "dotenv/config"
import express from "express"
import {
  KeyGuard, KeyGuardConfig, keyGuardMiddleware,
  createAdminRouter, requireScope, rateLimitByIp
} from "keyguard-express"

const config = new KeyGuardConfig({
  // Keys auto-generate if omitted. Set your own:
  // secretKey: process.env.KG_SECRET_KEY,
  // adminKey: process.env.KG_ADMIN_KEY,

  // Optional: databaseUrl: "sqlite://./data/keyguard.db",
  // Optional: redisUrl: "redis://localhost:6379/0",
})
const kg = new KeyGuard(config)
kg.initDb()

const app = express()
app.use(express.json())
```

### 2. Protect routes with API key auth

```ts
// All routes under /api require a valid X-API-KEY header
app.use(keyGuardMiddleware(kg, "/api"))

// Your protected routes receive req.apiKey and req.organization
app.get("/api/orders", (req, res) => {
  const { apiKey, organization } = req as any
  res.json({ org: organization.name, key: apiKey.label })
})
```

### 3. Mount the admin API (key management)

```ts
// Uses X-Admin-Key header for auth (separate from consumer API keys)
app.use("/admin", createAdminRouter(kg))
```

Create an API key:

```bash
curl -X POST http://localhost:3000/admin/keys \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: $(grep KG_ADMIN_KEY .env | cut -d= -f2)" \
  -d '{
    "org_name": "Acme Corp",
    "label": "production",
    "scopes": ["read", "write"],
    "monthly_limit": 50000,
    "expires_at": "2027-01-01T00:00:00Z"
  }'
```

### 4. Enforce scopes per route

```ts
// Keys without the "write" scope get a 403
app.post("/api/orders", requireScope("write"), (req, res) => {
  // ...
})

// Multiple allowed scopes
app.put("/api/orders/:id", requireScope("write", "admin"), handler)
```

### 5. Rate limit by IP (login, signup, heavy endpoints)

```ts
// 3 POST/min to /login, 24h lockout on breach
app.post("/login", rateLimitByIp(kg, 3, 60, 86400), handler)

// 2 POST/3600s to /signup, lockout until 11:59 PM global
app.post("/signup", rateLimitByIp(kg, 2, 3600, "11:59 PM", "global"), handler)

// 1 POST/min to /heavy-task, 1h path-scoped lockout
app.post("/heavy-task", rateLimitByIp(kg, 1, 60, 3600, "path"), handler)
```

### 6. Key rotation (zero-downtime credential rollover)

```ts
// Create new key, then link old → new via admin API:
// POST /admin/keys/<old_key_id>/rotate { "target_key_id": "<new_key_id>" }

// The old key returns X-Key-Deprecated: rotates-to=<new_key_id>
// Both keys authenticate during the rotation window.
// Consumers switch to the new key; revoke the old one when ready:
// DELETE /admin/keys/<old_key_id>
```

### 7. Security headers, CORS, and body validation

```ts
import { headers, corsMiddleware, validateBody, validateQuery } from "keyguard-express"
import { z } from "zod"

// Security headers (helmet preset, CSP disabled for API use)
app.use(headers())

// CORS — per-org origins loaded from DB (falls back to allow-all if none configured)
app.use(corsMiddleware(kg))

// Body validation with Zod schemas
const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(["admin", "user"]).default("user"),
})
app.post("/users", validateBody(CreateUserSchema), handler)

// Query parameter validation
const PaginationSchema = z.object({ page: z.coerce.number().int().min(1).default(1) })
app.get("/items", validateQuery(PaginationSchema), handler)
```

### 8. HMAC-signed webhook verification

```ts
import { requireHmac } from "keyguard-express"

// Verifies X-Signature, X-Timestamp, X-Nonce headers
// Rejects requests with clock skew > 300s (configurable)
app.post("/webhook/payment",
  requireHmac({ secret: process.env.WEBHOOK_SECRET! }),
  (req, res) => {
    // Payload is verified — process the webhook
    res.json({ status: "ok" })
  })
```

To sign a request from your client:

```bash
# Compute the HMAC payload: "{timestamp}.{nonce}.{method}.{path}.{body}"
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

### 9. Token-bucket rate limiting (burst-tolerant)

```ts
import { TokenBucketRateLimitService } from "keyguard-express"

// Use instead of the sliding window for bursty workloads
const { limited, remaining } = await limiter.isRateLimited("key-1", 10, 60)
// Allows bursts up to 10, refills at 10/60 ≈ 0.167 tokens/sec
```

The token bucket is available as a standalone backend. The default `MemoryRateLimitService` (sliding window) is used unless you explicitly construct `TokenBucketRateLimitService`.

### 10. Per-route limits (configured per org)

```bash
# Set a 5 req/min limit on /heavy-task for an org
curl -X PUT http://localhost:3000/admin/orgs/<org-id>/route-limits \
  -H "X-Admin-Key: $(grep KG_ADMIN_KEY .env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"path":"/heavy-task","method":"POST","max_requests":5,"window_seconds":60}'
```

The middleware automatically enforces route limits after the per-key rate limit. Each org has its own independent route limit table.

### 11. IP allowlisting per key

```bash
# Create a key that only works from specific IPs
curl -X POST http://localhost:3000/admin/keys \
  -H "X-Admin-Key: $(grep KG_ADMIN_KEY .env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"org_name":"Acme Corp","label":"internal","allowed_ips":"[\"10.0.0.0/8\",\"192.168.1.100\"]"}'
```

Requests from IPs outside the allowlist get a 403. When `allowed_ips` is not set or empty, all IPs are accepted (backward compatible).

### 12. Distributed blocklist (multi-instance with Redis)

When `REDIS_URL` is configured, KeyGuard uses a **hybrid backend**: rate counting stays in-memory (fast, no Redis overhead per request), but IP blocks are synced via Redis so all instances share the same blocklist. This is automatic — no code changes needed beyond setting the env var.

### 13. Scoped admin tokens (owner vs org_admin)

```bash
# Create an org_admin token scoped to a specific org (owner only)
curl -X POST http://localhost:3000/admin/admin-tokens \
  -H "X-Admin-Key: $(grep KG_ADMIN_KEY .env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"label":"acme-admin","role":"org_admin","org_name":"Acme Corp"}'

# Returns a raw token (one-time display). Use it like the global admin key:
# X-Admin-Key: <raw_token>

# The global KG_ADMIN_KEY always acts as owner (full access).
# org_admin tokens can only manage keys and route limits within their org.
```

### 14. View admin audit log (owner only)

```bash
curl http://localhost:3000/admin/audit-log \
  -H "X-Admin-Key: $(grep KG_ADMIN_KEY .env | cut -d= -f2)"

# Returns recent admin actions with IP, action type, target, and timestamp
```

### 15. Alerting hooks

```ts
const config = new KeyGuardConfig({
  onAbuseThreshold: (identifier, ip) => {
    console.warn(`Abuse threshold hit: ${identifier} from ${ip}`)
    // Send to Slack, PagerDuty, etc.
  },
  onKeyExpiringSoon: (key, daysLeft) => {
    console.warn(`Key ${key.label} expires in ${daysLeft} days`)
    // Send reminder email
  },
})
```

### 16. Block an abusive client

```ts
app.post("/login", async (req, res, next) => {
  const failed = await authenticateUser(req.body)
  if (!failed) return next()
  // Block this IP for 1 hour
  await kg.blockRequest(req, 3600, "global")
  res.status(401).json({ error: "Invalid credentials" })
})
```

## Configuration Reference

| Env var | Config option | Purpose |
|---------|--------------|---------|
| `KG_SECRET_KEY` | `secretKey` | Pepper for API key hashing (separate from admin key) |
| `KG_ADMIN_KEY` | `adminKey` | Authenticates `/admin/*` endpoints |
| — | `databaseUrl` | SQLite path (`sqlite://keyguard.db`) |
| `REDIS_URL` | `redisUrl` | Optional: enables Redis distributed rate limiting |
| — | `defaultRateLimitPerMinute` | Default: `60` |
| — | `ipBlockThreshold` | Default: `100` failures/hour before IP block |

All keys are auto-generated and written to `.env` on first run if not provided.

## CLI (for servers without admin API access)

```bash
# Point at the same database
npx tsx src/cli/index.ts --db sqlite:///data/keyguard.db init
npx tsx src/cli/index.ts --db sqlite:///data/keyguard.db create-org "Acme Corp"
npx tsx src/cli/index.ts --db sqlite:///data/keyguard.db create-key --org "Acme Corp" --label "prod"
npx tsx src/cli/index.ts --db sqlite:///data/keyguard.db list-keys
npx tsx src/cli/index.ts --db sqlite:///data/keyguard.db revoke-key kg_live_abc
npx tsx src/cli/index.ts --db sqlite:///data/keyguard.db stats
```

## Backend Auto-Detection

- **Rate limiting**: No `REDIS_URL` → in-memory sliding window with mutex (single-process); `REDIS_URL` set → ioredis sorted sets (multi-instance)
- **Database**: SQLite via better-sqlite3 (synchronous, single-process). No PostgreSQL in this port

## IP Detection

KeyGuard reads `X-Forwarded-For` when present, falling back to `req.ip` then `req.socket.remoteAddress`. If your Express app sets `app.set('trust proxy', 1)`, `req.ip` provides the real client IP behind nginx, Cloudflare, or an AWS ALB.

See [`issues.md`](issues.md) for the full list of known issues and fix history.

## License

MIT
