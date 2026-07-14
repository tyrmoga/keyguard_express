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

## Known Issues

This port inherits several bugs from the original Python codebase. See [`issues.md`](issues.md) for details.

| Severity | Key Issues |
|----------|-----------|
| CRITICAL | Redis ZADD before rate-limit check (backend inconsistency) |
| HIGH | Weak SHA-256 hashing (no salt/KDF), no `X-Forwarded-For` support, zero tests |
| MEDIUM | Non-constant-time key comparison, synchronous DB logging on hot path, memory leak |

## License

MIT
