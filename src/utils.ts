import { Request } from "express"
import * as net from "net"

export function clientIp(req: Request): string {
  if (req.app.get("trust proxy")) {
    const forwarded = req.headers["x-forwarded-for"]
    if (typeof forwarded === "string") {
      return forwarded.split(",")[0].trim()
    }
  }
  return req.ip || req.socket.remoteAddress || "unknown"
}

export function ipInCidr(ip: string, cidr: string): boolean {
  if (cidr.includes(":") || ip.includes(":")) {
    try {
      const ipBuf = net.isIPv6(ip) ? (net as any).ipv6ToBytes ? (net as any).ipv6ToBytes(ip) : Buffer.alloc(0) : Buffer.alloc(0)
      return ip === cidr // fallback to exact match for IPv6
    } catch { return false }
  }
  if (!cidr.includes("/")) return ip === cidr
  const [range, bitsStr] = cidr.split("/")
  const bits = parseInt(bitsStr, 10)
  if (isNaN(bits) || bits < 0 || bits > 32) return false
  const mask = bits === 0 ? 0 : ~(2 ** (32 - bits) - 1)
  const ipNum = ip.split(".").reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0
  const rangeNum = range.split(".").reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0
  return (ipNum & mask) === (rangeNum & mask)
}

export function checkIpAllowlist(ip: string, allowlistJson: string | null | undefined): boolean {
  if (!allowlistJson) return true
  try {
    const ips: string[] = JSON.parse(allowlistJson)
    if (!Array.isArray(ips) || ips.length === 0) return true
    return ips.some((entry) => ipInCidr(ip, entry))
  } catch {
    return false
  }
}

export function secondsUntilTime(targetTimeStr: string): number {
  const now = new Date()
  const formats = [
    /^(\d{1,2}):(\d{2})$/,
    /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i,
    /^(\d{1,2})\s*(AM|PM)$/i,
  ]

  let hours = 0
  let minutes = 0
  let matched = false

  for (const fmt of formats) {
    const m = targetTimeStr.trim().match(fmt)
    if (!m) continue
    matched = true

    const ampm = (m[3] || m[2])?.toUpperCase?.()
    if (ampm === "PM" || ampm === "AM") {
      const h = parseInt(m[1])
      hours = ampm === "PM" ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h)
      minutes = parseInt(m[2]) || 0
    } else {
      hours = parseInt(m[1])
      minutes = parseInt(m[2])
    }

    break
  }

  if (!matched) {
    return 3600
  }

  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0)
  if (target <= now) {
    target.setDate(target.getDate() + 1)
  }

  return Math.max(1, Math.floor((target.getTime() - now.getTime()) / 1000))
}
