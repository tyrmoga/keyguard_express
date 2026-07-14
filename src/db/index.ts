import { IDatabaseBackend } from "./types"
import { KeyGuardDb } from "./models"
import { PostgresDb } from "./postgres"

export { IDatabaseBackend } from "./types"
export { KeyGuardDb } from "./models"
export { PostgresDb } from "./postgres"

export function createDb(databaseUrl: string): IDatabaseBackend {
  if (databaseUrl.startsWith("postgres")) {
    return new PostgresDb(databaseUrl)
  }
  return new KeyGuardDb(databaseUrl)
}
