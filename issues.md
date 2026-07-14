# KeyGuard Express — Issues & Status

> **Last updated**: 2026-07-14
> **Repo**: Express.js port of [keyguard](https://github.com/The-honoured1/keyguard) (Python/FastAPI)

This document tracks all known issues, their fix status in the Express port, and remaining open items.

| # | Issue | Severity | Status | Notes |
|---|-------|----------|--------|-------|
| 1 | Hardcoded default secret key | CRITICAL | **FIXED** | Auto-generated on first run, persisted to `.env` |
| 2 | Redis ZADD unconditional (self-extends lockout) | CRITICAL | **FIXED** | ZADD moved after limit check |
| 3 | Weak SHA-256 hashing (no per-key salt, no KDF) | HIGH | Open | Needs bcrypt/PBKDF2 with per-key salt |
| 4 | Reverse proxy breaks IP controls | HIGH | Open | Documented: consumer must call `app.set('trust proxy', ...)` |
| 5 | Zero test coverage | HIGH | Open | No unit/integration tests exist |
| 6 | Non-constant-time key comparison | MEDIUM | **FIXED** | `crypto.timingSafeEqual` in admin router; `verifyKey` removed (dead code, middleware uses hash+DB lookup instead) |
| 7 | Synchronous DB blocks event loop | MEDIUM | **FIXED** | `setImmediate` defers `logUsage`/`updateLastUsed` |
| 8 | Admin key = hashing pepper (single secret) | MEDIUM | **FIXED** | Separate `adminKey` config with own `ADMIN_KEY` env var |
| 9 | Memory leak (cleanup never called) | MEDIUM | Open | `MemoryRateLimitService.cleanup()` has zero call sites |
| 10 | `secondsUntilTime` drops minutes in AM/PM formats | LOW | **FIXED** | Added `minutes` assignment in AM/PM branches |
| 11 | `secondsUntilTime` treats midnight as "no match" (returns 3600s) | LOW | **FIXED** | `matched` flag replaces `!hours && !minutes` fallback |
| 12 | Stats `recent_requests_1h` returns 0 (TZ mismatch) | LOW | **FIXED** | UTC getters replace local-time getters |
| 13 | TypeScript build broken (ApiKeyRow type mismatch) | CRITICAL | **FIXED** | `CreateApiKeyInput` type, optional unused fields |
| 14 | Demo crashes on fresh DB (PORT TDZ) | CRITICAL | **FIXED** | `PORT` moved above `seedTestData` |
| 15 | `npm start` points to non-existent `dist/examples/` | HIGH | **FIXED** | Changed to `tsx examples/basic.ts` |
| 16 | Redis ZSET member collision (same-ms requests) | MEDIUM | **FIXED** | Appended `crypto.randomUUID()` to member |
| 17 | Usage logs only capture authorized requests | LOW | Open | 401/403/429 responses not logged |
| 18 | Key prefix collisions (24-bit entropy) | LOW | Open | `prefix = rawKey.slice(0, 12)` — 4 random chars |

### Open items

- **Weak hashing (#3)**: SHA-256 with a global pepper only. Add per-key salt and a KDF (PBKDF2, bcrypt, or Argon2).
- **Reverse proxy IP (#4)**: `req.ip` depends on `app.set('trust proxy', ...)`, which this library neither sets nor documents.
- **Zero tests (#5)**: All fixes in this round were verified manually. A test suite around `secondsUntilTime`, `getStats`, the rate limiters, and middleware dispatch would prevent regressions.
- **Memory leak (#9)**: Wire `cleanup()` to a `setInterval` in the constructor, or make it externally callable on a timer.
- **Key prefix collisions (#18)**: Increase random portion of prefix or use a hash of the full key.
- **Usage log coverage (#17)**: Currently only successful authorized requests are logged. Admin stats are blind to abuse traffic.
