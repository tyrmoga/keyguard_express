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

### Quick Start — One import, five lines

```ts
import "dotenv/config"
import express from "express"
import { KeyGuard, KeyGuardConfig, keyGuardMiddleware } from "keyguard-express"

const config = new KeyGuardConfig()                     // auto-generates keys on first run
const kg = new KeyGuard(config)
kg.initDb()                                              // creates SQLite tables + migrations

const app = express()
app.use(express.json())
app.use(keyGuardMiddleware(kg, "/api"))                  // protects all /api routes
app.listen(3000)
```

Run once. On first startup `KG_SECRET_KEY` and `KG_ADMIN_KEY` are generated and persisted to `.env`. On subsequent starts they're loaded automatically. That's it — every route under `/api` now requires a valid `X-API-KEY` header. Invalid/missing keys get 401. Expired keys get 401. Rate-limited keys get 429.

### What You Get Out of the Box

With just `keyGuardMiddleware(kg, "/api")`, every protected request goes through:

1. **IP blocklist check** — blocked IPs get 403
2. **API key extraction** — missing keys get 401
3. **Key lookup** — hashed against the database, invalid keys get 401; inactive orgs get 401
4. **IP allowlisting** — if set on the key, non-matching IPs get 403
5. **Salted hash verification** — PBKDF2-SHA512 check for keys with salt (old keys skip)
6. **Expiry check** — expired keys get 401; keys within 7 days of expiry fire alerting hook
7. **Per-route limits** — org-level DB-configured limits get 429
8. **Monthly cap** — per-key monthly usage counter gets 429
9. **Per-key rate limit** — sliding window (configurable per key) gets 429
10. **Abuse tracking** — missing/invalid key attempts tracked; IP blocked after threshold

Successful requests get `req.apiKey` and `req.organization` attached. The key's `scopes` are available for route-level guards.

### Route-Level Security (opt-in middleware)

**Scope enforcement** — gate routes by the key's declared scopes:

```ts
import { requireScope } from "keyguard-express"

app.get("/api/orders", requireScope("read"), handler)
app.post("/api/orders", requireScope("write"), handler)
```

Keys without the scope get 403. Multiple allowed scopes: `requireScope("write", "admin")`.

**IP rate limiting** — brute-force protection for login, signup, or heavy endpoints (no API key needed — guards by IP):

```ts
import { rateLimitByIp } from "keyguard-express"

app.post("/login", rateLimitByIp(kg, 3, 60, 3600), handler)            // 3/min, 1h lockout
app.post("/signup", rateLimitByIp(kg, 2, 3600, "11:59 PM", "global"), handler)  // time-based lockout
```

**Body validation** — Zod schemas as Express middleware:

```ts
import { validateBody, validateQuery } from "keyguard-express"
import { z } from "zod"

const schema = z.object({ email: z.string().email(), name: z.string().min(1) })
app.post("/contact", validateBody(schema), handler)
app.get("/items", validateQuery(z.object({ page: z.coerce.number().default(1) })), handler)
```

**HMAC webhook verification** — timestamp + nonce + signature with replay protection:

```ts
import { requireHmac } from "keyguard-express"

app.post("/webhook",
  requireHmac({ secret: process.env.WEBHOOK_SECRET! }),
  (req, res) => res.json({ status: "verified" }))
```

**Security headers & CORS** — one-liners:

```ts
import { headers, corsMiddleware } from "keyguard-express"

app.use(headers())          // helmet preset — HSTS, X-Frame-Options, etc.
app.use(corsMiddleware(kg)) // configure origins via options
```

### Admin & Management

Mount the admin router to manage organizations, keys, route limits, admin tokens, and view the audit log:

```ts
import { createAdminRouter } from "keyguard-express"

app.use("/admin", createAdminRouter(kg))
```

