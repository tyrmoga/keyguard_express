import * as assert from "assert"
import { secondsUntilTime, clientIp } from "../utils"
import { AuthService } from "../services/auth.service"
import { MemoryRateLimitService } from "../services/memory-rate-limit.service"

// ── secondsUntilTime ──

function testSecondsUntilTime(input: string, expH: number, expM: number) {
  const s = secondsUntilTime(input)
  const base = Date.now()
  const target = new Date(base + s * 1000 + 999)
  assert.strictEqual(target.getHours(), expH, `${input}: hours`)
  assert.strictEqual(target.getMinutes(), expM, `${input}: minutes`)
}
testSecondsUntilTime("11:59 PM", 23, 59)
testSecondsUntilTime("9:00 AM", 9, 0)
testSecondsUntilTime("1:30 AM", 1, 30)
testSecondsUntilTime("12:00 AM", 0, 0)
testSecondsUntilTime("12:00 PM", 12, 0)
testSecondsUntilTime("23:59", 23, 59)
testSecondsUntilTime("10:15 PM", 22, 15)
testSecondsUntilTime("2:45 PM", 14, 45)
console.log("PASS secondsUntilTime — all formats✓")

// Invalid input falls back to 3600s
const fallback = secondsUntilTime("not-a-time")
assert.ok(fallback >= 1 && fallback <= 86400, "fallback returns sane value")
console.log("PASS secondsUntilTime — fallback on invalid✓")

// ── clientIp ──

function mockReq(ip: string | undefined, forwarded: string | undefined, remote: string, trustProxy = false): any {
  return {
    ip,
    app: { get: () => trustProxy },
    headers: forwarded ? { "x-forwarded-for": forwarded } : {},
    socket: { remoteAddress: remote },
  }
}
assert.strictEqual(clientIp(mockReq("1.2.3.4", undefined, "5.6.7.8")), "1.2.3.4", "req.ip (no trust proxy)")
assert.strictEqual(clientIp(mockReq(undefined, "9.10.11.12, 13.14.15.16", "5.6.7.8", true)), "9.10.11.12", "x-forwarded-for (trust proxy enabled)")
assert.strictEqual(clientIp(mockReq(undefined, "9.10.11.12", "5.6.7.8")), "5.6.7.8", "xff ignored without trust proxy")
assert.strictEqual(clientIp(mockReq(undefined, undefined, "5.6.7.8")), "5.6.7.8", "socket fallback")
assert.strictEqual(clientIp(mockReq(undefined, undefined, "")), "unknown", "unknown fallback")
console.log("PASS clientIp✓")

// ── AuthService ──

const auth = new AuthService("test-pepper")
const [rawKey, keyHash, keySalt, stretchedHash] = auth.generateApiKey("kg_test_")
assert.ok(rawKey.startsWith("kg_test_"), "key prefix")
assert.strictEqual(keyHash, auth.hashKey(rawKey), "SHA-256 hash matches")
assert.ok(keySalt.length > 0, "salt generated")
assert.ok(stretchedHash.length > 0, "stretched hash generated")
assert.strictEqual(stretchedHash, auth.stretchKey(rawKey, keySalt), "stretched hash deterministic")
assert.notStrictEqual(stretchedHash, keyHash, "stretched != SHA-256")
console.log("PASS AuthService — generateApiKey✓")

// Determinism
const h1 = auth.hashKey("same-key")
const h2 = auth.hashKey("same-key")
assert.strictEqual(h1, h2, "hashKey deterministic")
console.log("PASS AuthService — hashKey deterministic✓")

// ── MemoryRateLimitService ──

async function testMemoryRateLimit() {
  const limiter = new MemoryRateLimitService()

  // First request should be allowed
  const r1 = await limiter.isRateLimited("test-key", 3, 60)
  assert.strictEqual(r1.limited, false)
  assert.strictEqual(r1.remaining, 2)

  // Second
  const r2 = await limiter.isRateLimited("test-key", 3, 60)
  assert.strictEqual(r2.limited, false)
  assert.strictEqual(r2.remaining, 1)

  // Third
  const r3 = await limiter.isRateLimited("test-key", 3, 60)
  assert.strictEqual(r3.limited, false)
  assert.strictEqual(r3.remaining, 0)

  // Fourth — should be limited
  const r4 = await limiter.isRateLimited("test-key", 3, 60)
  assert.strictEqual(r4.limited, true)
  assert.strictEqual(r4.remaining, 0)

  // Different key not affected
  const r5 = await limiter.isRateLimited("other-key", 3, 60)
  assert.strictEqual(r5.limited, false)
  assert.strictEqual(r5.remaining, 2)

  // Block / unblock
  assert.strictEqual(await limiter.isBlocked("some-ip"), false)
  await limiter.block("some-ip", 1)
  assert.strictEqual(await limiter.isBlocked("some-ip"), true)

  // Abuse tracking
  assert.strictEqual(await limiter.isBlocked("abuser"), false)
  for (let i = 0; i < 105; i++) {
    await limiter.trackIpAbuse("abuser", 100)
  }
  assert.strictEqual(await limiter.isBlocked("abuser"), true)

  limiter.stopCleanup()
  console.log("PASS MemoryRateLimitService✓")
}

testMemoryRateLimit().then(() => {
  console.log("\nAll tests passed.")
  process.exit(0)
}).catch((err) => {
  console.error("TEST FAILED:", err)
  process.exit(1)
})
