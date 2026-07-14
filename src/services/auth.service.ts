import * as crypto from "crypto"

export class AuthService {
  constructor(private readonly secretKey: string) {}

  generateApiKey(prefix = "kg_live_"): [rawKey: string, keyHash: string] {
    const randomPart = crypto.randomBytes(32).toString("base64url")
    const rawKey = `${prefix}${randomPart}`
    const keyHash = this.hashKey(rawKey)
    return [rawKey, keyHash]
  }

  hashKey(key: string): string {
    const payload = `${key}${this.secretKey}`
    return crypto.createHash("sha256").update(payload).digest("hex")
  }

}
