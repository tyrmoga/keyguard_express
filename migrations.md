# KeyGuard Express — Migrations Context

This document captures all context, architecture decisions, and known issues
from the original Python/KeyGuard codebase that informed this Express port.
Use it as a standalone reference when developing this project.

---

## 1. Origin

- **Original repo**: `https://github.com/The-honoured1/keyguard` (Python, FastAPI)
- **Original version**: 0.3.0 (pyproject.toml) / 0.2.0 (`__init__.py`)
- **Port date**: 2026-07-14
- **Port branch**: `express-port`

---

## 2. Architecture Overview

```
Incoming Request
       │
       ▼
┌──────────────────────────────────────────┐
│     keyGuardMiddleware()                 │  ← Hot Path
│                                          │
│  1. IP Blacklist check                   │  ← In-Memory or Redis
│  2. Extract X-API-KEY header             │
│  3. Hash key (SHA-256 + pepper)          │
│  4. Look up by hash (better-sqlite3)     │
│  5. Salted hash verify (PBKDF2-SHA512)   │  ← new keys only, backward compat
│  6. Expiry check (fail closed)           │
│  7. Monthly limit check                  │
│  8. Sliding window rate limit            │  ← In-Memory or Redis
│  9. Attach key to req.apiKey             │
│ 10. Log usage (deferred via setImmediate)│  ← better-sqlite3
└──────────────────────────────────────────┘
       │
       ▼
  Your Route Handler


┌──────────────────────────────────────┐
│           KeyGuard Core              │  ← Cold Path
│                                      │
│  • AuthService (key generation)      │
│  •   — SHA-256 for lookup            │
│  •   — PBKDF2-SHA512 with per-key    │
│  •   —   salt for offline resistance │
│  • RateLimitService (auto-pick)      │
│  • KeyGuardDb (SQLite)               │
│  • CLI + Admin API                   │
│  • requireScope() middleware         │
│  • clientIp() helper (X-Forwarded-For│
│  •   aware)                          │
└──────────────────────────────────────┘
```

### Backend auto-selection

- No Redis URL → `MemoryRateLimitService` (in-memory arrays with mutex)
- Redis URL set → `RateLimitService` (ioredis sorted sets)
- `sqlite://` → better-sqlite3 (synchronous, no async overhead)
- PostgreSQL is not implemented in this port (better-sqlite3 only)

---

## 3. File Mapping (Python → TypeScript)

| Python file | TypeScript file | Notes |
|---|---|---|
| `keyguard/config.py` | `src/config.ts` | BaseSettings → manual dotenv read. Same auto-gen + .env persistence. |
| `keyguard/core.py` | `src/core.ts` | KeyGuard class. DB init, blockRequest, rate limiter selection. |
| `keyguard/middleware.py` | `src/middleware.ts` | FastAPI middleware → Express middleware function. `rateLimitByIp` factory. |
| `keyguard/services/auth_service.py` | `src/services/auth.service.ts` | SHA-256 + pepper (for lookup) + per-key PBKDF2-SHA512 salt. crypto.randomBytes instead of secrets.token_urlsafe. |
| `keyguard/services/memory_rate_limit.py` | `src/services/memory-rate-limit.service.ts` | Same sliding window log with arrays + mutex. |
| `keyguard/services/rate_limit_service.py` | `src/services/rate-limit.service.ts` | ioredis pipeline, same ZSET logic. |
| `keyguard/db/models.py` | `src/db/models.ts` | SQLAlchemy → better-sqlite3. Same schema. KeyGuardDb class with all CRUD. |
| `keyguard/schemas/admin.py` | `src/schemas/admin.ts` | Pydantic → Zod. |
| `keyguard/api/admin.py` | `src/api/admin.router.ts` | FastAPI APIRouter → express.Router(). |
| `keyguard/cli.py` | `src/cli/index.ts` | argparse → Commander. |
| `example_integration.py` | `examples/basic.ts` | Same demo: init, seed, serve. |
| `keyguard/__init__.py` | `src/index.ts` | Package exports. |
| (new) | `src/types.ts` | Consolidated TypeScript interfaces. |
| (new) | `src/utils.ts` | secondsUntilTime, clientIp helpers. |
| (new) | `src/guards/scopes.ts` | requireScope middleware factory. |
| (new) | `src/guards/headers.ts` | Security headers (helmet preset). |
| (new) | `src/guards/cors.ts` | CORS middleware (per-org origins). |
| (new) | `src/guards/validate.ts` | Zod-based body/query validation + bodyParser helper. |
| (new) | `src/guards/hmac.ts` | HMAC request signing verification middleware. |
| (new) | `src/__tests__/run.ts` | Test suite (npm test). |

---

## 4. Design Decisions

### 4.1 Auto-generated Secrets

Same approach as Python config.py, extended:
- `secretKey` and `adminKey` are optional in the constructor
- If not provided (or if they match `_INSECURE_KEYS`), generate `crypto.randomBytes(32).toString("base64url")`
- Persist to `.env` via `writeEnvVar()` helper (create or update `KG_SECRET_KEY` / `KG_ADMIN_KEY` line)
- On next start, `process.env.KG_SECRET_KEY` / `process.env.KG_ADMIN_KEY` picks it up
- Emits `console.warn` with the generated key
- **Admin key is separate from hashing pepper** — independently rotatable

### 4.2 better-sqlite3 Instead of SQLAlchemy

