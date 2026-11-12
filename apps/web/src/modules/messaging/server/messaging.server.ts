/**
 * Internal messages and the notification centre. SERVER ONLY.
 *
 * Threads are staff-to-staff and never email. The notification centre reads the
 * ADR 0013 outbox; `platform.notifications-drain` is the only sender.
 */
import { and, asc, desc, eq, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { getDb, type Db, type Tx } from '@cls/db'
import {
  auditLog,
  messageThreadParticipants,
  messageThreads,
  messages,
  notifications,
  users,
} from '@cls/db/schema'
import {
  nextAttemptDelay,
  transportFromConfig,
  type NotificationTransport,
} from '@cls/notifications'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@cls/core'
import type { AuthSessionView } from '../../../server/auth.types'

type Executor = Db

export interface ThreadSummary {
  id: string
  subject: string
  lastMessageAt: string
  unread: number
  preview: string
  participants: string[]
}

export interface ThreadMessage {
  id: string
  authorId: string
  author: string
  body: string
  createdAt: string
  mine: boolean
}

export interface ThreadDetail {
  id: string
  subject: string
  participants: { id: string; name: string; email: string }[]
  messages: ThreadMessage[]
}

export interface NotificationView {
  id: string
  kind: string
  subject: string
  bodyText: string
  status: string
  entityType: string | null
  entityId: string | null
  attempts: number
  lastError: string | null
  createdAt: string
  sentAt: string | null
  readAt: string | null
}

export interface OutboxOverview {
  counts: Record<string, number>
  rows: (NotificationView & {
    recipient: string | null
    recipientName: string | null
    nextAttemptAt: string
    templateKey: string
  })[]
}

function hasPermission(session: AuthSessionView, key: string): boolean {
  return session.user.grants.some((grant) => grant.key === key)
}

function assertWrite(session: AuthSessionView): void {
  if (!hasPermission(session, 'messages:write')) {
    throw new ForbiddenError('You do not have permission to send messages.')
  }
}

function assertAdmin(session: AuthSessionView): void {
  if (!hasPermission(session, 'messages:admin')) {
    throw new ForbiddenError('Only an administrator can administer the notification outbox.')
  }
}

async function participantThread(
  db: Executor | Tx,
  threadId: string,
  session: AuthSessionView,
): Promise<void> {
  const [row] = await db
    .select({ threadId: messageThreadParticipants.threadId })
    .from(messageThreadParticipants)
    .where(
      and(
        eq(messageThreadParticipants.threadId, threadId),
        eq(messageThreadParticipants.userId, session.user.id),
      ),
    )
    .limit(1)
  if (!row) throw new NotFoundError('Message thread not found.')
}

export async function listThreads(
  session: AuthSessionView,
  executor?: Executor,
): Promise<ThreadSummary[]> {
  const db = executor ?? getDb()
  const rows = await db
    .select({
      id: messageThreads.id,
      subject: messageThreads.subject,
      lastMessageAt: messageThreads.lastMessageAt,
      unread: sql<number>`(
        select count(*)::int from ${messages} m
        where m.thread_id = ${messageThreads.id}
          and m.author_user_id <> ${session.user.id}
          and (${messageThreadParticipants.lastReadAt} is null
            or m.created_at > ${messageThreadParticipants.lastReadAt})
      )`,
      preview: sql<string>`coalesce((
        select m.body from ${messages} m
        where m.thread_id = ${messageThreads.id}
        order by m.created_at desc limit 1
      ), '')`,
    })
    .from(messageThreads)
    .innerJoin(
      messageThreadParticipants,
      and(
        eq(messageThreadParticipants.threadId, messageThreads.id),
        eq(messageThreadParticipants.userId, session.user.id),
      ),
    )
    .orderBy(desc(messageThreads.lastMessageAt))
    .limit(200)
  if (rows.length === 0) return []
  const participantRows = await db
    .select({
      threadId: messageThreadParticipants.threadId,
      name: users.displayName,
    })
    .from(messageThreadParticipants)
    .innerJoin(users, eq(users.id, messageThreadParticipants.userId))
    .where(inArray(messageThreadParticipants.threadId, rows.map((row) => row.id)))
  const names = new Map<string, string[]>()
  for (const row of participantRows) {
    names.set(row.threadId, [...(names.get(row.threadId) ?? []), row.name])
  }
  return rows.map((row) => ({
    id: row.id,
    subject: row.subject,
    lastMessageAt: row.lastMessageAt.toISOString(),
    unread: row.unread,
    preview: row.preview,
    participants: names.get(row.id) ?? [],
  }))
}

export async function getThread(
  threadId: string,
  session: AuthSessionView,
  executor?: Executor,
): Promise<ThreadDetail> {
  const db = executor ?? getDb()
  await participantThread(db, threadId, session)
  const [thread] = await db
    .select({ id: messageThreads.id, subject: messageThreads.subject })
    .from(messageThreads)
    .where(eq(messageThreads.id, threadId))
    .limit(1)
  if (!thread) throw new NotFoundError('Message thread not found.')
  const [participants, rows] = await Promise.all([
    db
      .select({ id: users.id, name: users.displayName, email: users.email })
      .from(messageThreadParticipants)
      .innerJoin(users, eq(users.id, messageThreadParticipants.userId))
      .where(eq(messageThreadParticipants.threadId, threadId))
      .orderBy(asc(users.displayName)),
    db
      .select({
        id: messages.id,
        authorId: messages.authorUserId,
        author: users.displayName,
        body: messages.body,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .innerJoin(users, eq(users.id, messages.authorUserId))
      .where(eq(messages.threadId, threadId))
      .orderBy(asc(messages.createdAt)),
  ])
  return {
    id: thread.id,
    subject: thread.subject,
    participants,
    messages: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      mine: row.authorId === session.user.id,
    })),
  }
}

