import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { ServiceUnavailableError } from '@cls/core'
import { getConfig } from '@cls/core/env.server'
import * as schema from './schema'

/**
 * Postgres access.
 *
 * SERVER ONLY. Never import this from a React component.
 *
 * The connection is lazy: importing this module must not throw when
 * DATABASE_URL is unset, because the login screen and /api/health have to boot
 * and report the problem instead of crash-looping.
 */

export type Db = PostgresJsDatabase<typeof schema>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type Executor = Db | Tx

/**
 * Neon's pooled endpoint runs PgBouncer in transaction mode, where prepared
 * statements are not safe. `prepare: false` costs a little CPU and removes a
 * whole class of intermittent "prepared statement already exists" failures.
 *
 * TLS is verified against the system CA. Neon's certificates chain to a public
 * CA, so `require` is treated as `verify-full` rather than silently accepting
 * any certificate. Use `sslmode=disable` only for a local throwaway database.
 */
function sslFor(url: string): postgres.Options<Record<string, never>>['ssl'] {
  if (/sslmode=disable/.test(url)) return false
  if (/sslmode=(verify-ca|verify-full|require|prefer)/.test(url)) {
    return { rejectUnauthorized: true }
  }
  if (/neon\.tech/.test(url)) return { rejectUnauthorized: true }
  return undefined
}

let sqlClient: ReturnType<typeof postgres> | undefined
let database: Db | undefined

export function isDatabaseConfigured(): boolean {
  return Boolean(getConfig().databaseUrl)
}

export function getSql(): ReturnType<typeof postgres> {
  if (!isDatabaseConfigured()) {
    throw new ServiceUnavailableError(
      'Postgres',
      'DATABASE_URL is not configured. Add the Neon connection string to .env.',
    )
  }
  if (!sqlClient) {
    const url = getConfig().databaseUrl as string
    sqlClient = postgres(url, {
      // A migration runs several transactions at once; the app keeps the default.
      max: Number(process.env.DB_POOL_MAX) > 0 ? Number(process.env.DB_POOL_MAX) : 10,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      ssl: sslFor(url),
      onnotice: () => {},
    })
  }
  return sqlClient
}

export function getDb(): Db {
  if (!database) {
    database = drizzle(getSql(), { schema, casing: 'snake_case' })
  }
  return database
}

export interface DatabaseHealth {
  status: 'ok' | 'unavailable' | 'not_configured'
  latencyMs?: number
  error?: string
}

/**
 * Cheap connectivity probe for /api/health. Resolves within `timeoutMs` even if
 * the driver hangs; a hung query resolving later is harmless.
 */
export async function checkDatabase(timeoutMs = 6000): Promise<DatabaseHealth> {
  if (!isDatabaseConfigured()) {
    return { status: 'not_configured', error: 'DATABASE_URL is not set' }
  }
  const started = Date.now()
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      getSql()`select 1 as ok`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
    return { status: 'ok', latencyMs: Date.now() - started }
  } catch (error) {
    return {
      status: 'unavailable',
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : 'Unknown database error',
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function closeDb(): Promise<void> {
  if (sqlClient) {
    await sqlClient.end({ timeout: 5 })
    sqlClient = undefined
    database = undefined
  }
}

export { schema }