- **Why**: Synchronous API eliminates async overhead. Single-process deployments don't need async DB. Significantly simpler.
- **Trade-off**: Not suitable for multi-worker deployments. For those, add `pg` (PostgreSQL) or `mysql2` as an alternative backend.
- **WAL mode**: Enabled by default (`PRAGMA journal_mode = WAL`) for concurrent read performance.

### 4.3 Synchronous Rate Limiter (Memory)

- Mutex via promise chaining (same pattern as `asyncio.Lock`)
- State is lost on restart (same as Python in-memory backend)
- `cleanup()` runs every 2 minutes via `setInterval` in the constructor — memory leak fixed

### 4.4 Logging in the Hot Path

Unlike the Python original (which awaited `session.commit()` inline), the Express port defers writes via `setImmediate` — the response is sent before the DB write starts. This prevents the synchronous `better-sqlite3` call from blocking the event loop for every request.

Usage logs are also written for rejected requests (expired keys, monthly caps, rate limits) — not just successful authentications.

---

## 5. Known Bugs Inherited from Python Original

All inherited bugs have been fixed. See [`issues.md`](issues.md) for the full list with severity and fix notes.

---

## 6. Differences from Python Original

### Port-Specific Improvements
- **TypeScript**: Full type coverage via `types.ts` and strict mode
- **No ORM overhead**: Direct better-sqlite3 queries instead of SQLAlchemy
- **CLI with Commander**: Better ergonomics than argparse
- **Zod validation**: Runtime schema validation for admin API
- **Per-key PBKDF2-SHA512**: Instead of raw SHA-256, new keys get 100k PBKDF2 iterations with a random salt
- **Separate admin key**: `KG_ADMIN_KEY` is independent of the hashing pepper
- **`clientIp()` helper**: Reads `X-Forwarded-For` for reverse proxy support
- **`requireScope()` middleware**: Route-level scope enforcement
- **Key rotation**: Overlapping active keys during rotation window
- **Deferred logging**: `setImmediate` prevents DB writes from blocking the event loop
- **Memory limit cleanup**: `setInterval` prunes stale rate-limit entries every 2 minutes
- **Test suite**: `npm test` runs unit tests for critical paths

### Port-Specific Limitations
- **PostgreSQL not implemented**: better-sqlite3 only. Add `pg` when needed.
- **No async DB**: better-sqlite3 is synchronous. Usage logging is deferred via `setImmediate` but still synchronously hits SQLite. Multi-worker setups need a different driver.
- **No Alembic equivalent**: Schema changes are manual SQL migrations via `PRAGMA table_info` checks in `init()`.
- **Weak hashing for old keys**: Keys created before the salt migration still use SHA-256 only; they authenticate normally but lack offline-cracking resistance.

---

## 7. Setup & Run

```bash
npm install
npx tsx examples/basic.ts
```

```bash
# CLI
npx tsx src/cli/index.ts init
npx tsx src/cli/index.ts create-org "Demo"
npx tsx src/cli/index.ts create-key --org "Demo" --label "test-key"

# Test
curl http://localhost:8000/api/data -H "X-API-KEY: kg_live_..."
```

---

## 8. Package Dependencies

| Package | Purpose |
|---|---|
| `express` | Web framework |
| `better-sqlite3` | SQLite database |
| `ioredis` | Redis client for distributed rate limiting |
| `zod` | Schema validation |
| `commander` | CLI framework |
| `chalk` | Colored CLI output |
| `dotenv` | .env file loading |
| `uuid` | Primary key generation |
| `crypto` (built-in) | Key generation and hashing |
| `tsx` | Dev runner for TypeScript |

---

## 9. Completed Work

- ✅ `crypto.timingSafeEqual` for constant-time key comparison (admin router)
- ✅ Redis ZADD moved after limit check (backends now consistent)
- ✅ `X-Forwarded-For` support via `clientIp()` helper
- ✅ Periodic cleanup timer for memory rate limiter (`setInterval` every 2min)
- ✅ Usage logging deferred via `setImmediate` (event loop no longer blocked)
- ✅ Expiry, monthly caps, and scopes enforced in middleware
- ✅ Per-key salt + PBKDF2-SHA512 hashing (100k iterations)
- ✅ Separate admin key (independent from hashing pepper)
- ✅ Key rotation support (`rotates_to_id` column + rotate endpoint)
- ✅ Test suite (`npm test` — secondsUntilTime, clientIp, AuthService, MemoryRateLimitService)
- ✅ Security headers (`src/guards/headers.ts`)
- ✅ CORS middleware with per-org origins (`src/guards/cors.ts`)
- ✅ Zod-based body/query validation (`src/guards/validate.ts`)
- ✅ HMAC request signing verification (`src/guards/hmac.ts`)
- ✅ Token-bucket rate limiter (`src/services/token-bucket.service.ts`)
- ✅ Per-route limits from DB (`route_limits` table + middleware)
- ✅ IP allowlisting per key (`allowed_ips` column + `checkIpAllowlist()`)
- ✅ Distributed blocklist sync (`src/services/hybrid-rate-limit.service.ts`)
- ✅ Scoped admin roles (`admin_tokens` table + `requireOwner`/`requireOrgAccess`)
- ✅ Admin audit log (`admin_audit_log` table + `GET /admin/audit-log`)
- ✅ Alerting hooks (`onAbuseThreshold`, `onKeyExpiringSoon` callbacks)

## 10. Future Work

- Add PostgreSQL driver option
- Add CI/CD pipeline
- Publish to npm
- Tier 5: Async write path, health endpoint, graceful shutdown
- Tier 5: Async write path, health endpoint, graceful shutdown
