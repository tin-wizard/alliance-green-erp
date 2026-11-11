import { APP_VERSION } from '@cls/core'
import { getConfig } from '@cls/core/env.server'
import { checkDatabase, getDb } from '@cls/db'
import { sageReconciliationRuns } from '@cls/db/schema'
import { desc, eq } from 'drizzle-orm'
import { getSageHealthAdapter } from '../modules/sage/server/gateway.server'
import type { SageHealth } from '@cls/sage'
import { getStorage } from '@cls/storage'
import { aiHealth } from '@cls/ai'
import { isNeonAuthConfigured, getNeonAuth } from '@cls/auth'
import type { HealthReport, ServiceHealth } from './health.types'

const RECONCILIATION_STALE_MS = 26 * 60 * 60 * 1000

/**
 * Was the books check run recently, and did it pass?
 *
 * A missing or stale run is what makes "Sage is connected" misleading: the token
 * can be perfect while nothing has been compared for a week.
 */
async function reconciliationHealth(): Promise<{
  status: 'ok' | 'stale' | 'never' | 'error'
  lastRunAt: string | null
  message: string
}> {
  if (!getConfig().sage.enabled) {
    return { status: 'never', lastRunAt: null, message: 'Sage is disabled.' }
  }
  try {
    const [run] = await getDb()
      .select({
        status: sageReconciliationRuns.status,
        finishedAt: sageReconciliationRuns.finishedAt,
        startedAt: sageReconciliationRuns.startedAt,
        error: sageReconciliationRuns.error,
      })
      .from(sageReconciliationRuns)
      .where(eq(sageReconciliationRuns.mode, 'daily'))
      .orderBy(desc(sageReconciliationRuns.id))
      .limit(1)
    if (!run?.finishedAt) {
      return { status: 'never', lastRunAt: null, message: 'No reconciliation run has finished.' }
    }
    const lastRunAt = run.finishedAt.toISOString()
    const age = Date.now() - run.finishedAt.getTime()
    if (age > RECONCILIATION_STALE_MS) {
      return {
        status: 'stale',
        lastRunAt,
        message: `The last reconciliation finished ${Math.round(age / 3_600_000)} hours ago.`,
      }
    }
    if (run.status === 'error') {
      return { status: 'error', lastRunAt, message: run.error ?? 'The last reconciliation errored.' }
    }
    return { status: 'ok', lastRunAt, message: `Last reconciliation ${run.status}.` }
  } catch (error) {
    return {
      status: 'error',
      lastRunAt: null,
      message: error instanceof Error ? error.message : 'Could not read reconciliation runs.',
    }
  }
}

async function authHealth(): Promise<ServiceHealth> {
  if (!isNeonAuthConfigured()) {
    return {
      status: 'not_configured',
      message: 'NEON_AUTH_BASE_URL and NEON_AUTH_JWKS_URL are not set.',
    }
  }
  try {
    const result = await getNeonAuth().health()
    return {
      status: result.ok ? 'ok' : 'unavailable',
      message: result.message,
    }
  } catch (error) {
    return {
      status: 'unavailable',
      message: error instanceof Error ? error.message : 'Neon Auth is unavailable',
    }
  }
}

/**
 * One health report used by the `/api/health` server route, the readiness
 * probe and the dashboard card, so they can never disagree.
 *
 * Only the database makes the app `degraded`: Sage is cloud and optional, and
 * AI is intentionally off. Storage and auth report their own state.
 */
export async function buildHealthReport(): Promise<HealthReport> {
  const [database, sage, auth, storage, ai, reconciliation] = await Promise.all([
    checkDatabase(),
    getSageHealthAdapter()
      .health()
      .catch(
        (error: unknown): SageHealth => ({
          status: 'error',
          checkedAt: new Date(),
          environment: 'sandbox',
          businessId: null,
          accessTokenExpiresAt: null,
          refreshExpiresAt: null,
          tokenAgeDays: null,
          quota: { used: 0, limit: 0, resetsAt: new Date() },
          message: error instanceof Error ? error.message : 'Sage health check failed',
        }),
      ),
    authHealth(),
    getStorage().health(),
    aiHealth(),
    reconciliationHealth(),
  ])

  // A live token with an unrun check is "degraded", not "verified": the thing
  // that proves the books agree has not happened.
  const sageStatus =
    sage.status === 'verified' && (reconciliation.status === 'stale' || reconciliation.status === 'never')
      ? 'degraded'
      : sage.status
  const sageMessage =
    sageStatus === sage.status
      ? sage.message
      : `${sage.message ?? 'Connected.'} ${reconciliation.message}`.trim()

  return {
    status: database.status === 'ok' ? 'ok' : 'degraded',
    version: APP_VERSION,
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    checkedAt: new Date().toISOString(),
    checks: {
      database,
      sage: {
        status: sageStatus,
        environment: sage.environment,
        businessId: sage.businessId,
        tokenAgeDays: sage.tokenAgeDays,
        quota: {
          used: sage.quota.used,
          limit: sage.quota.limit,
          resetsAt: sage.quota.resetsAt.toISOString(),
        },
        message: sageMessage,
        reconciliation,
      },
      auth,
      storage,
      ai,
    },
  }
}
