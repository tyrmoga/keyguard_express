import Redis from "ioredis"
import { RateLimitResult, IRateLimitBackend } from "../types"
import { MemoryRateLimitService } from "./memory-rate-limit.service"

export class HybridRateLimitService implements IRateLimitBackend {
  private memory: MemoryRateLimitService
  private redis: Redis

  constructor(redisUrl: string) {
    this.memory = new MemoryRateLimitService()
    this.redis = new Redis(redisUrl, {
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
    })
  }

  async isRateLimited(keyId: string, limit: number, windowSeconds = 60): Promise<RateLimitResult> {
    return this.memory.isRateLimited(keyId, limit, windowSeconds)
  }

  async isBlocked(identifier: string): Promise<boolean> {
    try {
      const redisBlocked = await this.redis.get(`block:${identifier}`)
      if (redisBlocked !== null) return true
    } catch {}
    return this.memory.isBlocked(identifier)
  }

  async block(identifier: string, durationSeconds: number): Promise<void> {
    try { await this.redis.set(`block:${identifier}`, "1", "EX", durationSeconds) } catch {}
    await this.memory.block(identifier, durationSeconds)
  }

  async trackIpAbuse(ipAddress: string, threshold = 100): Promise<void> {
    await this.memory.trackIpAbuse(ipAddress, threshold)
    try {
      const count = await this.redis.incr(`abuse:${ipAddress}`)
      if (count === 1) await this.redis.expire(`abuse:${ipAddress}`, 3600)
      if (count > threshold) await this.block(ipAddress, 86400)
    } catch {}
  }

  async disconnect(): Promise<void> {
    this.memory.stopCleanup()
    await this.redis.quit()
  }
}
