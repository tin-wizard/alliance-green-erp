import { APP_VERSION } from '@cls/core'
import { checkDatabase } from '@cls/db'
import { getSageHealthAdapter } from '../modules/sage/server/gateway.server'
import type { SageHealth } from '@cls/sage'
import { getStorage } from '@cls/storage'
import { aiHealth } from '@cls/ai'
import { isNeonAuthConfigured, getNeonAuth } from '@cls/auth'
import type { HealthReport, ServiceHealth } from './health.types'

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
  const [database, sage, auth, storage, ai] = await Promise.all([
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
  ])

  return {
    status: database.status === 'ok' ? 'ok' : 'degraded',
    version: APP_VERSION,
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    checkedAt: new Date().toISOString(),
    checks: {
      database,
      sage: {
        status: sage.status,
        environment: sage.environment,
        businessId: sage.businessId,
        tokenAgeDays: sage.tokenAgeDays,
        quota: {
          used: sage.quota.used,
          limit: sage.quota.limit,
          resetsAt: sage.quota.resetsAt.toISOString(),
        },
        message: sage.message,
      },
      auth,
      storage,
      ai,
    },
  }
}
