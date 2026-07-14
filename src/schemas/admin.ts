import { z } from "zod"

export const OrgCreateSchema = z.object({
  name: z.string().min(1).max(255),
})

export const KeyCreateSchema = z.object({
  org_name: z.string().min(1),
  label: z.string().min(1).max(255),
  prefix: z.string().default("kg_live_"),
  rate_limit_per_minute: z.number().int().min(1).max(10000).default(60),
  scopes: z.array(z.string()).default(["read"]),
})
