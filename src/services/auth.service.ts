import * as crypto from "crypto"

const PBKDF2_ITERATIONS = 100_000

export class AuthService {
  constructor(private readonly secretKey: string) {}

  generateApiKey(prefix = "kg_live_"): [rawKey: string, keyHash: string, keySalt: string, stretchedHash: string] {
    const randomPart = crypto.randomBytes(32).toString("base64url")
    const rawKey = `${prefix}${randomPart}`
    const keyHash = this.hashKey(rawKey)
    const keySalt = crypto.randomBytes(16).toString("base64url")
    const stretchedHash = this.stretchKey(rawKey, keySalt)
    return [rawKey, keyHash, keySalt, stretchedHash]
  }

  hashKey(key: string): string {
    const payload = `${key}${this.secretKey}`
    return crypto.createHash("sha256").update(payload).digest("hex")
  }

  stretchKey(key: string, salt: string): string {
    return crypto.pbkdf2Sync(key, `${salt}${this.secretKey}`, PBKDF2_ITERATIONS, 32, "sha512").toString("hex")
  }

}
