# Changelog

## 0.3.0 — Initial npm release

Express.js port of [keyguard](https://github.com/The-honoured1/keyguard) (Python/FastAPI).

### Core

- Drop-in `keyGuardMiddleware(kg)` for API key auth, rate limiting, and abuse prevention.
- `X-API-KEY` header authentication with SHA-256 lookup + per-key PBKDF2-SHA512 (100k iterations) stretching.
- Backward-compatible: old keys (no salt) skip PBKDF2 verification.
- Sliding-window rate limiting (in-memory mutex or Redis ZSET atomic).
- Hybrid backend: memory for counters, Redis for distributed blocklist sync.
- PostgreSQL support via `IDatabaseBackend` interface; auto-detected from `databaseUrl`.
- SQLite support via better-sqlite3 (WAL mode, synchronous, deferred writes).

### Security

- Auto-generated `KG_SECRET_KEY` (hashing pepper) and `KG_ADMIN_KEY` (admin auth) persisted to `.env` on first run.
- Timing-safe comparison (`crypto.timingSafeEqual`) on PBKDF2 stretched hash and admin key.
- `clientIp()` reads `X-Forwarded-For` only when `app.set('trust proxy', ...)` is configured.
- IP allowlisting per key (CIDR support); IP blocking; abuse tracking with auto-block at threshold.
- Admin endpoint protection: global admin key + scoped `org_admin` tokens.
- Admin action audit log with IP and timestamp.
- HMAC request signing middleware with nonce deduplication and clock-skew window.
- Security headers via helmet preset; CORS via `corsMiddleware`.

### Features

- Key expiry enforcement (fail-closed: unparseable dates treated as expired).
- Monthly per-key usage cap enforcement.
- `requireScope("write")` route-level scope guard.
- Key rotation with overlapping active keys and `X-Key-Deprecated` response header.
- Per-route rate limits (org-level, DB-configured).
- Token-bucket rate limiter (standalone `TokenBucketRateLimitService` export).
- `rateLimitByIp` for public endpoints (login, signup) with time-based lockout strings ("11:59 PM").
- Pluggable alerting hooks: `onAbuseThreshold`, `onKeyExpiringSoon`.
- `GET /healthz` health check endpoint.
- Graceful shutdown via `kg.shutdown()`.

### Admin & CLI

- Admin API (`/admin/*`) for orgs, keys, route limits, tokens, audit log, stats.
- Commander-based CLI: `init`, `create-org`, `create-key`, `list-keys`, `revoke-key`, `stats`.
- Zod validation on all admin endpoints and `validateBody`/`validateQuery` middleware factories.

### Quality

- TypeScript strict mode, full type coverage, declaration files emitted.
- 6-group test suite (`npm test`): secondsUntilTime, clientIp, AuthService, MemoryRateLimitService.
- `npm pack` produces clean 99-file tarball (86KB) — no test files, no source, no `.env`.
- Express listed as `peerDependency` to prevent dual-install conflicts.
