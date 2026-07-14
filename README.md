# KeyGuard Express

> Express.js port of [keyguard](https://github.com/The-honoured1/keyguard) (Python/FastAPI) — API key authentication, rate limiting, and abuse prevention as drop-in middleware.

This is a **TypeScript fork** of the original Python project. See [`migrations.md`](migrations.md) for the full porting context and architecture decisions.

## Features

- **API Key Auth** — validate `X-API-KEY` header against hashed keys in SQLite
- **Key Expiry** — reject expired keys with 401
- **Monthly Caps** — enforce per-key monthly usage limits (429 when exceeded)
- **Scope Guard** — `requireScope("write")` middleware gates routes by key scopes
- **Key Rotation** — overlapping active keys during rotation window via admin API
- **Rate Limiting** — sliding window via in-memory (default) or Redis backend
- **IP Abuse Detection** — track missing/invalid key attempts, auto-block at threshold
- **IP Blocking** — temporary or time-based blocks (global or per-path)
- **Admin API** — manage organizations, keys, stats, and rotations (protected by `X-Admin-Key`)
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

Most inherited bugs from the original Python codebase have been fixed. Remaining limitations:

| Severity | Issue | Status |
|----------|-------|--------|
| HIGH | Weak SHA-256 hashing (no per-key salt, no KDF) | Open — needs bcrypt/PBKDF2 |
| HIGH | Zero test coverage | Open |
| MEDIUM | Memory leak — `cleanup()` never called | Open |
| LOW | Usage logs only capture authorized requests | Open |
| LOW | Key prefix collisions (24-bit entropy) | Open |
| LOW | Reverse proxy IP controls require consumer `app.set('trust proxy', ...)` | Open |

For the full issue history and all fixed items, see [`issues.md`](issues.md).

## License

MIT
