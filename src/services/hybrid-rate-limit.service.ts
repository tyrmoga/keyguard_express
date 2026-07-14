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
    const redisBlocked = await this.redis.get(`block:${identifier}`)
    if (redisBlocked !== null) return true
    return this.memory.isBlocked(identifier)
  }

  async block(identifier: string, durationSeconds: number): Promise<void> {
    await this.redis.set(`block:${identifier}`, "1", "EX", durationSeconds)
    await this.memory.block(identifier, durationSeconds)
  }

  async trackIpAbuse(ipAddress: string, threshold = 100): Promise<void> {
    await this.memory.trackIpAbuse(ipAddress, threshold)
  }

  async disconnect(): Promise<void> {
    this.memory.stopCleanup()
    await this.redis.quit()
  }
}
