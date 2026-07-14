import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import { KeyGuardConfigOptions } from "./types"

const INSECURE_KEYS = new Set(["super-secret-admin-key-change-me", "change-me", ""])
const ENV_PATH = path.resolve(process.cwd(), ".env")

function writeEnvVar(key: string, value: string): void {
  const line = `${key}=${value}\n`
  try {
    if (fs.existsSync(ENV_PATH)) {
      let content = fs.readFileSync(ENV_PATH, "utf-8")
      const regex = new RegExp(`^${key}=.*`, "m")
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${value}`)
      } else {
        content += content.endsWith("\n") ? line : `\n${line}`
      }
      fs.writeFileSync(ENV_PATH, content, "utf-8")
    } else {
      fs.mkdirSync(path.dirname(ENV_PATH), { recursive: true })
      fs.writeFileSync(ENV_PATH, `# KeyGuard auto-generated secret key — keep this file secure\n${line}`, "utf-8")
    }
  } catch {
    // best-effort; if .env can't be written, the key is still valid in-memory this session
  }
}

export class KeyGuardConfig {
  readonly databaseUrl: string
  readonly redisUrl: string | null
  readonly secretKey: string
  readonly defaultRateLimitPerMinute: number
  readonly ipBlockThreshold: number
  readonly isSqlite: boolean
  readonly isRedisEnabled: boolean

  constructor(opts: KeyGuardConfigOptions = {}) {
    this.databaseUrl = opts.databaseUrl ?? "sqlite://keyguard.db"
    this.redisUrl = opts.redisUrl ?? null
    this.defaultRateLimitPerMinute = opts.defaultRateLimitPerMinute ?? 60
    this.ipBlockThreshold = opts.ipBlockThreshold ?? 100

    const providedKey = opts.secretKey ?? process.env.SECRET_KEY ?? null
    if (providedKey && !INSECURE_KEYS.has(providedKey)) {
      this.secretKey = providedKey
    } else {
      const generated = crypto.randomBytes(32).toString("base64url")
      writeEnvVar("SECRET_KEY", generated)
      console.warn(
        `\n${"=".repeat(70)}` +
        `\n  SECRET_KEY not set — auto-generated and saved to .env:\n` +
        `\n    ${generated}\n` +
        `\n  It will be loaded automatically on next start.` +
        `\n  To use your own:` +
        `\n    new KeyGuardConfig({ secretKey: 'your-key' })` +
        `\n${"=".repeat(70)}`
      )
      this.secretKey = generated
    }

    this.isSqlite = this.databaseUrl.startsWith("sqlite")
    this.isRedisEnabled = this.redisUrl !== null
  }
}
