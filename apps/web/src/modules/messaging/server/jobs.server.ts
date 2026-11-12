/**
 * ADR 0012/0013 drain job. One bounded batch (25), every send awaited inside
 * the invocation. Queued rows are claimed with FOR UPDATE SKIP LOCKED.
 */
import { registerJobHandler, type JobContext, type JobHandler, type JobResult } from '@cls/core/jobs'
import type { Tx } from '@cls/db'
import { drainOutboxCore, transport } from './messaging.server'

export const notificationsDrainHandler: JobHandler = async (ctx: JobContext): Promise<JobResult> => {
  if (ctx.dryRun) {
    return { status: 'skipped', recordsProcessed: 0, detail: { reason: 'dry_run' } }
  }
  const tx = ctx.db as Tx
  const result = await drainOutboxCore(tx, {
    transport: transport(),
    now: ctx.scheduledFor,
    limit: 25,
  })
  ctx.logger.info('notification outbox drained', { ...result })
  return {
    recordsProcessed: result.sent,
    detail: { ...result },
  }
}

let registered = false

export function registerMessagingJobs(): void {
  if (registered) return
  registerJobHandler('platform.notifications-drain', notificationsDrainHandler)
  registered = true
}
