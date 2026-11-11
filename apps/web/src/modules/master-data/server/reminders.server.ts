/**
 * Compliance expiry reminders. SERVER ONLY.
 *
 * Runs daily against current WSIB/insurance documents, queues one reminder per
 * document and window, and records the window on the document so a re-run is a
 * no-op. Delivery to email is the messaging module's job; these rows are the
 * durable queue.
 */
import { and, eq, lt, sql } from 'drizzle-orm'
import type { Db, Tx } from '@cls/db'
import { complianceReminders, subcontractorDocuments } from '@cls/db/schema'
import { businessToday } from '../lib/compliance'
import { latestCurrentDocuments } from './documents.server'

export const REMINDER_WINDOWS = [30, 14, 7, 1, 0] as const

function daysBetween(today: string, expiresOn: string): number {
  const start = Date.parse(`${today}T00:00:00Z`)
  const end = Date.parse(`${expiresOn.slice(0, 10)}T00:00:00Z`)
  return Math.round((end - start) / 86_400_000)
}

export interface ReminderRunResult {
  today: string
  scanned: number
  queued: number
  expired: number
  skipped: number
}

export async function runExpiryReminders(
  executor: Db,
  today = businessToday(),
): Promise<ReminderRunResult> {
  return executor.transaction((tx) => runExpiryRemindersInTx(tx, today))
}

export async function runExpiryRemindersInTx(
  tx: Tx,
  today = businessToday(),
): Promise<ReminderRunResult> {
  {
    const expired = await tx
      .update(subcontractorDocuments)
      .set({ isExpired: true })
      .where(
        and(
          lt(subcontractorDocuments.expiresOn, today),
          eq(subcontractorDocuments.isExpired, false),
        ),
      )
      .returning({ id: subcontractorDocuments.id })

    const documents = [
      ...(await latestCurrentDocuments(tx, 'wsib')),
      ...(await latestCurrentDocuments(tx, 'insurance')),
    ]

    // Keep only the newest current document per subcontractor and kind.
    const latest = new Map<string, (typeof documents)[number]>()
    for (const document of documents) {
      if (!document.expiresOn) continue
      const key = `${document.subcontractorId}:${document.kind}`
      if (!latest.has(key)) latest.set(key, document)
    }
    let scanned = 0
    let queued = 0
    let skipped = 0

    for (const document of latest.values()) {
      scanned += 1
      const days = daysBetween(today, document.expiresOn!)
      const window = days < 0 ? -1 : days
      if (!REMINDER_WINDOWS.includes(window as (typeof REMINDER_WINDOWS)[number]) && window !== -1) {
        skipped += 1
        continue
      }

      const inserted = await tx
        .insert(complianceReminders)
        .values({
          subcontractorId: document.subcontractorId,
          documentId: document.id,
          windowDays: window,
          dueOn: document.expiresOn!,
        })
        .onConflictDoNothing({
          target: [complianceReminders.documentId, complianceReminders.windowDays],
        })
        .returning({ id: complianceReminders.id })
      if (inserted.length === 0) {
        skipped += 1
        continue
      }
      queued += 1
      await tx
        .update(subcontractorDocuments)
        .set({
          reminderState: sql`coalesce(${subcontractorDocuments.reminderState}, '{}'::jsonb) || ${JSON.stringify(
            { [String(window)]: { sentAt: new Date().toISOString(), dueOn: document.expiresOn } },
          )}::jsonb`,
        })
        .where(eq(subcontractorDocuments.id, document.id))
    }

    return {
      today,
      scanned,
      queued,
      expired: expired.length,
      skipped,
    }
  }
}
