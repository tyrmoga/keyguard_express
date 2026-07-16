# KeyGuard Express

> Express.js port of [keyguard](https://github.com/The-honoured1/keyguard) (Python/FastAPI) — API key authentication, rate limiting, and abuse prevention as drop-in middleware.

📖 **See [`HOW_TO_USE.md`](HOW_TO_USE.md) for full usage examples, curl/Postman guides, and configuration reference.**

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

KeyGuard Express is a **drop-in security suite** for your Express API. It handles authentication, authorization, rate limiting, abuse prevention, and webhook verification — all in one dependency. You pair it with your existing user auth layer (Passport.js, NextAuth, OAuth, sessions, JWTs). They handle users; KeyGuard handles machines.

### How API keys work

Keys are credentials for **programmatic access** — your backend services, CI/CD pipelines, or third-party integrations call your API with `X-API-KEY: <key>`. The key is generated as `kg_live_<43 random base64url chars>` (~256 bits of entropy), never stored in plaintext, and returned exactly once at creation. The database stores `SHA-256(key + pepper)` for lookup and `PBKDF2-SHA512(key, salt + pepper)` with 100k iterations for offline-cracking resistance. Comparison uses `crypto.timingSafeEqual`.

For **user-facing routes** (login form, React SPA, mobile app), you don't use API keys at all. The pattern is:

```
React POSTs credentials → Your backend authenticates the user →
Your backend attaches X-API-KEY to call your internal API
```

The `/login` endpoint itself is a **public route** — protect it against brute-force with `rateLimitByIp(kg, 5, 60, 3600)`, no API key required from the client.

### Threat model assumptions

**"The server environment is trusted"** means KeyGuard relies on standard server-hardening practices outside the library's scope: restricted file permissions on `.env`, no debug endpoints exposing config, no accidental `console.log` of secrets. The library never writes secrets to logs — the raw key is shown exactly once at creation (admin API response or CLI output), never echoed on subsequent requests. The `console.warn` banner for auto-generated keys prints to stderr during startup, not in request-response logging.

**"Network traffic is encrypted (TLS)"** means API keys in the `X-API-KEY` header are visible in plaintext to anyone on the network without HTTPS. KeyGuard does not enforce TLS — that's your reverse proxy or Express's job (`https.createServer`, nginx, Cloudflare). The library ships a helmet preset via `app.use(headers())` that sets `Strict-Transport-Security` (HSTS) to force TLS at the browser level.

**"The database is on a trusted filesystem or network"** means the SQLite file or Postgres instance stores key hashes — an attacker with DB access can read labels, org names, and usage patterns, but cracking an API key's PBKDF2 hash with 100k iterations is computationally expensive even with the pepper. The library assumes you control database access. For Postgres, use a dedicated user with least-privilege credentials.

**"Admin access is restricted to authorized operators"** means the global `KG_ADMIN_KEY` is auto-generated with 256 bits of entropy and verified with timing-safe comparison. Scoped `org_admin` tokens confine management to a single org. All admin actions are logged to `admin_audit_log`. No endpoint is exposed unauthenticated. But if the `KG_ADMIN_KEY` or an admin token leaks, an attacker can create unlimited API keys — guard the admin endpoints like any other credential.

**"API keys must not be embedded in client-side code"** means your React, mobile, or desktop app should never carry an API key — it's visible in DevTools, network inspectors, decompiled bundles, and source maps. Keys live in server-side environment variables or secret managers. Your frontend authenticates through your user auth layer; your backend attaches the API key when calling downstream services.

### Abuse prevention

- Per-key rate limiting uses a sliding window (mutex-clocked in memory, atomic ZSET operations in Redis).
- IP-based rate limiting (`rateLimitByIp`) is available for public endpoints like `/login`.
- IP abuse tracking blocks an IP for 24 hours after exceeding the threshold (default: 100 failures/hour).
- With Redis, blocks are synced across instances (hybrid backend: memory for counters, Redis for blocklist).

### HMAC webhook verification

- Verifies `X-Signature`, `X-Timestamp`, `X-Nonce` headers with `crypto.timingSafeEqual`.
- Length guard prevents exception on mismatched signature sizes.
- Rejects requests with clock skew > 300s (configurable). Nonces deduplicated within the window (in-memory per process).
- Use with external webhook providers or for internal service-to-service request signing.

### Reporting vulnerabilities

Open an issue on the GitHub repository or contact the maintainers directly. Do not disclose vulnerabilities publicly until they are addressed.

## License

MIT
