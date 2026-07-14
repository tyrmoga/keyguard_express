import * as crypto from "crypto"
import { Router, Request, Response } from "express"
import { KeyGuard } from "../core"
import { OrgCreateSchema, KeyCreateSchema } from "../schemas/admin"

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

export function createAdminRouter(kg: KeyGuard): Router {
  const router = Router()

  function verifyAdmin(req: Request, res: Response, next: () => void): void {
    const key = req.headers["x-admin-key"] as string | undefined
    if (!key || !constantTimeEqual(key, kg.config.adminKey)) {
      res.status(403).json({ detail: "Invalid admin key." })
      return
    }
    next()
  }

  // ── Organizations ──

  router.post("/orgs", verifyAdmin, (req: Request, res: Response) => {
    const parsed = OrgCreateSchema.safeParse(req.body)
    if (!parsed.success) return void res.status(400).json({ detail: parsed.error.flatten() })

    const existing = kg.db.findOrganizationByName(parsed.data.name)
    if (existing) return void res.status(400).json({ detail: `Organization '${parsed.data.name}' already exists.` })

    const org = kg.db.createOrganization(parsed.data.name)
    res.status(201).json({
      id: org.id,
      name: org.name,
      status: org.status,
      created_at: org.created_at,
      key_count: 0,
    })
  })

  router.get("/orgs", verifyAdmin, (_req: Request, res: Response) => {
    const orgs = kg.db.listOrganizations()
    res.json({
      organizations: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        status: o.status,
        created_at: o.created_at,
        key_count: o.key_count,
      })),
      total: orgs.length,
    })
  })

  // ── API Keys ──

  router.post("/keys", verifyAdmin, (req: Request, res: Response) => {
    const parsed = KeyCreateSchema.safeParse(req.body)
    if (!parsed.success) return void res.status(400).json({ detail: parsed.error.flatten() })

    const org = kg.db.findOrganizationByName(parsed.data.org_name)
    if (!org) return void res.status(404).json({ detail: `Organization '${parsed.data.org_name}' not found.` })

    const [rawKey, keyHash] = kg.auth.generateApiKey(parsed.data.prefix)
    const apiKey = kg.db.createApiKey({
      org_id: org.id,
      label: parsed.data.label,
      prefix: rawKey.slice(0, 12),
      key_hash: keyHash,
      rate_limit_per_minute: parsed.data.rate_limit_per_minute,
      scopes: parsed.data.scopes,
    })

    res.status(201).json({
      id: apiKey.id,
      label: apiKey.label,
      prefix: apiKey.prefix,
      raw_key: rawKey,
      rate_limit_per_minute: apiKey.rate_limit_per_minute,
      scopes: JSON.parse(apiKey.scopes || "[]"),
      org_name: org.name,
      created_at: apiKey.created_at,
    })
  })

  router.get("/keys", verifyAdmin, (_req: Request, res: Response) => {
    const keys = kg.db.listApiKeys()
    const items = keys.map((k) => {
      const org = kg.db.getOrganization(k.org_id)
      return {
        id: k.id,
        label: k.label,
        prefix: k.prefix,
        is_active: !!k.is_active,
        rate_limit_per_minute: k.rate_limit_per_minute,
        scopes: JSON.parse(k.scopes || "[]"),
        org_name: org?.name || "",
        created_at: k.created_at,
        last_used_at: k.last_used_at,
      }
    })
    res.json({ keys: items, total: items.length })
  })

  router.delete("/keys/:keyId", verifyAdmin, (req: Request, res: Response) => {
    const key = kg.db.getApiKey(req.params.keyId)
    if (!key) return void res.status(404).json({ detail: "Key not found." })

    kg.db.revokeApiKey(key.id)
    res.json({ detail: `Key '${key.label}' revoked.`, key_id: key.id })
  })

  // ── Stats ──

  router.get("/stats", verifyAdmin, (_req: Request, res: Response) => {
    const s = kg.db.getStats()
    const errorRate = s.totalRequests > 0 ? parseFloat(((s.errorCount / s.totalRequests) * 100).toFixed(2)) : 0.0
    res.json({
      total_organizations: s.orgCount,
      total_keys: s.totalKeys,
      active_keys: s.activeKeys,
      total_requests: s.totalRequests,
      recent_requests_1h: s.recentRequests,
      top_keys: s.topKeys,
      error_rate: errorRate,
    })
  })

  return router
}
