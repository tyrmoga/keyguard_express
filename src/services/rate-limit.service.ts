import * as crypto from "crypto"
import Redis from "ioredis"
import { RateLimitResult, IRateLimitBackend } from "../types"

export class RateLimitService implements IRateLimitBackend {
  private redis: Redis

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
    })
  }

  async isRateLimited(keyId: string, limit: number, windowSeconds = 60): Promise<RateLimitResult> {
    const now = Date.now() / 1000
    const redisKey = `ratelimit:${keyId}`
    const cutoff = now - windowSeconds

    // Prune old entries and read current count before deciding
    const multi = this.redis.multi()
    multi.zremrangebyscore(redisKey, 0, cutoff)
    multi.zcard(redisKey)

    const results = await multi.exec()
    if (!results) return { limited: true, remaining: 0 }

    const currentCount = results[1][1] as number

    if (currentCount >= limit) {
      return { limited: true, remaining: 0 }
    }

    // Only record this request when it's within the limit
    const member = `${now}:${crypto.randomUUID()}`
    await this.redis.zadd(redisKey, now, member)
    await this.redis.expire(redisKey, windowSeconds + 1)

    const remaining = limit - currentCount - 1
    return { limited: false, remaining: Math.max(0, remaining) }
  }

  async isBlocked(identifier: string): Promise<boolean> {
    const val = await this.redis.get(`block:${identifier}`)
    return val !== null
  }

  async block(identifier: string, durationSeconds: number): Promise<void> {
    await this.redis.set(`block:${identifier}`, "1", "EX", durationSeconds)
  }

  async trackIpAbuse(ipAddress: string, threshold = 100): Promise<void> {
    const key = `abuse:${ipAddress}`
    const count = await this.redis.incr(key)
    if (count === 1) {
      await this.redis.expire(key, 3600)
    }
    if (count > threshold) {
      await this.block(ipAddress, 86400)
    }
  }

  async disconnect(): Promise<void> {
    await this.redis.quit()
  }
}
