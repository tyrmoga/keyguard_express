# KeyGuard Express — Issues & Status

> **Last updated**: 2026-07-14
> **Repo**: Express.js port of [keyguard](https://github.com/The-honoured1/keyguard) (Python/FastAPI)

This document tracks all known issues, their fix status in the Express port, and remaining open items.

| # | Issue | Severity | Status | Notes |
|---|-------|----------|--------|-------|
| 1 | Hardcoded default secret key | CRITICAL | **FIXED** | Auto-generated on first run, persisted to `.env` |
| 2 | Redis ZADD unconditional (self-extends lockout) | CRITICAL | **FIXED** | ZADD moved after limit check |
| 3 | Weak SHA-256 hashing (no per-key salt, no KDF) | HIGH | **FIXED** | Per-key salt + PBKDF2-SHA512 100k iterations; backward-compatible with existing keys |
| 4 | Reverse proxy breaks IP controls | HIGH | **FIXED** | `clientIp()` helper reads `X-Forwarded-For` first, falls back to `req.ip` then socket |
| 5 | Zero test coverage | HIGH | **FIXED** | Test suite covering secondsUntilTime, clientIp, AuthService, MemoryRateLimitService |
| 6 | Non-constant-time key comparison | MEDIUM | **FIXED** | `crypto.timingSafeEqual` in admin router; `verifyKey` removed (dead code, middleware uses hash+DB lookup instead) |
| 7 | Synchronous DB blocks event loop | MEDIUM | **FIXED** | `setImmediate` defers `logUsage`/`updateLastUsed` |
| 8 | Admin key = hashing pepper (single secret) | MEDIUM | **FIXED** | Separate `adminKey` config with own `ADMIN_KEY` env var |
| 9 | Memory leak (cleanup never called) | MEDIUM | **FIXED** | `setInterval` in constructor prunes stale entries every 2min |
| 10 | `secondsUntilTime` drops minutes in AM/PM formats | LOW | **FIXED** | Added `minutes` assignment in AM/PM branches |
| 11 | `secondsUntilTime` treats midnight as "no match" (returns 3600s) | LOW | **FIXED** | `matched` flag replaces `!hours && !minutes` fallback |
| 12 | Stats `recent_requests_1h` returns 0 (TZ mismatch) | LOW | **FIXED** | UTC getters replace local-time getters |
| 13 | TypeScript build broken (ApiKeyRow type mismatch) | CRITICAL | **FIXED** | `CreateApiKeyInput` type, optional unused fields |
| 14 | Demo crashes on fresh DB (PORT TDZ) | CRITICAL | **FIXED** | `PORT` moved above `seedTestData` |
| 15 | `npm start` points to non-existent `dist/examples/` | HIGH | **FIXED** | Changed to `tsx examples/basic.ts` |
| 16 | Redis ZSET member collision (same-ms requests) | MEDIUM | **FIXED** | Appended `crypto.randomUUID()` to member |
| 17 | Usage logs only capture authorized requests | LOW | **FIXED** | Expired, monthly-capped, and rate-limited requests now logged |
| 18 | Key prefix collisions (72-bit entropy) | LOW | **FIXED** | `prefix = rawKey.slice(0, 20)` — 12 random chars |
| 19 | `expires_at` not enforced by middleware | MEDIUM | **FIXED** | Middleware rejects expired keys with 401 |
| 20 | `monthly_limit` not enforced by middleware | MEDIUM | **FIXED** | Middleware counts usage_logs for current month, rejects with 429 |
| 21 | `scopes` stored but never validated on routes | MEDIUM | **FIXED** | `requireScope()` middleware factory gates routes |
| 22 | No key rotation support | LOW | **FIXED** | `rotates_to_id` column + admin rotate endpoint |

### Open items

_All known issues from the original Python audit are now resolved._

### Tier 2 features added

| # | Feature | File | Status |
|---|---------|------|--------|
| 23 | Security headers (helmet preset) | `src/guards/headers.ts` | ✅ |
| 24 | CORS middleware (per-org origins) | `src/guards/cors.ts` | ✅ |
| 25 | Request body/query validation (Zod) | `src/guards/validate.ts` | ✅ |
| 26 | HMAC request signing verification | `src/guards/hmac.ts` | ✅ |
| 27 | Token-bucket rate limiter | `src/services/token-bucket.service.ts` | ✅ |
| 28 | Per-route limits from DB | `src/db/models.ts` + middleware | ✅ |
| 29 | IP allowlisting per key | `src/db/models.ts` allowed_ips + middleware | ✅ |
| 30 | Distributed blocklist sync (hybrid backend) | `src/services/hybrid-rate-limit.service.ts` | ✅ |