export async function createThreadCore(
  tx: Tx,
  input: { subject: string; body: string; participantIds: string[]; firstMessageOnly?: boolean },
  session: AuthSessionView,
): Promise<{ id: string }> {
  assertWrite(session)
  const subject = input.subject.trim()
  const body = input.body.trim()
  if (!subject) throw new ValidationError('A thread needs a subject.')
  if (!body) throw new ValidationError('A thread needs an opening message.')
  const ids = [...new Set([session.user.id, ...input.participantIds])]
  const people = await tx
    .select({ id: users.id, isEnabled: users.isEnabled })
    .from(users)
    .where(inArray(users.id, ids))
  if (people.length !== ids.length) throw new ValidationError('One or more participants do not exist.')
  if (people.some((person) => !person.isEnabled)) {
    throw new ValidationError('A disabled user cannot be added to a thread.')
  }
  const now = new Date()
  const [thread] = await tx
    .insert(messageThreads)
    .values({ subject, createdBy: session.user.id, lastMessageAt: now })
    .returning({ id: messageThreads.id })
  await tx.insert(messageThreadParticipants).values(
    ids.map((id) => ({
      threadId: thread!.id,
      userId: id,
      lastReadAt: id === session.user.id ? now : null,
    })),
  )
  await tx.insert(messages).values({
    threadId: thread!.id,
    authorUserId: session.user.id,
    body,
  })
  await tx.insert(auditLog).values({
    actorUserId: session.user.id,
    actorLabel: session.user.email,
    action: 'message.thread.create',
    entityType: 'message_thread',
    entityId: thread!.id,
    summary: `Started thread “${subject}” with ${ids.length - 1} participant(s).`,
  })
  return { id: thread!.id }
}

export async function replyThreadCore(
  tx: Tx,
  input: { threadId: string; body: string },
  session: AuthSessionView,
): Promise<{ id: string }> {
  assertWrite(session)
  await participantThread(tx, input.threadId, session)
  const body = input.body.trim()
  if (!body) throw new ValidationError('A reply cannot be empty.')
  const now = new Date()
  const [message] = await tx
    .insert(messages)
    .values({ threadId: input.threadId, authorUserId: session.user.id, body })
    .returning({ id: messages.id })
  await tx
    .update(messageThreads)
    .set({ lastMessageAt: now, updatedAt: now })
    .where(eq(messageThreads.id, input.threadId))
  await tx
    .update(messageThreadParticipants)
    .set({ lastReadAt: now })
    .where(
      and(
        eq(messageThreadParticipants.threadId, input.threadId),
        eq(messageThreadParticipants.userId, session.user.id),
      ),
    )
  return { id: message!.id }
}

export async function markThreadReadCore(
  tx: Tx,
  threadId: string,
  session: AuthSessionView,
): Promise<void> {
  await participantThread(tx, threadId, session)
  await tx
    .update(messageThreadParticipants)
    .set({ lastReadAt: new Date() })
    .where(
      and(
        eq(messageThreadParticipants.threadId, threadId),
        eq(messageThreadParticipants.userId, session.user.id),
      ),
    )
}

