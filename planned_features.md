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

## Tier 3 — Abuse Prevention Beyond Flat Rate Limits

- **Token-bucket rate limiter** — alongside the existing sliding window, offer a token-bucket backend so consumers can allow short bursts without raising the sustained ceiling.
- **Per-route limits from the DB** — a `route_limits` table so an org can configure `/heavy-task` at 5/min and `/data` at 1000/min without custom middleware per route.
- **IP allowlisting per key** — restrict an API key to specific IPs or CIDR ranges. Valuable for server-to-server integrations (ERP, middleware).
- **Distributed blocklist sync** — extend IP blocks to propagate across instances even when using the in-memory rate limiter for counting. Hybrid mode: memory for counters, Redis just for the blocklist.

---

## Tier 4 — Multi-Tenant Admin Maturity

Relevant for SaaS work: the current single shared `X-Admin-Key` authenticates all admin operations against every org.

- **Scoped admin roles** — org-scoped admin tokens or a `role: owner | org_admin` model so one tenant's key management is isolated from another's.
- **Admin action audit log** — an `admin_audit_log` table recording who created/revoked which key, from what IP, at what time. Currently zero audit trail on the admin side.
- **Alerting hooks** — pluggable callbacks: `onAbuseThreshold(keyId, ip)`, `onKeyExpiringSoon(key, daysLeft)`, so consumers can wire Slack/email/PagerDuty without polling `/admin/stats`.

---

## Tier 5 — Production / Ops Maturity

- **Pluggable database backend** — PostgreSQL option alongside SQLite. SQLite (even WAL-mode) doesn't survive multi-instance deployment, which matters behind more than one Node process.
- **Async write path** — replace the `setImmediate`-deferred `better-sqlite3` writes with a real async driver or a batched background flush, so usage logging stops being a throughput ceiling.
- **Health check endpoint** (`GET /healthz`) — reports DB and Redis reachability for load balancer integration. Deliberately outside any auth middleware.
- **Graceful shutdown** — close the SQLite handle and Redis connection on `SIGTERM` / `SIGINT`. Currently nothing cleans up.
- **A real test suite** — at this point non-negotiable. Every fix so far has been hand-verified; a regression net around `secondsUntilTime`, `getStats`, both rate-limit backends, and the middleware dispatch paths would have caught the AM/PM minutes bug, the stats TZ mismatch, the PORT TDZ crash, and the midnight fallback bug before they were shipped.

---

## Implementation Notes

- **Tier 1 files**: `src/middleware.ts` (expires_at, monthly_limit) + new `src/guards/scopes.ts` (requireScope factory).
- **Tier 2 files**: `src/guards/headers.ts`, `cors.ts`, `validate.ts`, `hmac.ts` — all exported from `src/index.ts`. ✅
- **Tier 3 files**: Extends `src/services/` with token-bucket backend; adds `route_limits` table to `src/db/models.ts` and `src/db/schema.ts`.
- **Tier 4 files**: Extends `src/schemas/admin.ts` with role schemas; adds `admin_audit_log` table; adds callback registration to `src/core.ts`.
- **Tier 5 files**: New `src/db/pg.ts` adapter; new `src/health.ts`; `src/index.ts` gets `shutdown()` export; test suite under `src/__tests__/`.

No new dependencies for Tier 1. Tier 2 would add `helmet` and `cors` (both standard, lightweight). Tier 3+ can use existing dependencies.
