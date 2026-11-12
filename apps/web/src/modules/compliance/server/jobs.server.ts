/**
 * ADR 0012 handlers for the two compliance schedules.
 *
 * `compliance.document-expiry` owns the durable reminder rows for WSIB and
 * insurance. `compliance.wsib-reminders` is the legacy WSIB track: it runs the
 * same idempotent sweep (the database dedupes per document and window) and
 * reports the ten-day/expired counts the old scripts chased.
 */
import { and, eq, isNull, lte } from 'drizzle-orm'
import type { Tx } from '@cls/db'
import { subcontractorDocuments } from '@cls/db/schema'
import { registerJobHandler, type JobContext, type JobHandler, type JobResult } from '@cls/core/jobs'
import { businessToday } from '../../master-data/lib/compliance'
import { runExpiryRemindersInTx } from '../../master-data/server/reminders.server'

export const complianceDocumentExpiryHandler: JobHandler = async (
  ctx: JobContext,
): Promise<JobResult> => {
  if (ctx.dryRun) {
    return { status: 'skipped', recordsProcessed: 0, detail: { reason: 'dry_run' } }
  }
  const tx = ctx.db as Tx
  const today = businessToday(ctx.scheduledFor)
  const result = await runExpiryRemindersInTx(tx, today)
  ctx.logger.info('compliance expiry sweep', { ...result })
  return {
    recordsProcessed: result.queued,
    detail: { ...result },
  }
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export const complianceWsibRemindersHandler: JobHandler = async (
  ctx: JobContext,
): Promise<JobResult> => {
  if (ctx.dryRun) {
    return { status: 'skipped', recordsProcessed: 0, detail: { reason: 'dry_run' } }
  }
  const tx = ctx.db as Tx
  const today = businessToday(ctx.scheduledFor)
  const sweep = await runExpiryRemindersInTx(tx, today)
  const tenDays = addDays(today, 10)
  const nearExpiry = await tx
    .select({ expiresOn: subcontractorDocuments.expiresOn })
    .from(subcontractorDocuments)
    .where(
      and(
        eq(subcontractorDocuments.kind, 'wsib'),
        isNull(subcontractorDocuments.supersededAt),
        lte(subcontractorDocuments.expiresOn, tenDays),
      ),
    )
  const expired = nearExpiry.filter(
    (row) => row.expiresOn !== null && row.expiresOn < today,
  ).length
  const warning = nearExpiry.length - expired
  ctx.logger.info('WSIB reminder tracks', { today, warning, expired, queued: sweep.queued })
  return {
    recordsProcessed: warning + expired,
    detail: { today, warning, expired, queued: sweep.queued },
  }
}

let registered = false

export function registerComplianceJobs(): void {
  if (registered) return
  registerJobHandler('compliance.document-expiry', complianceDocumentExpiryHandler)
  registerJobHandler('compliance.wsib-reminders', complianceWsibRemindersHandler)
  registered = true
}
