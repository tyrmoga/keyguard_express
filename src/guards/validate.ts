import { Request, Response, NextFunction } from "express"
import { z } from "zod"

export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ detail: parsed.error.flatten() })
      return
    }
    req.body = parsed.data
    next()
  }
}

export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ detail: parsed.error.flatten() })
      return
    }
    req.query = parsed.data
    next()
  }
}

export function bodyParser() {
  return import("express").then(({ json, urlencoded }) => [
    json({ limit: "10kb" }),
    urlencoded({ extended: true, limit: "10kb" }),
  ])
}
