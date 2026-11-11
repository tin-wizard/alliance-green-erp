/**
 * RGA reminders for the ADR 0012 scheduler.
 *
 * The job only writes durable outbox rows; it never sends mail inline. A
 * reminder is due at most once a week per open RGA, and the idempotency key is
 * the business date, so a retry or a second run on the same day adds nothing.
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Tx } from '@cls/db'
import { rgaNotifications, rgas, users } from '@cls/db/schema'
import { ValidationError } from '@cls/core'
import type { AuthSessionView } from '../../../server/auth.types'
import { isOpen, rgaNumber, statusLabel } from '../lib/lifecycle'
import { assertRgaWrite, loadRga } from './access.server'
import { auditRga } from './records.server'

const OPEN_STATUSES = [2, 3, 6, 7]

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export async function runRgaNotificationJobCore(
  tx: Tx,
  input: { now?: Date } = {},
): Promise<{ businessDate: string; evaluated: number; queued: number }> {
  const now = input.now ?? new Date()
  const businessDate = dateKey(now)

  const due = await tx
    .select({
      id: rgas.id,
      status: rgas.status,
      rgaType: rgas.rgaType,
      createdBy: rgas.createdBy,
      creatorEmail: users.email,
      lastReminderAt: sql<string | null>`max(${rgaNotifications.createdAt})`,
    })
    .from(rgas)
    .leftJoin(
      rgaNotifications,
      and(
        eq(rgaNotifications.rgaId, rgas.id),
        eq(rgaNotifications.notifyType, 'Reminder'),
      ),
    )
    .leftJoin(users, eq(users.id, rgas.createdBy))
    .where(inArray(rgas.status, OPEN_STATUSES))
    .groupBy(rgas.id, rgas.status, rgas.rgaType, rgas.createdBy, users.email)
    .having(
      sql`max(${rgaNotifications.createdAt}) is null or max(${rgaNotifications.createdAt}) <= ${now.toISOString()}::timestamptz - interval '7 days'`,
    )

  let queued = 0
  for (const row of due) {
    const inserted = await tx
      .insert(rgaNotifications)
      .values({
        rgaId: row.id,
        notifyType: 'Reminder',
        status: 'pending',
        dueAt: now,
        recipientUserId: row.createdBy,
        recipientEmail: row.creatorEmail,
        subject: `Reminder to follow up on status of ${row.rgaType} ${rgaNumber(row.id)}`,
        body: `${rgaNumber(row.id)} is still ${statusLabel(row.status)}. Update the return or record the credit.`,
        idempotencyKey: `rga:${row.id}:reminder:${businessDate}`,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: rgaNotifications.id })
    queued += inserted.length
  }

  return { businessDate, evaluated: due.length, queued }
}

/** Manual "remind me next week" from the RGA screen. */
export async function queueRgaReminderCore(
  tx: Tx,
  input: { rgaId: number; notifyType?: string; dueAt?: string },
  session: AuthSessionView,
) {
  assertRgaWrite(session)
  const row = await loadRga(session, input.rgaId, tx)
  if (!isOpen(row.status)) {
    throw new ValidationError('Only an open RGA can be reminded.')
  }
  const dueAt = input.dueAt ? new Date(input.dueAt) : new Date()
  const notifyType = input.notifyType ?? 'Reminder'
  const [notification] = await tx
    .insert(rgaNotifications)
    .values({
      rgaId: row.id,
      notifyType,
      status: 'pending',
      dueAt,
      recipientUserId: row.createdBy ?? session.user.id,
      recipientEmail: session.user.email,
      subject: `${notifyType} for ${rgaNumber(row.id)}`,
      body: `${rgaNumber(row.id)} is still ${statusLabel(row.status)}.`,
      idempotencyKey: `rga:${row.id}:${notifyType.toLowerCase()}:${dateKey(dueAt)}`,
    })
    .onConflictDoNothing()
    .returning()
  await auditRga(tx, session, 'rga.reminder', row.id, {
    summary: `Queued ${notifyType.toLowerCase()} for RGA R-${row.id}.`,
    after: notification ? { notificationId: notification.id, dueAt: dueAt.toISOString() } : null,
  })
  return notification ?? null
}