| Endpoint | Method | Access | Purpose |
|----------|--------|--------|---------|
| `/admin/orgs` | GET | owner | List organizations |
| `/admin/orgs` | POST | owner | Create organization |
| `/admin/keys` | GET | owner | List all keys |
| `/admin/keys` | POST | owner / org_admin | Create API key (scopes, expiry, monthly limit, IP allowlist) |
| `/admin/keys/<id>/rotate` | POST | owner / org_admin | Link old key → new key for zero-downtime rollover |
| `/admin/keys/<id>` | DELETE | owner / org_admin | Revoke key |
| `/admin/orgs/<id>/route-limits` | PUT | owner / org_admin | Configure per-path rate limits |
| `/admin/admin-tokens` | POST | owner | Create org-scoped admin token |
| `/admin/audit-log` | GET | owner | View admin action history |
| `/admin/stats` | GET | owner | Usage statistics |

**Key rotation** (zero-downtime): create a new key, POST `/admin/keys/<old>/rotate { "target_key_id": "<new>" }`. Both keys authenticate during the transition. The old key returns `X-Key-Deprecated` header. Revoke the old key when consumers have switched.

**CLI** (when admin API isn't exposed):

```bash
npx tsx src/cli/index.ts --db sqlite:///data/keyguard.db init
npx tsx src/cli/index.ts --db sqlite:///data/keyguard.db create-org "Acme"
npx tsx src/cli/index.ts --db sqlite:///data/keyguard.db create-key --org "Acme" --label "prod"
```

### Blocking Abusive Clients

```ts
app.post("/login", async (req, res) => {
  if (await authFailed(req.body)) {
    await kg.blockRequest(req, 3600, "global")  // block IP for 1 hour
    return res.status(401).json({ error: "Invalid" })
  }
})
```

### Alerting Hooks

```ts
const config = new KeyGuardConfig({
  onAbuseThreshold: (ip) => sendSlack(`Abuse: ${ip}`),
  onKeyExpiringSoon: (key, days) => emailAdmin(`${key.label} expires in ${days}d`),
})
```

## Configuration Reference

| Env var | Config option | Purpose |
|---------|--------------|---------|
| `KG_SECRET_KEY` | `secretKey` | Pepper for API key hashing |
| `KG_ADMIN_KEY` | `adminKey` | Authenticates `/admin/*` |
| `REDIS_URL` | `redisUrl` | Enables distributed blocklist + hybrid rate limiting |
| — | `databaseUrl` | `sqlite://keyguard.db` (default) or `postgres://` |
| — | `defaultRateLimitPerMinute` | Default: `60` |
| — | `ipBlockThreshold` | Default: `100` failures/hour before auto-block |

Both keys auto-generate on first run and persist to `.env`.

## Backend Auto-Detection

- **Database**: `sqlite://` → better-sqlite3 (synchronous, single-process). `postgres://` → pg pool (async, multi-instance).
- **Rate limiting**: No Redis → in-memory sliding window. Redis → hybrid: memory for counters, Redis for blocklist sync across instances.

## Design Trade-offs

These are intentional. They aren't bugs — they're the result of prioritizing specific properties over others.

**PBKDF2 verification runs synchronously on the hot path (~50-100ms per request).**
Keys with salt incur 100,000 PBKDF2-SHA512 iterations per authentication. This is the cost of offline cracking resistance: the same work that makes brute-forcing expensive also makes verification slower. Old keys (no salt) skip this step and verify instantly.

**SQLite writes are synchronous and deferred via `setImmediate`.**
`better-sqlite3` is fully synchronous. Usage logging and `last_used_at` updates are deferred to the next event loop tick so the response isn't blocked, but the write itself still occupies the single-threaded event loop for the duration of the DB call (~microseconds per write). For multi-instance deployments where this is a throughput concern, use the Postgres backend (natively async).

**Rate limiting defaults to sliding window, not token bucket.**
The sliding window is strict — exactly N requests per window, no bursts. The `TokenBucketRateLimitService` exists as a separate export for burst-tolerant workloads but must be constructed manually and swapped in. There's no config flag to select it through `KeyGuardConfig`.

**HMAC nonces live in process memory, not Redis.**
Replay-protection nonces are stored in a `Map` scoped to the current Node process. Two instances behind a load balancer won't share nonce state — a replay could succeed against a different instance within the clock-skew window. Acceptable for single-process deployments; for multi-instance, use sticky sessions or accept the gap.

**CORS defaults to permissive.**
`corsMiddleware(kg)` delegates to the `cors` package with no origin restriction. Configure origins via the `options` parameter: `corsMiddleware(kg, { origin: "https://myapp.com" })`.

**IP controls require `trust proxy` behind a reverse proxy.**
`clientIp()` reads `X-Forwarded-For` only when Express's `app.set('trust proxy', ...)` is configured. Without it, `req.ip` (the direct TCP peer) is used, and all clients behind nginx/Cloudflare/LB share one IP. To get real client IPs behind a proxy, call `app.set('trust proxy', 1)` or `app.set('trust proxy', 'loopback')`.

**The default database is SQLite, which doesn't survive multi-instance deployments.**
Two Node processes sharing a SQLite file with the in-memory rate limiter will each have independent rate-limit state and may contend on WAL checkpoints. For multi-instance: use the Postgres backend + Redis.

## IP Detection

Reads `X-Forwarded-For` → `req.ip` → `req.socket.remoteAddress`. If `app.set('trust proxy', 1)` is configured in your Express app, `req.ip` provides the real client IP.

See [`issues.md`](issues.md) for the full issue history and fix log.

## Security

### Threat model

KeyGuard Express is designed for server-to-server API authentication. It assumes:

- The server environment is trusted (secrets in `.env` are not exposed to unauthorized processes).
- Network traffic is encrypted (TLS) — API keys in headers are visible in plaintext over HTTP.
- The database file (SQLite) or Postgres instance is on a trusted, access-controlled filesystem or network.
- Administrative access (the `/admin` endpoints and CLI) is restricted to authorized operators.

It is **not** designed for:

- Browser-based API key storage (keys are shown once and should be stored securely server-side).
- Direct end-user authentication (use OAuth, sessions, or JWTs for user-facing auth).

### How API keys work

- Keys are generated as `kg_live_<43 random base64url chars>` (~256 bits of entropy).
- They are never stored in plaintext. The database stores `SHA-256(key + pepper)` for lookup and `PBKDF2-SHA512(key, salt + pepper)` with 100k iterations for offline-cracking resistance.
- The raw key is returned exactly once — at creation time via the admin API or CLI.
- Keys authenticate via the `X-API-KEY` header. Comparison uses `crypto.timingSafeEqual` against the stretched hash.

### Admin API

- Protected by `X-Admin-Key` header verified with `crypto.timingSafeEqual` against the global admin key or stored admin tokens.
- Scoped admin tokens (`org_admin` role) can manage only their assigned organization.
- All admin actions are logged to `admin_audit_log` with IP and timestamp.
- The global `KG_ADMIN_KEY` is auto-generated on first run and persisted to `.env`.

### Rate limiting and abuse prevention

- Per-key rate limiting uses a sliding window (mutex-clocked in memory, atomic ZSET operations in Redis).
- IP-based rate limiting (`rateLimitByIp`) is available for public endpoints like `/login`.
- IP abuse tracking blocks an IP for 24 hours after exceeding the threshold (default: 100 failures/hour).
- With Redis, blocks are synced across instances (hybrid backend: memory for counters, Redis for blocklist).

### HMAC webhook verification

- Verifies `X-Signature`, `X-Timestamp`, `X-Nonce` headers.
- Rejects requests outside the clock-skew window (default: 300s).
- Nonces are deduplicated within the skew window (in-memory per process).
- Use with external webhook providers or for internal service-to-service signing.

### Reporting vulnerabilities

To report a security vulnerability, open an issue on the GitHub repository or contact the maintainers directly. Do not disclose vulnerabilities publicly until they are addressed.

## License

MIT
