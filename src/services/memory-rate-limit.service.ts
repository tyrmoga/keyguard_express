import { RateLimitResult, IRateLimitBackend } from "../types"

export class MemoryRateLimitService implements IRateLimitBackend {
  private _windows = new Map<string, number[]>()
  private _abuseCounts = new Map<string, [number, number]>()
  private _blocked = new Map<string, number>()
  private _lock = Promise.resolve()

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
      const cutoff = now - windowSeconds
      let timestamps = this._windows.get(keyId) || []

      timestamps = timestamps.filter((t) => t > cutoff)
      const currentCount = timestamps.length

      if (currentCount >= limit) {
        return { limited: true, remaining: 0 }
      }

      timestamps.push(now)
      this._windows.set(keyId, timestamps)
      const remaining = limit - currentCount - 1
      return { limited: false, remaining: Math.max(0, remaining) }
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

  cleanup(): void {
    const now = Date.now() / 1000
    for (const [key, timestamps] of this._windows.entries()) {
      const recent = timestamps.filter((t) => t > now - 120)
      if (recent.length === 0) this._windows.delete(key)
      else this._windows.set(key, recent)
    }
    for (const [ip, [, firstSeen]] of this._abuseCounts.entries()) {
      if (now - firstSeen > 3600) this._abuseCounts.delete(ip)
    }
    for (const [ip, until] of this._blocked.entries()) {
      if (now > until) this._blocked.delete(ip)
    }
  }
}