export async function listMessageUsers(
  session: AuthSessionView,
  executor?: Executor,
): Promise<{ id: string; name: string; email: string }[]> {
  const db = executor ?? getDb()
  const rows = await db
    .select({ id: users.id, name: users.displayName, email: users.email })
    .from(users)
    .where(and(eq(users.isEnabled, true), sql`${users.id} <> ${session.user.id}`))
    .orderBy(asc(users.displayName))
    .limit(500)
  return rows
}

function recipientCondition(session: AuthSessionView) {
  return or(
    eq(notifications.recipientUserId, session.user.id),
    sql`lower(${notifications.recipientEmail}) = lower(${session.user.email})`,
  )!
}

export async function listNotifications(
  session: AuthSessionView,
  input: { status?: string; kind?: string; search?: string; page?: number; pageSize?: number } = {},
  executor?: Executor,
): Promise<{ rows: NotificationView[]; unread: number; total: number }> {
  const db = executor ?? getDb()
  const page = Math.max(1, input.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, input.pageSize ?? 50))
  const conditions = [recipientCondition(session)]
  if (input.status) conditions.push(eq(notifications.status, input.status as never))
  if (input.kind) conditions.push(eq(notifications.kind, input.kind))
  if (input.search) conditions.push(ilike(notifications.subject, `%${input.search}%`))
  const where = and(...conditions)
  const [rows, total, unread] = await Promise.all([
    db
      .select({
        id: notifications.id,
        kind: notifications.kind,
        subject: notifications.subject,
        bodyText: notifications.bodyText,
        status: notifications.status,
        entityType: notifications.entityType,
        entityId: notifications.entityId,
        attempts: notifications.attempts,
        lastError: notifications.lastError,
        createdAt: notifications.createdAt,
        sentAt: notifications.sentAt,
        readAt: notifications.readAt,
      })
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(notifications).where(where),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(recipientCondition(session), isNull(notifications.readAt), sql`${notifications.status} <> 'skipped'`)),
  ])
  return {
    rows: rows.map((row) => ({
      ...row,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      sentAt: row.sentAt?.toISOString() ?? null,
      readAt: row.readAt?.toISOString() ?? null,
    })),
    unread: unread[0]?.count ?? 0,
    total: total[0]?.count ?? 0,
  }
}

export async function markNotificationReadCore(
  tx: Tx,
  id: string,
  session: AuthSessionView,
): Promise<void> {
  const [row] = await tx
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.id, id), recipientCondition(session)))
    .limit(1)
  if (!row) throw new NotFoundError('Notification not found.')
  await tx.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, id))
}

export async function listOutbox(
  session: AuthSessionView,
  input: { status?: string; kind?: string; search?: string } = {},
  executor?: Executor,
): Promise<OutboxOverview> {
  assertAdmin(session)
  const db = executor ?? getDb()
  const conditions = []
  if (input.status) conditions.push(eq(notifications.status, input.status as never))
  if (input.kind) conditions.push(eq(notifications.kind, input.kind))
  if (input.search) {
    conditions.push(
      or(
        ilike(notifications.subject, `%${input.search}%`),
        ilike(notifications.recipientEmail, `%${input.search}%`),
      )!,
    )
  }
  const where = conditions.length ? and(...conditions) : undefined
  const [rows, counts] = await Promise.all([
    db
      .select({
        id: notifications.id,
        kind: notifications.kind,
        templateKey: notifications.templateKey,
        subject: notifications.subject,
        bodyText: notifications.bodyText,
        status: notifications.status,
        entityType: notifications.entityType,
        entityId: notifications.entityId,
        recipient: notifications.recipientEmail,
        recipientName: notifications.recipientName,
        attempts: notifications.attempts,
        nextAttemptAt: notifications.nextAttemptAt,
        lastError: notifications.lastError,
        createdAt: notifications.createdAt,
        sentAt: notifications.sentAt,
        readAt: notifications.readAt,
      })
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(200),
    db
      .select({ status: notifications.status, count: sql<number>`count(*)::int` })
      .from(notifications)
      .groupBy(notifications.status),
  ])
  return {
    counts: Object.fromEntries(counts.map((row) => [row.status, row.count])),
    rows: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      templateKey: row.templateKey,
      recipient: row.recipient,
      recipientName: row.recipientName,
      subject: row.subject,
      bodyText: row.bodyText,
      status: row.status,
      entityType: row.entityType,
      entityId: row.entityId,
      attempts: row.attempts,
      nextAttemptAt: row.nextAttemptAt.toISOString(),
      lastError: row.lastError,
      createdAt: row.createdAt.toISOString(),
      sentAt: row.sentAt?.toISOString() ?? null,
      readAt: row.readAt?.toISOString() ?? null,
    })),
  }
}

