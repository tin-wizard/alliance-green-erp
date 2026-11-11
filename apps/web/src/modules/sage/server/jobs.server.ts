/**
 * ADR 0012 handlers for the Sage jobs.
 *
 * The catalogue owns the schedules. This file owns what a run does, and each
 * handler is deliberately thin: the work lives in `reconcile.server.ts`,
 * `probe.server.ts` and the token service so the same code is reachable from a
 * route, a test and a job.
 *
 * `sage.post-pending` is not registered here. Draining the posting queue already
 * runs through the invoicing drain route and the work-order queue path, and a
 * third entry point would let two drains run the same posting. The catalogue
 * entry stays `awaiting-handler` and shows as such in the panel.
 */
import { registerJobHandler, type JobContext, type JobHandler, type JobResult } from '@cls/core/jobs'
import { getPauseGovernor, getQuotaGovernor, getTokenService } from './gateway.server'
import { runTenantProbe } from './probe.server'
import { pollExternal, runReconciliation } from './reconcile.server'

export const sageKeepaliveHandler: JobHandler = async (ctx: JobContext): Promise<JobResult> => {
  if (ctx.dryRun) {
    return { status: 'skipped', recordsProcessed: 0, detail: { reason: 'dry_run' } }
  }
  const status = await getTokenService().keepAlive()
  ctx.logger.info('sage keepalive', { state: status.state, daysSinceRefresh: status.daysSinceRefresh })
  return {
    detail: { state: status.state, daysSinceRefresh: status.daysSinceRefresh },
  }
}

export const sageQuotaGuardHandler: JobHandler = async (ctx: JobContext): Promise<JobResult> => {
  const quota = await getQuotaGovernor().snapshot()
  const ratio = quota.limit > 0 ? quota.used / quota.limit : 0
  if (ratio >= 0.98) {
    // The governor already refuses; pausing records why, so the panel says
    // "quota" rather than leaving an operator to infer it from refusals.
    await getPauseGovernor().pause('quota', `used ${quota.used}/${quota.limit}`)
    ctx.logger.warn('sage paused: quota', { used: quota.used, limit: quota.limit })
  }
  return {
    recordsProcessed: quota.used,
    detail: { used: quota.used, limit: quota.limit, ratio: Number(ratio.toFixed(3)) },
  }
}

export const sagePollExternalHandler: JobHandler = async (ctx: JobContext): Promise<JobResult> => {
  const result = await pollExternal({ now: ctx.scheduledFor, dryRun: ctx.dryRun })
  if (result.errors > 0) {
    ctx.logger.warn('sage poll had unreadable resources', result)
  }
  return {
    recordsProcessed: result.events,
    detail: { events: result.events, errors: result.errors },
  }
}

export const sageReconcileHandler: JobHandler = async (ctx: JobContext): Promise<JobResult> => {
  const result = await runReconciliation({ mode: 'daily', now: ctx.scheduledFor, dryRun: ctx.dryRun })
  ctx.logger.info('sage reconciliation', {
    runId: result.runId,
    status: result.status,
    blockers: result.blockers,
    warnings: result.warnings,
    checked: result.checked,
  })
  return {
    recordsProcessed: result.checked,
    detail: {
      runId: result.runId,
      status: result.status,
      findings: result.findings,
      blockers: result.blockers,
      warnings: result.warnings,
      reason: result.reason,
    },
  }
}

export const sageProbeHandler: JobHandler = async (ctx: JobContext): Promise<JobResult> => {
  const result = await runTenantProbe({ dryRun: ctx.dryRun })
  ctx.logger.info('sage tenant probe', { status: result.status, reportId: result.reportId })
  return {
    detail: { status: result.status, reportId: result.reportId },
  }
}

let registered = false

/**
 * Idempotent registration, called once from the scheduler bootstrap. A second
 * call is a no-op rather than a duplicate-handler error.
 */
export function registerSageJobs(): void {
  if (registered) return
  registerJobHandler('sage.keepalive', sageKeepaliveHandler)
  registerJobHandler('sage.quota-guard', sageQuotaGuardHandler)
  registerJobHandler('sage.poll-external', sagePollExternalHandler)
  registerJobHandler('sage.reconcile', sageReconcileHandler)
  registerJobHandler('sage.probe', sageProbeHandler)
  registered = true
}
