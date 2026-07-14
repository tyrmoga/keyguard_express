import { Request, Response, NextFunction } from "express"

export function requireScope(...allowed: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const apiKey = (req as any).apiKey as { scopes: string | null } | undefined
    if (!apiKey) {
      res.status(401).json({ detail: "Authentication required." })
      return
    }

    let keyScopes: string[]
    try {
      keyScopes = JSON.parse(apiKey.scopes || "[]")
    } catch {
      keyScopes = []
    }

    const hasScope = allowed.some((s) => keyScopes.includes(s))
    if (!hasScope) {
      res.status(403).json({ detail: "Insufficient scope." })
      return
    }

    next()
  }
}