export async function retryNotificationCore(
  tx: Tx,
  id: string,
  session: AuthSessionView,
): Promise<void> {
  assertAdmin(session)
  const [row] = await tx.select().from(notifications).where(eq(notifications.id, id)).limit(1)
  if (!row) throw new NotFoundError('Notification not found.')
  if (row.status === 'sending') throw new ConflictError('This message is being sent right now.')
  await tx
    .update(notifications)
    .set({
      status: 'queued',
      nextAttemptAt: new Date(),
      lastError: null,
      lastErrorCode: null,
      updatedAt: new Date(),
    })
    .where(eq(notifications.id, id))
  await tx.insert(auditLog).values({
    actorUserId: session.user.id,
    actorLabel: session.user.email,
    action: 'notification.retry',
    entityType: 'notification',
    entityId: id,
    summary: `Retried notification “${row.subject}”.`,
    before: { status: row.status, attempts: row.attempts },
  })
}

export function transport(): NotificationTransport {
  const fallback = process.env.NODE_ENV === 'test' ? 'memory' : 'smtp'
  const kind = (process.env.MAIL_TRANSPORT ?? fallback) as 'memory' | 'file' | 'smtp'
  return transportFromConfig({
    kind,
    from: process.env.MAIL_FROM ?? 'no-reply@alliancelighting.local',
    replyTo: process.env.MAIL_REPLY_TO ?? null,
    overrideTo: process.env.MAIL_OVERRIDE_TO ?? null,
    directory: process.env.MAIL_FILE_DIR ?? 'var/mail',
  })
}

export async function drainOutboxCore(
  tx: Tx,
  input: { transport: NotificationTransport; now?: Date; limit?: number },
): Promise<{ claimed: number; sent: number; failed: number; skipped: number }> {
  const now = input.now ?? new Date()
  const limit = Math.min(25, Math.max(1, input.limit ?? 25))
  const claimed = await tx
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.status, 'queued'),
        lt(notifications.nextAttemptAt, new Date(now.getTime() + 1)),
      ),
    )
    .orderBy(asc(notifications.nextAttemptAt))
    .limit(limit)
    .for('update', { skipLocked: true })
  let sent = 0
  let failed = 0
  let skipped = 0
  for (const row of claimed) {
    const [message] = await tx
      .update(notifications)
      .set({ status: 'sending', updatedAt: now })
      .where(eq(notifications.id, row.id))
      .returning()
    if (!message) continue
    if (!message.recipientEmail) {
      await tx
        .update(notifications)
        .set({ status: 'skipped', lastErrorCode: 'no_recipient', lastError: 'No recipient email.', updatedAt: now })
        .where(eq(notifications.id, row.id))
      skipped += 1
      continue
    }
    try {
      const result = await input.transport.send({
        to: message.recipientEmail,
        subject: message.subject,
        text: message.bodyText,
        html: message.bodyHtml,
        from: process.env.MAIL_FROM ?? 'no-reply@alliancelighting.local',
        replyTo: process.env.MAIL_REPLY_TO ?? null,
      })
      await tx
        .update(notifications)
        .set({
          status: 'sent',
          attempts: message.attempts + 1,
          providerMessageId: result.providerMessageId,
          sentAt: now,
          updatedAt: now,
        })
        .where(eq(notifications.id, row.id))
      sent += 1
    } catch (error) {
      const attempts = message.attempts + 1
      const delay = nextAttemptDelay(attempts)
      const code = error instanceof Error ? error.name : 'transport_error'
      const detail = error instanceof Error ? error.message : String(error)
      await tx
        .update(notifications)
        .set({
          status: delay === null ? 'failed' : 'queued',
          attempts,
          nextAttemptAt: delay === null ? now : new Date(now.getTime() + delay),
          lastErrorCode: code,
          lastError: detail,
          updatedAt: now,
        })
        .where(eq(notifications.id, row.id))
      failed += 1
    }
  }
  return { claimed: claimed.length, sent, failed, skipped }
}
