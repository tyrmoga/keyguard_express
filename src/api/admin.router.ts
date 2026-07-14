import * as crypto from "crypto"
import { Router, Request, Response } from "express"
import { z } from "zod"
import { KeyGuard } from "../core"
import { clientIp } from "../utils"
import { OrgCreateSchema, KeyCreateSchema, RotationSchema } from "../schemas/admin"

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

function audit(kg: KeyGuard, req: Request, adminTokenId: string | null, action: string, targetType: string, targetId: string): void {
  setImmediate(() => {
    kg.db.logAdminAction(adminTokenId, action, targetType, targetId, clientIp(req))
  })
}

export function createAdminRouter(kg: KeyGuard): Router {
  const router = Router()

  function verifyAdmin(req: Request, res: Response, next: () => void): void {
    const key = req.headers["x-admin-key"] as string | undefined
    if (!key) {
      res.status(403).json({ detail: "Invalid admin key." })
      return
    }

    // Check global admin key first (owner role, backward compatible)
    if (constantTimeEqual(key, kg.config.adminKey)) {
      ;(req as any).adminTokenId = null
      ;(req as any).adminRole = "owner"
      return next()
    }

    // Check stored admin tokens
    const tokenHash = crypto.createHash("sha256").update(key).digest("hex")
    const token = kg.db.findAdminTokenByHash(tokenHash)
    if (!token) {
      res.status(403).json({ detail: "Invalid admin key." })
      return
    }

    ;(req as any).adminTokenId = token.id
    ;(req as any).adminRole = token.role
    ;(req as any).adminOrgId = token.org_id || null

    setImmediate(() => kg.db.updateAdminTokenLastUsed(token.id))
    next()
  }

  function requireOwner(req: Request, res: Response, next: () => void): void {
    if ((req as any).adminRole !== "owner") {
      res.status(403).json({ detail: "Owner access required." })
      return
    }
    next()
  }

  function requireOrgAccess(req: Request, res: Response, next: () => void): void {
    const role = (req as any).adminRole
    if (role === "owner") return next()
    if (role === "org_admin" && (req as any).adminOrgId) {
      // Set the org_id from the token so downstream handlers can use it
      ;(req as any).scopedOrgId = (req as any).adminOrgId
      return next()
    }
    res.status(403).json({ detail: "Access denied to this organization." })
  }

  function withAudit(action: string, targetType: string, targetIdFn: (req: Request) => string) {
    return (req: Request, res: Response, next: () => void): void => {
      const originalJson = res.json.bind(res)
      res.json = function (body: any): Response {
        audit(kg, req, (req as any).adminTokenId, action, targetType, targetIdFn(req))
        return originalJson(body)
      }
      next()
    }
  }

  // ── Organizations ──

  router.post("/orgs", verifyAdmin, requireOwner, (req: Request, res: Response) => {
    const parsed = OrgCreateSchema.safeParse(req.body)
    if (!parsed.success) return void res.status(400).json({ detail: parsed.error.flatten() })

    const existing = kg.db.findOrganizationByName(parsed.data.name)
    if (existing) return void res.status(400).json({ detail: `Organization '${parsed.data.name}' already exists.` })

    const org = kg.db.createOrganization(parsed.data.name)
    audit(kg, req, (req as any).adminTokenId, "create_org", "organization", org.id)
    res.status(201).json({
      id: org.id,
      name: org.name,
      status: org.status,
      created_at: org.created_at,
      key_count: 0,
    })
  })

  router.get("/orgs", verifyAdmin, requireOwner, (_req: Request, res: Response) => {
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

  router.post("/keys", verifyAdmin, requireOrgAccess, (req: Request, res: Response) => {
    const parsed = KeyCreateSchema.safeParse(req.body)
    if (!parsed.success) return void res.status(400).json({ detail: parsed.error.flatten() })

    const orgName = parsed.data.org_name
    const org = kg.db.findOrganizationByName(orgName)
    if (!org) return void res.status(404).json({ detail: `Organization '${orgName}' not found.` })

    // org_admin scoped to a different org
    const scopedOrgId = (req as any).scopedOrgId
    if (scopedOrgId && scopedOrgId !== org.id) {
      return void res.status(403).json({ detail: "Access denied to this organization." })
    }

    const [rawKey, keyHash, keySalt, stretchedHash] = kg.auth.generateApiKey(parsed.data.prefix)
    const apiKey = kg.db.createApiKey({
      org_id: org.id,
      label: parsed.data.label,
      prefix: rawKey.slice(0, 20),
      key_hash: keyHash,
      rate_limit_per_minute: parsed.data.rate_limit_per_minute,
      scopes: parsed.data.scopes,
      monthly_limit: parsed.data.monthly_limit,
      expires_at: parsed.data.expires_at,
      rotates_to_id: parsed.data.rotates_to_id,
      key_salt: keySalt,
      key_hash_stretched: stretchedHash,
    })

    audit(kg, req, (req as any).adminTokenId, "create_key", "api_key", apiKey.id)
    res.status(201).json({
      id: apiKey.id,
      label: apiKey.label,
      prefix: apiKey.prefix,
      raw_key: rawKey,
      rate_limit_per_minute: apiKey.rate_limit_per_minute,
      monthly_limit: apiKey.monthly_limit,
      expires_at: apiKey.expires_at,
      scopes: JSON.parse(apiKey.scopes || "[]"),
      org_name: org.name,
      created_at: apiKey.created_at,
    })
  })

  router.get("/keys", verifyAdmin, requireOwner, (_req: Request, res: Response) => {
    const keys = kg.db.listApiKeys()
    const items = keys.map((k) => {
      const org = kg.db.getOrganization(k.org_id)
      return {
        id: k.id,
        label: k.label,
        prefix: k.prefix,
        is_active: !!k.is_active,
        rate_limit_per_minute: k.rate_limit_per_minute,
        monthly_limit: k.monthly_limit,
        expires_at: k.expires_at,
        scopes: JSON.parse(k.scopes || "[]"),
        org_name: org?.name || "",
        created_at: k.created_at,
        last_used_at: k.last_used_at,
      }
    })
    res.json({ keys: items, total: items.length })
  })

  router.post("/keys/:keyId/rotate", verifyAdmin, requireOrgAccess, (req: Request, res: Response) => {
    const oldKey = kg.db.getApiKey(req.params.keyId)
    if (!oldKey) return void res.status(404).json({ detail: "Key not found." })

    const parsed = RotationSchema.safeParse(req.body)
    if (!parsed.success) return void res.status(400).json({ detail: parsed.error.flatten() })

    const newKey = kg.db.getApiKey(parsed.data.target_key_id)
    if (!newKey) return void res.status(404).json({ detail: "Target key not found." })

    if (oldKey.id === newKey.id) {
      return void res.status(400).json({ detail: "Cannot rotate a key to itself." })
    }
    if (newKey.rotates_to_id === oldKey.id) {
      return void res.status(400).json({ detail: "Rotation cycle detected: target key already rotates back to this key." })
    }

    kg.db.setRotation(oldKey.id, newKey.id)
    audit(kg, req, (req as any).adminTokenId, "rotate_key", "api_key", oldKey.id)
    res.json({ detail: `Key '${oldKey.label}' now rotates to '${newKey.label}'.` })
  })

  router.delete("/keys/:keyId", verifyAdmin, requireOrgAccess, (req: Request, res: Response) => {
    const key = kg.db.getApiKey(req.params.keyId)
    if (!key) return void res.status(404).json({ detail: "Key not found." })

    kg.db.revokeApiKey(key.id)
    audit(kg, req, (req as any).adminTokenId, "revoke_key", "api_key", key.id)
    res.json({ detail: `Key '${key.label}' revoked.`, key_id: key.id })
  })

  // ── Route Limits ──

  router.get("/orgs/:orgId/route-limits", verifyAdmin, requireOrgAccess, (req: Request, res: Response) => {
    const org = kg.db.getOrganization(req.params.orgId)
    if (!org) return void res.status(404).json({ detail: "Organization not found." })
    const limits = kg.db.listRouteLimits(org.id)
    res.json({ route_limits: limits })
  })

  router.put("/orgs/:orgId/route-limits", verifyAdmin, requireOrgAccess, (req: Request, res: Response) => {
    const org = kg.db.getOrganization(req.params.orgId)
    if (!org) return void res.status(404).json({ detail: "Organization not found." })
    const schema = z.object({
      path: z.string().min(1),
      method: z.string().default("ALL"),
      max_requests: z.number().int().min(1).max(100000).default(60),
      window_seconds: z.number().int().min(1).max(86400).default(60),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return void res.status(400).json({ detail: parsed.error.flatten() })
    const rl = kg.db.upsertRouteLimit(org.id, parsed.data.path, parsed.data.method, parsed.data.max_requests, parsed.data.window_seconds)
    audit(kg, req, (req as any).adminTokenId, "set_route_limit", "route_limit", rl.id)
    res.json(rl)
  })

  router.delete("/route-limits/:id", verifyAdmin, requireOwner, (req: Request, res: Response) => {
    kg.db.deleteRouteLimit(req.params.id)
    audit(kg, req, (req as any).adminTokenId, "delete_route_limit", "route_limit", req.params.id)
    res.json({ detail: "Route limit deleted." })
  })

  // ── Stats ──

  router.get("/stats", verifyAdmin, requireOwner, (_req: Request, res: Response) => {
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

  // ── Admin Token Management (owner only) ──

  const AdminTokenCreateSchema = z.object({
    label: z.string().min(1).max(255),
    role: z.enum(["owner", "org_admin"]).default("org_admin"),
    org_name: z.string().optional(),
  })

  router.post("/admin-tokens", verifyAdmin, requireOwner, (req: Request, res: Response) => {
    const parsed = AdminTokenCreateSchema.safeParse(req.body)
    if (!parsed.success) return void res.status(400).json({ detail: parsed.error.flatten() })

    let orgId: string | undefined
    if (parsed.data.org_name) {
      const org = kg.db.findOrganizationByName(parsed.data.org_name)
      if (!org) return void res.status(404).json({ detail: `Organization '${parsed.data.org_name}' not found.` })
      orgId = org.id
    }

    const rawToken = crypto.randomBytes(32).toString("base64url")
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex")
    const token = kg.db.createAdminToken(parsed.data.label, tokenHash, parsed.data.role, orgId)

    audit(kg, req, (req as any).adminTokenId, "create_admin_token", "admin_token", token.id)
    res.status(201).json({
      id: token.id,
      label: token.label,
      role: token.role,
      org_id: token.org_id,
      raw_token: rawToken,
      created_at: token.created_at,
    })
  })

  router.get("/admin-tokens", verifyAdmin, requireOwner, (_req: Request, res: Response) => {
    const tokens = kg.db.listAdminTokens()
    res.json({ tokens, total: tokens.length })
  })

  router.delete("/admin-tokens/:id", verifyAdmin, requireOwner, (req: Request, res: Response) => {
    kg.db.revokeAdminToken(req.params.id)
    audit(kg, req, (req as any).adminTokenId, "revoke_admin_token", "admin_token", req.params.id)
    res.json({ detail: "Admin token revoked." })
  })

  // ── Audit Log ──

  router.get("/audit-log", verifyAdmin, requireOwner, (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string, 10) || 50
    const entries = kg.db.getAdminAuditLog(limit)
    res.json({ entries, total: entries.length })
  })

  return router
}
