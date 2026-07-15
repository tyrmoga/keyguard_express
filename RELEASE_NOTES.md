# KeyGuard Express v0.3.0

> Drop-in API key authentication, rate limiting, and abuse prevention for Express.js.
> TypeScript port of [keyguard](https://github.com/The-honoured1/keyguard) (Python/FastAPI).

---

## Install

```bash
npm install keyguard-express express
```

---

## Quick Start

```ts
import { KeyGuard, KeyGuardConfig, keyGuardMiddleware } from "keyguard-express"
import express from "express"

const config = new KeyGuardConfig()           // auto-generates keys on first run
const kg = new KeyGuard(config)
kg.initDb()

const app = express()
app.use(keyGuardMiddleware(kg, "/api"))       // protects all /api routes
app.listen(3000)
```

Five lines. Every route under `/api` gets authentication, abuse tracking, rate limiting, expiry checks, monthly caps, and scope enforcement.

---

## What's Included

### Authentication & Key Management

- **API key auth** via `X-API-KEY` header. Keys stored as `SHA-256(key + pepper)` for lookup with `PBKDF2-SHA512(key, salt + pepper)` (100k iterations) for offline-cracking resistance.
- **Backward-compatible**: old keys without salt skip PBKDF2 verification and remain valid.
- **Key expiry** enforcement (fail-closed: malformed dates treated as expired).
- **Monthly usage caps** — per-key counters with atomic insert-before-check.
- **Scope enforcement** — `requireScope("write")` middleware gates routes.
- **Key rotation** with overlapping active keys and `X-Key-Deprecated` response header.
- All comparisons use `crypto.timingSafeEqual`.

### Rate Limiting & Abuse Prevention

- **Per-key sliding window** rate limiting (in-memory mutex or Redis ZSET atomic).
- **IP rate limiting** (`rateLimitByIp`) for public endpoints — supports time-based lockout strings (`"11:59 PM"`).
- **IP abuse tracking** — auto-blocks IPs after threshold (default: 100 failures/hour).
- **IP blocking** — temporary or time-based, global or per-path.
- **Per-route limits** — org-level DB-configured limits via admin API.
- **Token bucket** — standalone `TokenBucketRateLimitService` export for burst-tolerant workloads.
- **Distributed blocklist** — hybrid backend: memory for counters, Redis for blocklist sync across instances.

### IP & Proxy Controls

- `clientIp()` reads `X-Forwarded-For` only when `app.set('trust proxy', ...)` is configured — prevents spoofing.
- **IP allowlisting per key** — CIDR support (e.g. `10.0.0.0/8`, `192.168.1.100`).

### Admin API & CLI

- Admin API (`/admin/*`) for orgs, keys, route limits, tokens, audit log, and usage stats.
- **Scoped admin roles**: `owner` (full access via `KG_ADMIN_KEY`) and `org_admin` (single org).
- **Admin audit log** — every admin action recorded with IP and timestamp.
- Commander-based CLI: `init`, `create-org`, `create-key`, `list-keys`, `revoke-key`, `stats`.

### Hardening (opt-in)

- **Security headers** via helmet preset (`app.use(headers())`).
- **CORS** via `corsMiddleware(kg, options?)`.
- **Zod validation** — `validateBody(schema)` / `validateQuery(schema)` middleware factories.
- **HMAC signing** — `requireHmac({ secret })` with timestamp, nonce, and replay protection.
- **Alerting hooks** — `onAbuseThreshold` and `onKeyExpiringSoon` callbacks.

### Production

- **Health check** — `GET /healthz` reports database and Redis status.
- **Graceful shutdown** — `await kg.shutdown()` closes database and Redis connections.
- **Pluggable database** — SQLite (better-sqlite3) or PostgreSQL (pg pool), auto-detected from `databaseUrl`.
- All `KG_SECRET_KEY` and `KG_ADMIN_KEY` auto-generated on first run and persisted to `.env`.
- `X-Forwarded-For` respected only when `trust proxy` is explicitly configured.

---

## Changelog

### Core

- 5-tier feature roadmap completed (schema enforcement → Express hardening → abuse prevention → multi-tenant admin → production ops).
- `keyGuardMiddleware` runs 10 checks per request: IP blocklist, key extraction, SHA-256 lookup, PBKDF2 verification, IP allowlisting, expiry, route limits, monthly cap, per-key rate limit, abuse tracking.
- All 22 inherited bugs from the Python original fixed (hardcoded defaults, weak hashing, timing attacks, reverse-proxy spoofing, sync-DB event-loop blocking, stats TZ mismatch, `secondsUntilTime` AM/PM minutes bug, and others).
- 7 rounds of independent audit. 48+ issues found and resolved.

### Security Fixes

| Issue | Fix |
|-------|-----|
| Auto-generated hardcoded default key | `crypto.randomBytes(32)` with persistence to `.env` |
| SHA-256-only hashing | Per-key PBKDF2-SHA512 with 100k iterations |
| Non-constant-time comparison (`===`) | `crypto.timingSafeEqual` on stretched hash and admin key |
| Admin key = hashing pepper | Separate `KG_ADMIN_KEY` from `KG_SECRET_KEY` |
| X-Forwarded-For spoofing | Only read XFF when `trust proxy` is explicitly set |
| Monthly limit TOCTOU race | Atomic INSERT before COUNT check |
| HMAC signature length mismatch throws | Length guard before `timingSafeEqual` |
| IP CIDR NaN mask silently matches all | Validate bits in `[0, 32]` range |
| CORS middleware fail-open | Removed broken per-org DB lookup |

### Contributors

- Initial port from Python/FastAPI
- 7-round security audit (5 tiers of features, 48+ issues resolved)

---

38 files changed · +4,566 / −253 · 34 commits
