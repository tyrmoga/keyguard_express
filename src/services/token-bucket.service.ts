import { RateLimitResult, IRateLimitBackend } from "../types"

interface Bucket {
  tokens: number
  capacity: number
  refillRate: number
  lastRefill: number
}

export class TokenBucketRateLimitService implements IRateLimitBackend {
  private _buckets = new Map<string, Bucket>()
  private _abuseCounts = new Map<string, [number, number]>()
  private _blocked = new Map<string, number>()
  private _lock = Promise.resolve()
  private _timer: ReturnType<typeof setInterval>

  constructor() {
    this._timer = setInterval(() => this.cleanup(), 120_000)
    this._timer.unref()
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const unlock = this._lock
    let resolve: () => void
    this._lock = new Promise((r) => { resolve = r })
    await unlock
    try {
      return await fn()
    } finally {
      resolve!()
    }
  }

  async isRateLimited(keyId: string, limit: number, windowSeconds = 60): Promise<RateLimitResult> {
    return this.withLock(async () => {
      const now = Date.now() / 1000
      let bucket = this._buckets.get(keyId)
      if (!bucket) {
        bucket = { tokens: limit, capacity: limit, refillRate: limit / windowSeconds, lastRefill: now }
        this._buckets.set(keyId, bucket)
      }

      const elapsed = now - bucket.lastRefill
      bucket.tokens = Math.min(bucket.capacity, bucket.tokens + elapsed * bucket.refillRate)
      bucket.lastRefill = now

      if (bucket.tokens < 1) {
        return { limited: true, remaining: 0 }
      }

      bucket.tokens -= 1
      const remaining = Math.floor(bucket.tokens)
      return { limited: false, remaining }
    })
  }

  async isBlocked(identifier: string): Promise<boolean> {
    return this.withLock(async () => {
      const until = this._blocked.get(identifier)
      if (!until) return false
      if (Date.now() / 1000 > until) {
        this._blocked.delete(identifier)
        return false
      }
      return true
    })
  }

  async block(identifier: string, durationSeconds: number): Promise<void> {
    return this.withLock(async () => {
      this._blocked.set(identifier, Date.now() / 1000 + durationSeconds)
    })
  }

  async trackIpAbuse(ipAddress: string, threshold = 100): Promise<void> {
    return this.withLock(async () => {
      const now = Date.now() / 1000
      let entry = this._abuseCounts.get(ipAddress)
      if (!entry) {
        entry = [0, now]
      }
      let [count, firstSeen] = entry
      if (now - firstSeen > 3600) {
        count = 0
        firstSeen = now
      }
      count++
      this._abuseCounts.set(ipAddress, [count, firstSeen])
      if (count > threshold) {
        this._blocked.set(ipAddress, now + 86400)
      }
    })
  }

  stopCleanup(): void {
    clearInterval(this._timer)
  }

  private cleanup(): void {
    const now = Date.now() / 1000
    for (const [key, bucket] of this._buckets.entries()) {
      if (now - bucket.lastRefill > 3600) this._buckets.delete(key)
    }
    for (const [ip, [, firstSeen]] of this._abuseCounts.entries()) {
      if (now - firstSeen > 3600) this._abuseCounts.delete(ip)
    }
    for (const [ip, until] of this._blocked.entries()) {
      if (now > until) this._blocked.delete(ip)
    }
  }
}
