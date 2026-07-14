import * as crypto from "crypto"
import { Request, Response, NextFunction } from "express"

export interface HmacOptions {
  secret: string
  headerSignature?: string
  headerTimestamp?: string
  headerNonce?: string
  maxClockSkewSeconds?: number
  algorithm?: string
}

export function requireHmac(opts: HmacOptions) {
  const {
    secret,
    headerSignature = "x-signature",
    headerTimestamp = "x-timestamp",
    headerNonce = "x-nonce",
    maxClockSkewSeconds = 300,
    algorithm = "sha256",
  } = opts

  return (req: Request, res: Response, next: NextFunction): void => {
    const signature = req.headers[headerSignature] as string | undefined
    const timestamp = req.headers[headerTimestamp] as string | undefined
    const nonce = req.headers[headerNonce] as string | undefined

    if (!signature || !timestamp || !nonce) {
      res.status(401).json({ detail: "Missing HMAC headers." })
      return
    }

    const ts = parseInt(timestamp, 10)
    if (isNaN(ts)) {
      res.status(401).json({ detail: "Invalid timestamp." })
      return
    }

    const now = Math.floor(Date.now() / 1000)
    if (Math.abs(now - ts) > maxClockSkewSeconds) {
      res.status(401).json({ detail: "Request expired." })
      return
    }

    const payload = `${ts}.${nonce}.${req.method}.${req.path}.${JSON.stringify(req.body)}`
    const expected = crypto.createHmac(algorithm, secret).update(payload).digest("hex")

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      res.status(401).json({ detail: "Invalid signature." })
      return
    }

    next()
  }
}
