#!/usr/bin/env node
import "dotenv/config"
import { Command } from "commander"
import chalk from "chalk"
import { KeyGuardConfig } from "../config"
import { KeyGuard } from "../core"

const program = new Command()
  .name("keyguard")
  .description("KeyGuard CLI — API key management made simple.")
  .option("--db <url>", "Database URL (default: sqlite://keyguard.db)")
  .option("--redis <url>", "Redis URL (default: none, in-memory rate limiting)")
  .option("--secret <key>", "Secret key for hashing API keys")

function getKg(args: { db?: string; redis?: string; secret?: string }): KeyGuard {
  const cfg = new KeyGuardConfig({
    databaseUrl: args.db,
    redisUrl: args.redis,
    secretKey: args.secret,
  })
  return new KeyGuard(cfg)
}

program
  .command("init")
  .description("Initialize database tables")
  .action(async (_args, cmd) => {
    const opts = cmd.parent?.opts() ?? {}
    const kg = getKg(opts)
    await kg.initDb()
    console.log(`${chalk.green("✓")} Database initialized: ${kg.config.databaseUrl}`)
  })

program
  .command("create-org")
  .description("Create an organization")
  .argument("<name>", "Organization name")
  .action(async (name: string, _args, cmd) => {
    const opts = cmd.parent?.opts() ?? {}
    const kg = getKg(opts)
    await kg.initDb()

    const existing = await kg.db.findOrganizationByName(name)
    if (existing) {
      console.log(`${chalk.red("✗")} Organization '${name}' already exists.`)
      process.exit(1)
    }

    const org = await kg.db.createOrganization(name)
    console.log(`${chalk.green("✓")} Organization created:`)
    console.log(`  Name: ${org.name}`)
    console.log(`  ID:   ${org.id}`)
  })

program
  .command("create-key")
  .description("Generate a new API key")
  .requiredOption("--org <name>", "Organization name")
  .requiredOption("--label <label>", "Key label/description")
  .option("--prefix <prefix>", "Key prefix", "kg_live_")
  .option("--rate-limit <n>", "Requests per minute", parseInt)
  .option("--scopes <scopes>", "Comma-separated scopes", "read")
  .action(async (args, cmd) => {
    const opts = cmd.parent?.opts() ?? {}
    const kg = getKg(opts)
    await kg.initDb()

    const org = await kg.db.findOrganizationByName(args.org)
    if (!org) {
      console.log(`${chalk.red("✗")} Organization '${args.org}' not found.`)
      console.log(`  Create one first: keyguard create-org "${args.org}"`)
      process.exit(1)
    }

    const [rawKey, keyHash, keySalt, stretchedHash] = kg.auth.generateApiKey(args.prefix)
    const rateLimit = args.rateLimit || kg.config.defaultRateLimitPerMinute
    const scopes = args.scopes.split(",").map((s: string) => s.trim())

    const apiKey = await kg.db.createApiKey({
      org_id: org.id,
      label: args.label,
      prefix: rawKey.slice(0, 20),
      key_hash: keyHash,
      rate_limit_per_minute: rateLimit,
      scopes,
      key_salt: keySalt,
      key_hash_stretched: stretchedHash,
    })

    console.log(`${chalk.green("✓")} API key created:`)
    console.log(`  Label:      ${args.label}`)
    console.log(`  Org:        ${org.name}`)
    console.log(`  Rate Limit: ${rateLimit}/min`)
    console.log(`  Scopes:     ${scopes.join(", ")}`)
    console.log()
    console.log(`  ${chalk.yellow("╔".padEnd(58, "═") + "╗")}`)
    console.log(`  ${chalk.yellow("║")}  API KEY (save this — it won't be shown again!)  ${chalk.yellow("║")}`)
    console.log(`  ${chalk.yellow("║")}  ${rawKey.padEnd(52)} ${chalk.yellow("║")}`)
    console.log(`  ${chalk.yellow("╚".padEnd(58, "═") + "╝")}`)
  })

