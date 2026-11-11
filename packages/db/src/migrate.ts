/**
 * Apply pending Drizzle migrations.
 *
 * Run with: pnpm db:migrate   (from the repo root)
 *
 * Uses the direct/unpooled connection when configured: DDL through a PgBouncer
 * transaction pooler is not supported by every statement Drizzle emits.
 */
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { getConfig } from '@cls/core/env.server'
import { logger } from '@cls/core/logger'

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url))

async function main(): Promise<void> {
  const config = getConfig()
  const url = config.databaseUrlUnpooled
  if (!url) {
    throw new Error('DATABASE_URL (or DATABASE_URL_UNPOOLED) must be set to run migrations.')
  }

  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} })
  try {
    const db = drizzle(sql)
    logger.info('Applying migrations', { folder: MIGRATIONS_FOLDER })
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
    logger.info('Migrations applied')
  } finally {
    await sql.end({ timeout: 10 })
  }
}

main().catch((error: unknown) => {
  logger.error('Migration failed', { error })
  process.exitCode = 1
})
