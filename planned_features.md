# KeyGuard Express — Roadmap to a Drop-In API Security Suite

> **Status**: Planning document. Tiers are ordered by impact per effort. Items within a tier are unordered unless noted.

Today KeyGuard Express authenticates API keys, rate-limits requests, enforces key expiry and monthly caps, and validates scopes per route.

Beyond that, a true "drop-in security suite" means bundling standard Express hardening (headers, CORS, validation) so consumers get one `npm install` instead of stitching together helmet + cors + express-validator + a key-auth library. The roadmap below groups work by what it unlocks.

---

## Tier 1 — Finish the Half-Built Schema ✅

The DB and admin API already supported these fields; the middleware now enforces them.

- **Enforce `expires_at` in `keyGuardMiddleware`** — if `keyObj.expires_at` is set and in the past, respond 401. ✅
- **Enforce `monthly_limit`** — `COUNT(*)` against `usage_logs` checked alongside the per-minute rate limit. ✅
- **Enforce `scopes`** — `requireScope("write")` middleware factory; returns 403 on mismatch. ✅
- **Key rotation** — `rotates_to_id` column + `POST /keys/:keyId/rotate` admin endpoint for overlapping active keys. ✅

---

## Tier 2 — Standard Express Hardening ✅

These are thin wrappers around well-audited libraries, shipped as re-exports or convenience presets. Not reinventions.

- **Security headers** — `app.use(headers())` — helmet preset tuned for APIs (CSP relaxed, HSTS on). ✅
- **CORS helper** — `app.use(corsMiddleware(kg))` — pulls allowed origins per-org from the DB. ✅
- **Body-size / JSON limits** — `express.json({ limit: "10kb" })` documented as recommended practice. ✅
- **Request validation middleware** — `validateBody(schema)` / `validateQuery(schema)` factories using Zod. ✅
- **HMAC request signing middleware** — `requireHmac({ secret })` verifies `X-Signature` / `X-Timestamp` / `X-Nonce` with replay-window check. ✅

---

## Tier 3 — Abuse Prevention Beyond Flat Rate Limits ✅

- **Token-bucket rate limiter** — `TokenBucketRateLimitService` alongside the sliding window. ✅
- **Per-route limits from the DB** — `route_limits` table + admin API + middleware enforcement. ✅
- **IP allowlisting per key** — `allowed_ips` JSON column + `checkIpAllowlist()` in middleware. ✅
- **Distributed blocklist sync** — `HybridRateLimitService` (memory counting + Redis blocks) auto-selected when `REDIS_URL` is set. ✅

---

## Tier 4 — Multi-Tenant Admin Maturity ✅

- **Scoped admin roles** — `admin_tokens` table with `owner` / `org_admin` roles; `requireOwner` / `requireOrgAccess` guards; `org_admin` scoped to single org. ✅
- **Admin action audit log** — `admin_audit_log` table logging all admin actions with IP; `GET /admin/audit-log` endpoint (owner only). ✅
- **Alerting hooks** — `onAbuseThreshold(identifier, ip)` and `onKeyExpiringSoon(key, daysLeft)` callbacks on config. ✅

---

## Tier 5 — Production / Ops Maturity ✅

- **Pluggable database backend** — `IDatabaseBackend` interface with both `SqliteDb` (better-sqlite3) and `PostgresDb` (pg) implementations; auto-detected from `databaseUrl`. ✅
- **Async write path** — All DB methods are async; `setImmediate` defers hot-path writes. Postgres driver is natively async. ✅
- **Health check endpoint** — `GET /healthz` reports DB and Redis reachability. ✅
- **Graceful shutdown** — `kg.shutdown()` closes DB pool and Redis connection; wired to `SIGTERM`/`SIGINT` in the example. ✅
- **Test suite** — `npm test` covers secondsUntilTime, clientIp, AuthService, MemoryRateLimitService, and all new features. ✅

---

## Implementation Notes

- **Tier 1 files**: `src/middleware.ts` (expires_at, monthly_limit) + new `src/guards/scopes.ts` (requireScope factory).
- **Tier 2 files**: `src/guards/headers.ts`, `cors.ts`, `validate.ts`, `hmac.ts` — all exported from `src/index.ts`. ✅
- **Tier 3 files**: `src/services/token-bucket.service.ts`, `src/services/hybrid-rate-limit.service.ts`, `route_limits` table + `allowed_ips` column in `src/db/models.ts`, middleware IP/route checks, admin route-limit endpoints. ✅
- **Tier 4 files**: `src/api/admin.router.ts` (scoped auth + audit + admin token endpoints), `src/db/models.ts` (admin_tokens + admin_audit_log tables), `src/types.ts` (AdminTokenRow, AdminAuditLogRow, callbacks), `src/config.ts` (callback storage), `src/middleware.ts` (hook invocations). ✅
- **Tier 5 files**: `src/db/types.ts` (interface), `src/db/postgres.ts` (Postgres adapter), `src/db/index.ts` (factory), `src/health.ts`, `src/core.ts` (shutdown). ✅

No new dependencies for Tier 1. Tier 2 would add `helmet` and `cors` (both standard, lightweight). Tier 3+ can use existing dependencies.
