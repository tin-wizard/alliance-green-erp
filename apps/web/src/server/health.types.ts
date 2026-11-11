/**
 * Client-safe health types (shared by the dashboard and the server routes).
 */
import type { DatabaseHealth } from '@cls/db'
import type { SageHealth } from '@cls/sage'
import type { StorageHealth } from '@cls/storage'
import type { AiHealth } from '@cls/ai'

export interface ServiceHealth {
  status: 'ok' | 'not_configured' | 'unavailable'
  message: string
}

export interface HealthReport {
  status: 'ok' | 'degraded'
  version: string
  node: string
  uptimeSeconds: number
  checkedAt: string
  checks: {
    database: DatabaseHealth
    sage: {
      status: SageHealth['status']
      environment: 'sandbox' | 'production'
      businessId: string | null
      /** Whole days since the last refresh or keep-alive; null when unconnected. */
      tokenAgeDays: number | null
      quota: { used: number; limit: number; resetsAt: string }
      message: string
    }
    auth: ServiceHealth
    storage: StorageHealth
    ai: AiHealth
  }
}
