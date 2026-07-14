# KeyGuard Express — Roadmap to a Drop-In API Security Suite

> **Status**: Planning document. Tiers are ordered by impact per effort. Items within a tier are unordered unless noted.

Today KeyGuard Express authenticates API keys and rate-limits requests. The schema already carries `expires_at`, `monthly_limit`, and `scopes` columns — but nothing enforces them. A key with an expired date authenticates forever; monthly caps are decorative; scopes are returned in responses but never checked against routes. Closing these gaps is Tier 1: finishing what's half-built.

Beyond that, a true "drop-in security suite" means bundling standard Express hardening (headers, CORS, validation) so consumers get one `npm install` instead of stitching together helmet + cors + express-validator + a key-auth library. The roadmap below groups work by what it unlocks.

---

## Tier 1 — Finish the Half-Built Schema (highest ROI, lowest effort)

The DB and admin API already support these fields; the middleware just ignores them.

- **Enforce `expires_at` in `keyGuardMiddleware`** — if `keyObj.expires_at` is set and in the past, respond 401. Trivial, currently a silent correctness gap.
- **Enforce `monthly_limit`** — a `COUNT(*) FROM usage_logs WHERE key_id = ? AND timestamp >= date('now', 'start of month')` checked alongside the per-minute rate limit. Reject with 429 (or a distinct status) when exceeded.
- **Enforce `scopes`** — a `requireScope("write")` middleware factory that reads `(req as any).apiKey.scopes` and returns 403 on mismatch. Routes declare their required scopes; the admin API already sets them.
- **Key rotation** — a `rotates_to_id` column so an org can have two overlapping active keys during a rotation window. Consumers cut over without a hard cutoff point.

---

## Tier 2 — Standard Express Hardening (opt-in wrappers)

These are thin wrappers around well-audited libraries, shipped as re-exports or convenience presets. Not reinventions.

- **Security headers** — a `helmet` preset tuned for APIs (CSP relaxed, HSTS on). One import: `app.use(keyguard.headers())`.
- **CORS helper** — a `corsMiddleware(kg)` that can pull allowed origins per-org from the DB, tying into the multi-tenant model.
- **Body-size / JSON limits** — sensible defaults (`10kb`) on `express.json()`, since unbounded body parsing is a common unguarded DoS vector. Overridable.
- **Request validation middleware** — expose `validateBody(schema)` / `validateQuery(schema)` factories using the Zod already in the dependency tree, so consumers get the same ergonomics as the admin API for their own routes.
- **HMAC request signing middleware** — verify `X-Signature` / `X-Timestamp` / `X-Nonce` headers with a replay-window check. Directly applicable to M-Pesa/Daraja webhook integration work; natural fit next to API-key auth.

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
- **Tier 2 files**: Each wrapper gets its own file under `src/guards/` — `headers.ts`, `cors.ts`, `validate.ts`, `hmac.ts` — and is exported from `src/index.ts`.
- **Tier 3 files**: Extends `src/services/` with token-bucket backend; adds `route_limits` table to `src/db/models.ts` and `src/db/schema.ts`.
- **Tier 4 files**: Extends `src/schemas/admin.ts` with role schemas; adds `admin_audit_log` table; adds callback registration to `src/core.ts`.
- **Tier 5 files**: New `src/db/pg.ts` adapter; new `src/health.ts`; `src/index.ts` gets `shutdown()` export; test suite under `src/__tests__/`.

No new dependencies for Tier 1. Tier 2 would add `helmet` and `cors` (both standard, lightweight). Tier 3+ can use existing dependencies.
