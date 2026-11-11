/**
 * ADR 0012 handler for `purchasing.rga-notifications`.
 *
 * The catalogue owns the schedule (07:15 weekdays, America/Toronto). This file
 * owns only what a run does: queue durable outbox rows, one per open RGA at most
 * once a week. The runner passes a transaction, so the ledger row and the queued
 * reminders commit together.
 */
import {
  registerJobHandler,
  type JobContext,
  type JobHandler,
  type JobResult,
} from '@cls/core/jobs'
import type { Tx } from '@cls/db'
import { runRgaNotificationJobCore } from './notifications.server'

export const rgaNotificationsHandler: JobHandler = async (ctx: JobContext): Promise<JobResult> => {
  if (ctx.dryRun) {
    return { status: 'skipped', recordsProcessed: 0, detail: { reason: 'dry_run' } }
  }
  const tx = ctx.db as Tx
  const result = await runRgaNotificationJobCore(tx, { now: ctx.scheduledFor })
  ctx.logger.info('queued RGA reminders', {
    businessDate: result.businessDate,
    evaluated: result.evaluated,
    queued: result.queued,
  })
  return {
    recordsProcessed: result.queued,
    detail: {
      businessDate: result.businessDate,
      evaluated: result.evaluated,
      queued: result.queued,
    },
  }
}

let registered = false

/**
 * Idempotent registration. The scheduler bootstrap calls this once; the guard
 * makes a second import a no-op rather than a duplicate-handler error.
 */
export function registerRgaNotificationsJob(): void {
  if (registered) return
  registerJobHandler('purchasing.rga-notifications', rgaNotificationsHandler)
  registered = true
}
