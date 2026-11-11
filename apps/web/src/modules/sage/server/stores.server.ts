/**
 * Database-backed stores for the Sage client: connection, quota and pause.
 *
 * The adapters in `@cls/sage` know only interfaces. Keeping the SQL here means
 * the protocol package has no database dependency, so its tests run without a
 * connection and no cycle appears between `@cls/core` and `@cls/db`.
 */
import { eq, sql } from 'drizzle-orm'
import { getDb } from '@cls/db'
import {
  sageConnections,
  sageHealthSamples,
  sagePauseState,
  sageQuotaUsage,
} from '@cls/db/schema'
import {
  type ConnectionRepository,
  type ConnectionStatus,
  type DailyQuotaStore,
  type PauseState,
  type PauseStore,
  type QuotaClass,
  type QuotaUsage,
  type StoredConnection,
} from '@cls/sage'

const CLASSES: QuotaClass[] = ['posting', 'sync', 'payment_poll', 'reconcile', 'probe']

export function dbConnectionRepository(environment: 'sandbox' | 'production'): ConnectionRepository {
  return {
    async load() {
      const db = getDb()
      const [row] = await db
        .select()
        .from(sageConnections)
        .where(eq(sageConnections.environment, environment))
        .limit(1)
      return row ? toStoredConnection(row) : null
    },

    /**
     * The advisory lock is transaction-scoped, so a second process waits here
     * until the first has sealed and saved the rotated pair. That ordering is the
     * whole point: the old refresh token is dead as soon as the response exists.
     */
    async withRefreshLock<T>(fn: (current: StoredConnection | null) => Promise<T>): Promise<T> {
      const db = getDb()
      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sage:refresh:${environment}`}))`)
        const [row] = await tx
          .select()
          .from(sageConnections)
          .where(eq(sageConnections.environment, environment))
          .limit(1)
        return fn(row ? toStoredConnection(row) : null)
      })
    },

    async save(connection) {
      const db = getDb()
      const values = {
        environment,
        businessId: connection.businessId,
        accessTokenSealed: connection.accessTokenSealed,
        refreshTokenSealed: connection.refreshTokenSealed,
        accessExpiresAt: connection.accessExpiresAt,
        refreshExpiresAt: connection.refreshExpiresAt,
        lastRefreshAt: connection.lastRefreshAt,
        state: connection.state,
        message: connection.message,
        updatedAt: new Date(),
      }
      await db
        .insert(sageConnections)
        .values(values)
        .onConflictDoUpdate({ target: sageConnections.environment, set: values })
    },

    async markState(status: ConnectionStatus, message: string) {
      const db = getDb()
      await db
        .update(sageConnections)
        .set({ state: status.state, message, updatedAt: new Date() })
        .where(eq(sageConnections.environment, environment))
    },

    async writeHealthSample(sample) {
      const db = getDb()
      await db.insert(sageHealthSamples).values({
        checkedAt: sample.checkedAt,
        daysSinceRefresh: sample.daysSinceRefresh,
        refreshExpiresAt: sample.refreshExpiresAt,
        state: sample.state,
      })
    },
  }
}

function toStoredConnection(row: typeof sageConnections.$inferSelect): StoredConnection {
  return {
    environment: row.environment === 'production' ? 'production' : 'sandbox',
    businessId: row.businessId,
    accessTokenSealed: row.accessTokenSealed,
    refreshTokenSealed: row.refreshTokenSealed,
    accessExpiresAt: row.accessExpiresAt,
    refreshExpiresAt: row.refreshExpiresAt,
    lastRefreshAt: row.lastRefreshAt,
    state: row.state as StoredConnection['state'],
    message: row.message,
  }
}

export function dbQuotaStore(): DailyQuotaStore {
  return {
    async load(day: string) {
      const db = getDb()
      const rows = await db
        .select({ klass: sageQuotaUsage.class, used: sageQuotaUsage.used })
        .from(sageQuotaUsage)
        .where(eq(sageQuotaUsage.usageDay, day))
      if (rows.length === 0) return null
      const usage: QuotaUsage = {
        day,
        used: 0,
        byClass: { posting: 0, sync: 0, payment_poll: 0, reconcile: 0, probe: 0 },
      }
      for (const row of rows) {
        const klass = row.klass as QuotaClass
        if (!CLASSES.includes(klass)) continue
        usage.byClass[klass] = row.used
        usage.used += row.used
      }
      return usage
    },

    async save(usage) {
      const db = getDb()
      for (const klass of CLASSES) {
        const used = usage.byClass[klass]
        await db
          .insert(sageQuotaUsage)
          .values({ usageDay: usage.day, class: klass, used, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: [sageQuotaUsage.usageDay, sageQuotaUsage.class],
            set: { used, updatedAt: new Date() },
          })
      }
    },
  }
}

export function dbPauseStore(environment: 'sandbox' | 'production'): PauseStore {
  return {
    async load(): Promise<PauseState | null> {
      const db = getDb()
      const [row] = await db
        .select()
        .from(sagePauseState)
        .where(eq(sagePauseState.environment, environment))
        .limit(1)
      if (!row) return null
      return {
        reason: (row.reason as PauseState['reason']) ?? null,
        message: row.message,
        since: row.since ? row.since.toISOString() : null,
        until: row.until ? row.until.toISOString() : null,
        consecutiveServerErrors: row.consecutiveServerErrors,
        windowAttempts: row.windowAttempts,
        windowRejections: row.windowRejections,
      }
    },

    async save(state) {
      const db = getDb()
      const values = {
        environment,
        reason: state.reason,
        message: state.message,
        since: state.since ? new Date(state.since) : null,
        until: state.until ? new Date(state.until) : null,
        consecutiveServerErrors: state.consecutiveServerErrors,
        windowAttempts: state.windowAttempts,
        windowRejections: state.windowRejections,
        updatedAt: new Date(),
      }
      await db
        .insert(sagePauseState)
        .values(values)
        .onConflictDoUpdate({ target: sagePauseState.environment, set: values })
    },
  }
}
