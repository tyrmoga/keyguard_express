import { z } from "zod"

export const OrgCreateSchema = z.object({
  name: z.string().min(1).max(255),
})

export const KeyCreateSchema = z.object({
  org_name: z.string().min(1),
  label: z.string().min(1).max(255),
  prefix: z.string().max(32).default("kg_live_"),
  rate_limit_per_minute: z.number().int().min(1).max(10000).default(60),
  scopes: z.array(z.string()).default(["read"]),
  monthly_limit: z.number().int().min(1).optional(),
  expires_at: z.string().refine((val) => !isNaN(new Date(val).getTime()), {
    message: "Invalid date format. Use ISO 8601 (e.g. 2026-12-31T23:59:59Z) or YYYY-MM-DD HH:MM:SS.",
  }).optional(),
  allowed_ips: z.string().refine((val) => {
    try {
      const parsed = JSON.parse(val)
      return Array.isArray(parsed) && parsed.every((e: any) => typeof e === "string")
    } catch {
      return false
    }
  }, {
    message: "Must be a JSON array of IP/CIDR strings (e.g. [\"10.0.0.0/8\", \"192.168.1.100\"]).",
  }).optional(),
})

export const RotationSchema = z.object({
  target_key_id: z.string().uuid(),
})
