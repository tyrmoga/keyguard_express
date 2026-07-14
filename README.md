# KeyGuard Express

> Express.js port of [keyguard](https://github.com/The-honoured1/keyguard) (Python/FastAPI) — API key authentication, rate limiting, and abuse prevention as drop-in middleware.

This is a **TypeScript fork** of the original Python project. See [`migrations.md`](migrations.md) for the full porting context and architecture decisions.

## Features

- **API Key Auth** — validate `X-API-KEY` header against hashed keys in SQLite
- **Rate Limiting** — sliding window via in-memory (default) or Redis backend
- **IP Abuse Detection** — track missing/invalid key attempts, auto-block at threshold
- **IP Blocking** — temporary or time-based blocks (global or per-path)
- **Admin API** — manage organizations, keys, and stats (protected by `X-Admin-Key`)
- **CLI** — `keyguard init`, `create-org`, `create-key`, `list-keys`, `revoke-key`, `stats`

## Quick Start

```bash
npm install
npx tsx examples/basic.ts
```

## CLI

```bash
npx tsx src/cli/index.ts init
npx tsx src/cli/index.ts create-org "Demo"
npx tsx src/cli/index.ts create-key --org "Demo" --label "test-key"
```

## Middleware Usage

```ts
import { KeyGuard, KeyGuardConfig, keyGuardMiddleware } from "keyguard-express"

const config = new KeyGuardConfig({ secretKey: "my-secret" })
const kg = new KeyGuard(config)
kg.initDb()

const app = express()
app.use(keyGuardMiddleware(kg, "/api"))
app.use("/admin", createAdminRouter(kg))
```

## Configuration

Both `SECRET_KEY` (hashing pepper) and `ADMIN_KEY` (admin API auth) are auto-generated and persisted to `.env` if not provided. They are kept as separate, independently rotatable secrets so that compromising one does not compromise the other.

KeyGuard auto-detects backends:
- **Rate limiting**: No `REDIS_URL` → in-memory sliding window with mutex; `REDIS_URL` set → ioredis sorted sets
- **Database**: SQLite only in this port (better-sqlite3, synchronous)

For IP-based controls behind a reverse proxy (nginx, Cloudflare, LB), call `app.set('trust proxy', 1)` before mounting middleware.

## Status of Known Issues

This port inherited bugs from the original Python codebase. Most have been fixed; remaining
limitations are documented here.

| Severity | Issue | Status |
|----------|-------|--------|
| CRITICAL | Redis ZADD unconditional (retrying client self-extends lockout) | **Fixed** — ZADD moved after limit check |
| HIGH | Weak SHA-256 hashing (no per-key salt, no KDF) | Open — needs bcrypt/PBKDF2 |
| MEDIUM | Non-constant-time key comparison (`===`) | **Fixed** — `crypto.timingSafeEqual` in both auth and admin |
| MEDIUM | Synchronous DB on hot path blocks event loop | **Fixed** — `setImmediate` defers `logUsage`/`updateLastUsed` |
| MEDIUM | Admin key doubles as hashing pepper | **Fixed** — separate `ADMIN_KEY` config with own env var |
| MEDIUM | Memory leak — `cleanup()` never called | Open |
| MEDIUM | Zero test coverage | Open |
| LOW | `secondsUntilTime` drops minutes in AM/PM formats | **Fixed** |
| LOW | `secondsUntilTime` treats midnight as "no match" | **Fixed** |
| LOW | Stats `recent_requests_1h` returns 0 due to local/UTC format mismatch | **Fixed** |
| LOW | Key prefix collisions (24-bit entropy) | Open |

## License

MIT
