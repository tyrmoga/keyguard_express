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
┌──────────────────────────────────┐
│     keyGuardMiddleware()         │  ← Hot Path
│                                  │
│  1. IP Blacklist check           │  ← In-Memory or Redis
│  2. Extract X-API-KEY header     │
│  3. Hash & validate key          │  ← better-sqlite3
│  4. Sliding window rate limit    │  ← In-Memory or Redis
│  5. Attach key to req.apiKey     │
│  6. Log usage                    │  ← better-sqlite3
└──────────────────────────────────┘
       │
       ▼
  Your Route Handler


┌──────────────────────────────────┐
│           KeyGuard Core          │  ← Cold Path
│                                  │
│  • AuthService (key generation)  │
│  • RateLimitService (auto-pick)  │
│  • KeyGuardDb (SQLite)           │
│  • CLI + Admin API               │
└──────────────────────────────────┘
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
| `keyguard/services/auth_service.py` | `src/services/auth.service.ts` | Same SHA-256 + pepper, token_urlsafe → randomBytes. No passlib equivalent. |
| `keyguard/services/memory_rate_limit.py` | `src/services/memory-rate-limit.service.ts` | Same sliding window log with arrays + mutex. |
| `keyguard/services/rate_limit_service.py` | `src/services/rate-limit.service.ts` | ioredis pipeline, same ZSET logic. |
| `keyguard/db/models.py` | `src/db/models.ts` | SQLAlchemy → better-sqlite3. Same schema. KeyGuardDb class with all CRUD. |
| `keyguard/schemas/admin.py` | `src/schemas/admin.ts` | Pydantic → Zod. |
| `keyguard/api/admin.py` | `src/api/admin.router.ts` | FastAPI APIRouter → express.Router(). |
| `keyguard/cli.py` | `src/cli/index.ts` | argparse → Commander. |
| `example_integration.py` | `examples/basic.ts` | Same demo: init, seed, serve. |
| `keyguard/__init__.py` | `src/index.ts` | Package exports. |
| (new) | `src/types.ts` | Consolidated TypeScript interfaces. |
| (new) | `src/utils.ts` | secondsUntilTime helper. |

---

## 4. Design Decisions

### 4.1 Auto-generated Secret Key

Same approach as Python config.py:
- `secretKey` is optional in the constructor
- If not provided (or if it matches `_INSECURE_KEYS`), generate `crypto.randomBytes(32).toString("base64url")`
- Persist to `.env` via `writeEnvVar()` helper (create or update SECRET_KEY line)
- On next start, `process.env.SECRET_KEY` picks it up (dotenv loads `.env` at CLI entry)
- Emits `console.warn` with the generated key

### 4.2 better-sqlite3 Instead of SQLAlchemy

- **Why**: Synchronous API eliminates async overhead. Single-process deployments don't need async DB. Significantly simpler.
- **Trade-off**: Not suitable for multi-worker deployments. For those, add `pg` (PostgreSQL) or `mysql2` as an alternative backend.
- **WAL mode**: Enabled by default (`PRAGMA journal_mode = WAL`) for concurrent read performance.

### 4.3 Synchronous Rate Limiter (Memory)

- Mutex via promise chaining (same pattern as `asyncio.Lock`)
- State is lost on restart (same as Python in-memory backend)
- `cleanup()` exists but is never called — same memory leak risk as the original

### 4.4 Logging in the Hot Path

Identical to the Python original — usage logs are written inline during the request-response cycle. For high-traffic deployments, this should be moved to a background queue.

---

## 5. Known Bugs Inherited from Python Original

These issues from `issues.md` apply directly to this Express port:

| # | Issue | Severity | Location | Status |
|---|-------|----------|----------|--------|
| 1.1 | Hardcoded default secret key | CRITICAL | `src/config.ts` | **FIXED** — auto-generated |
| 1.2 | Weak key hashing (SHA-256, no salt, no KDF) | HIGH | `src/services/auth.service.ts` | Inherited |
| 1.3 | Non-constant-time key comparison | MEDIUM | `src/services/auth.service.ts` `===` | Inherited |
| 1.4 | Reverse proxy breaks IP controls | HIGH | `src/middleware.ts` `req.ip` | Inherited — use `trust proxy` |
| 1.5 | Distinguishable error messages | LOW | `src/middleware.ts` | Inherited |
| 2.1 | Redis vs Memory rate limit inconsistency | CRITICAL | `rate-limit.service.ts` ZADD before check | Inherited |
| 3.1 | Synchronous DB logging on hot path | MEDIUM | `src/db/models.ts` `logUsage()` | Inherited |
| 3.3 | Memory leak (cleanup never called) | MEDIUM | `memory-rate-limit.service.ts` | Inherited |
| 5.2 | Broad exception handler | LOW | `src/utils.ts` `secondsUntilTime` | Inherited |

---

## 6. Differences from Python Original

### Port-Specific Improvements
- **TypeScript**: Full type coverage via `types.ts` and strict mode
- **No ORM overhead**: Direct better-sqlite3 queries instead of SQLAlchemy
- **CLI with Commander**: Better ergonomics than argparse
- **Zod validation**: Runtime schema validation for admin API

### Port-Specific Limitations
- **PostgreSQL not implemented**: better-sqlite3 only. Add `pg` when needed.
- **No async DB**: better-sqlite3 is synchronous. This is fine for single-process, but multi-worker setups need a different driver.
- **No Alembic equivalent**: Schema changes are manual SQL migrations.
- **`passlib` — no bcrypt**: Same SHA-256-only hashing as original.

---

## 7. Setup & Run

```bash
cd express
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

## 9. TODOs / Future Work

- [ ] Add `hmac.compareDigest` for constant-time key comparison (issue #1.3)
- [ ] Fix Redis ZADD ordering bug (issue #2.1)
- [ ] Add `X-Forwarded-For` support for reverse proxy deployments (issue #1.4)
- [ ] Add periodic cleanup timer for memory rate limiter (issue #3.3)
- [ ] Move usage logging to async/background (issue #3.1)
- [ ] Add PostgreSQL driver option
- [ ] Add proper test suite (Jest/Vitest)
- [ ] Add CI/CD pipeline
- [ ] Publish to npm
