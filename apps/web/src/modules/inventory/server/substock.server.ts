/**
 * Subcontractor stock portal: messages, low-stock subscriptions and the
 * `parts.subignore` visibility rule (E7). Every read is scoped server-side to
 * the signed-in subcontractor.
 */
import { and, asc, desc, eq, ilike, sql } from 'drizzle-orm'
import { ValidationError } from '@cls/core'
import type { Executor, Tx } from '@cls/db'
import { parts, subStockMessages, subStockNotifications } from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import { assertPermission } from '../../../server/middleware'

export function subcontractorIdForSession(session: AuthSessionView): number {
  if (session.user.role === 'subcontractor' && session.user.subcontractorId) {
    return session.user.subcontractorId
  }
  throw new ValidationError('This account is not linked to a subcontractor.')
}

export async function listSubStockPortal(
  session: AuthSessionView,
  input: { search?: string },
  executor: Executor,
) {
  assertPermission(session, 'inventory:sub_stock')
  const subcontractorId = subcontractorIdForSession(session)
  const term = input.search?.trim()
  const partsWhere = term
    ? and(eq(parts.subignore, false), ilike(parts.partNumber, `%${term}%`))
    : eq(parts.subignore, false)

  const [messages, subscriptions, visibleParts, unread] = await Promise.all([
    executor
      .select()
      .from(subStockMessages)
      .where(eq(subStockMessages.subcontractorId, subcontractorId))
      .orderBy(desc(subStockMessages.createdAt), desc(subStockMessages.id))
      .limit(100),
    executor
      .select()
      .from(subStockNotifications)
      .where(eq(subStockNotifications.subcontractorId, subcontractorId))
      .orderBy(asc(subStockNotifications.id)),
    executor
      .select({
        partNumber: parts.partNumber,
        name: parts.name,
        currentQuantity: parts.currentQuantity,
        subignore: parts.subignore,
      })
      .from(parts)
      .where(partsWhere)
      .orderBy(asc(parts.partNumber))
      .limit(100),
    executor
      .select({ total: sql<number>`count(*)::int` })
      .from(subStockMessages)
      .where(
        and(
          eq(subStockMessages.subcontractorId, subcontractorId),
          eq(subStockMessages.isRead, false),
        ),
      ),
  ])

  return {
    subcontractorId,
    unread: unread[0]?.total ?? 0,
    messages: messages.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    })),
    subscriptions,
    parts: visibleParts,
  }
}

export async function markSubStockMessageReadCore(
  tx: Tx,
  input: { id: number },
  session: AuthSessionView,
) {
  assertPermission(session, 'inventory:sub_stock')
  const subcontractorId = subcontractorIdForSession(session)
  const [row] = await tx
    .update(subStockMessages)
    .set({ isRead: true, readBy: session.user.id })
    .where(
      and(eq(subStockMessages.id, input.id), eq(subStockMessages.subcontractorId, subcontractorId)),
    )
    .returning()
  if (!row) throw new ValidationError('That stock message is not yours.')
  return { id: row.id, isRead: row.isRead }
}

export async function setSubStockSubscriptionCore(
  tx: Tx,
  input: { containStock: boolean; notificationCode?: string },
  session: AuthSessionView,
) {
  assertPermission(session, 'inventory:sub_stock')
  const subcontractorId = subcontractorIdForSession(session)
  const code = input.notificationCode ?? `sub-stock:${subcontractorId}`
  const [row] = await tx
    .insert(subStockNotifications)
    .values({
      subcontractorId,
      userId: session.user.id,
      containStock: input.containStock,
      notificationCode: code,
    })
    .onConflictDoUpdate({
      target: [subStockNotifications.notificationCode, subStockNotifications.subcontractorId],
      set: { containStock: input.containStock, userId: session.user.id },
    })
    .returning()
  if (!row) throw new ValidationError('The stock subscription could not be saved.')
  return { id: row.id, containStock: row.containStock }
}

/** Office-side message creation; delivered to one subcontractor's portal. */
export async function sendSubStockMessageCore(
  tx: Tx,
  input: { subcontractorId: number; subject: string; message: string },
  session: AuthSessionView,
) {
  assertPermission(session, 'inventory:adjust')
  const [row] = await tx
    .insert(subStockMessages)
    .values({
      subcontractorId: input.subcontractorId,
      userId: session.user.id,
      userType: session.user.role === 'admin' ? 'admin' : 'sub',
      username: session.user.username,
      subject: input.subject,
      message: input.message,
    })
    .returning()
  if (!row) throw new ValidationError('The stock message could not be sent.')
  return { id: row.id }
}