program
  .command("list-orgs")
  .description("List all organizations")
  .action(async (_args, cmd) => {
    const opts = cmd.parent?.opts() ?? {}
    const kg = getKg(opts)
    await kg.initDb()

    const orgs = await kg.db.listOrganizations()
    if (orgs.length === 0) {
      console.log("No organizations found. Create one:")
      console.log("  keyguard create-org \"My Company\"")
      return
    }

    console.log()
    console.log(`${"Name".padEnd(30)} ${"Status".padEnd(12)} ${"Keys".padEnd(8)} ID`)
    console.log("─".repeat(90))
    for (const o of orgs) {
      console.log(`${o.name.padEnd(30)} ${o.status.padEnd(12)} ${String(o.key_count).padEnd(8)} ${o.id}`)
    }
    console.log(`\nTotal: ${orgs.length} organization(s)`)
  })

program
  .command("list-keys")
  .description("List all API keys")
  .action(async (_args, cmd) => {
    const opts = cmd.parent?.opts() ?? {}
    const kg = getKg(opts)
    await kg.initDb()

    const keys = await kg.db.listApiKeys()
    if (keys.length === 0) {
      console.log("No API keys found. Create one:")
      console.log('  keyguard create-key --org "My Org" --label "my-key"')
      return
    }

    console.log()
    console.log(
      `${"Label".padEnd(25)} ${"Prefix".padEnd(15)} ${"Org".padEnd(20)} ${"Status".padEnd(10)} ${"Rate/min".padEnd(10)} Last Used`
    )
    console.log("─".repeat(110))
    for (const k of keys) {
      const status = k.is_active ? "active" : "revoked"
      const org = await kg.db.getOrganization(k.org_id)
      const orgName = org?.name || "—"
      const lastUsed = k.last_used_at || "never"
      console.log(
        `${k.label.padEnd(25)} ${k.prefix.padEnd(15)} ${orgName.padEnd(20)} ${status.padEnd(10)} ${String(k.rate_limit_per_minute).padEnd(10)} ${lastUsed}`
      )
    }
    console.log(`\nTotal: ${keys.length} key(s)`)
  })

program
  .command("revoke-key")
  .description("Revoke an API key by prefix")
  .argument("<prefix>", "Key prefix to revoke")
  .action(async (prefix: string, _args, cmd) => {
    const opts = cmd.parent?.opts() ?? {}
    const kg = getKg(opts)
    await kg.initDb()

    const key = await kg.db.findApiKeyByPrefix(prefix)
    if (!key) {
      console.log(`${chalk.red("✗")} No key found with prefix '${prefix}'`)
      process.exit(1)
    }

    if (!key.is_active) {
      console.log(`Key '${key.label}' is already revoked.`)
      return
    }

    await kg.db.revokeApiKey(key.id)
    console.log(`${chalk.green("✓")} Key '${key.label}' (prefix: ${key.prefix}) has been revoked.`)
  })

program
  .command("stats")
  .description("Show usage statistics")
  .action(async (_args, cmd) => {
    const opts = cmd.parent?.opts() ?? {}
    const kg = getKg(opts)
    await kg.initDb()

    const s = await kg.db.getStats()
    const errorRate = s.totalRequests > 0 ? ((s.errorCount / s.totalRequests) * 100).toFixed(1) : "0.0"

    console.log()
    console.log("╔══════════════════════════════════════╗")
    console.log("║        KeyGuard Statistics           ║")
    console.log("╠══════════════════════════════════════╣")
    console.log(`║  Organizations:    ${String(s.orgCount).padEnd(17)} ║`)
    console.log(`║  Total Keys:       ${String(s.totalKeys).padEnd(17)} ║`)
    console.log(`║  Active Keys:      ${String(s.activeKeys).padEnd(17)} ║`)
    console.log(`║  Total Requests:   ${String(s.totalRequests).padEnd(17)} ║`)
    console.log(`║  Requests (1h):    ${String(s.recentRequests).padEnd(17)} ║`)
    console.log(`║  Error Rate:       ${errorRate.padEnd(17)}% ║`)
    console.log("╚══════════════════════════════════════╝")
  })

program.parse()
