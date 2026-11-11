/**
 * Notification triggers.
 *
 * SERVER ONLY. Delivery is deferred, but the events and templates exist now so
 * the dispatch e-mail and the reminder are not lost behind a missing worker.
 * A queue row is part of the same transaction as the status change.
 */
import { eq } from 'drizzle-orm'
import type { Tx } from '@cls/db'
import { workOrderNotifications, workOrders } from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import { getSubcontractor } from '../lib/lookups'

export type NotificationEvent = 'dispatched' | 'reminder' | 'completed'

export interface NotificationTemplate {
  subject: string
  body: string
}

export function renderTemplate(
  event: NotificationEvent,
  context: {
    workOrderId: number
    siteName: string | null
    expectedCompletion: string | null
    serviceRequired: string
  },
): NotificationTemplate {
  const site = context.siteName ?? `work order ${context.workOrderId}`
  switch (event) {
    case 'dispatched':
      return {
        subject: `Work order ${context.workOrderId} dispatched — ${site}`,
        body: [
          `You have been assigned work order ${context.workOrderId} at ${site}.`,
          context.expectedCompletion ? `Scheduled for ${context.expectedCompletion}.` : null,
          '',
          context.serviceRequired,
          '',
          'Open the subcontractor portal to view the job sheet, add hours and parts, and submit the service report.',
        ]
          .filter((line): line is string => line !== null)
          .join('\n'),
      }
    case 'reminder':
      return {
        subject: `Reminder: work order ${context.workOrderId} — ${site}`,
        body: [
          `This is a reminder that work order ${context.workOrderId} at ${site} is still open.`,
          context.expectedCompletion ? `Scheduled for ${context.expectedCompletion}.` : null,
          'Update the job sheet or contact the office with an expected completion date.',
        ]
          .filter((line): line is string => line !== null)
          .join('\n'),
      }
    case 'completed':
      return {
        subject: `Work order ${context.workOrderId} complete — ${site}`,
        body: `Work order ${context.workOrderId} at ${site} has been marked complete and is awaiting invoice.`,
      }
  }
}

export async function queueNotification(
  tx: Tx,
  input: {
    workOrderId: number
    event: NotificationEvent
    recipient?: string | null
    template: NotificationTemplate
  },
): Promise<void> {
  await tx.insert(workOrderNotifications).values({
    workOrderId: input.workOrderId,
    event: input.event,
    channel: 'email',
    recipient: input.recipient ?? null,
    subject: input.template.subject,
    body: input.template.body,
    status: input.recipient ? 'queued' : 'skipped',
  })
}

/** Manual reminder from the detail screen. Scoped and permission-checked. */
export async function queueReminder(
  workOrderId: number,
  session: AuthSessionView,
  executor?: Tx,
): Promise<{ queued: boolean }> {
  const { assertPermission, loadAccessibleWorkOrder } = await import('./access.server')
  const { getDb } = await import('@cls/db')
  assertPermission(session, 'workorder:write')
  const run = async (tx: Tx) => {
    const row = await loadAccessibleWorkOrder(session, workOrderId, tx)
    const template = renderTemplate('reminder', {
      workOrderId,
      siteName: null,
      expectedCompletion: row.expectedCompletion,
      serviceRequired: row.serviceRequired,
    })
    const subcontractor = row.subcontractorId
      ? await getSubcontractor(row.subcontractorId, tx)
      : null
    await queueNotification(tx, {
      workOrderId,
      event: 'reminder',
      recipient: subcontractor?.email ?? null,
      template,
    })
    return { queued: Boolean(subcontractor?.email) }
  }
  if (executor) return run(executor)
  return getDb().transaction(run)
}

/** Queue the dispatch e-mail to the assigned subcontractor's first contact. */
export async function queueDispatchNotification(
  tx: Tx,
  workOrderId: number,
): Promise<void> {
  const [row] = await tx.select().from(workOrders).where(eq(workOrders.id, workOrderId))
  if (!row) return
  const template = renderTemplate('dispatched', {
    workOrderId,
    siteName: null,
    expectedCompletion: row.expectedCompletion,
    serviceRequired: row.serviceRequired,
  })
  const subcontractor = row.subcontractorId
    ? await getSubcontractor(row.subcontractorId, tx)
    : null
  await queueNotification(tx, {
    workOrderId,
    event: 'dispatched',
    recipient: subcontractor?.email ?? null,
    template,
  })
}
