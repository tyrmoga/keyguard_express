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
- **Salted Key Hashing** — per-key PBKDF2-SHA512 with 100k iterations (backward-compatible, old keys keep working)
- **Reverse Proxy Aware** — `X-Forwarded-For` respected when present
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

IP-based controls read `X-Forwarded-For` when present, falling back to `req.ip` then `req.socket.remoteAddress`. Behind a reverse proxy, the proxy's IP is the direct peer; if your Express app has `app.set('trust proxy', 1)`, `req.ip` provides the real client IP before the fallback.

See [`issues.md`](issues.md) for the full list of known issues, fix status, and remaining open items.

## License

MIT
