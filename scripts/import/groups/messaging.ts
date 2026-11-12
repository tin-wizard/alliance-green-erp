/**
 * Group 12 — messaging and history (plan §2.5 step 12).
 *
 * History is read-only in the new app, but it still has to be found where people
 * expect it:
 *
 *  - `messages` is the old portal inbox (sender / receiver / subject / body). The
 *    forward model is a thread with participants and messages, so this group
 *    rebuilds a thread per conversation (sender + receiver + subject) and adds
 *    both parties as participants. A message whose sender is not an app user is
 *    reported and skipped: `author_user_id` is NOT NULL and inventing an identity
 *    would put someone else's words in a real person's thread.
 *  - latin1 text is preserved exactly as stored. `Ã`/`Â` sequences are a classic
 *    sign of a broken encoding round trip, so they are reported
 *    (`mojibake_suspected`, owner operations) and left alone — repairing them here
 *    would destroy the only remaining evidence of what was stored.
 *  - `messages_links` / `messages_links_po` are confirmation messages tied to a
 *    work order or a PO. They become `app.notifications` rows with the legacy
 *    reference in `legacy_ref`, because that table is the outbox history and
 *    already carries a dedupe key.
 *  - `rga_notification` maps to the durable RGA notification outbox.
 *  - `cron_run_history` maps to `app.job_runs` under a `legacy.cron.` key, so the
 *    live ledger keeps working while the old scheduler's history stays readable.
 *  - `site_activity_logs` maps to `app.audit_log`; the PHP file and section have
 *    no column, so they are kept in the `after` payload rather than dropped.
 *  - `email_messages_to_sub` is the log of real emails to a subcontractor and
 *    lands in the same outbox; `sub_stock_messages` / `sub_stock_notification`
 *    have exact targets in the subcontractor stock portal.
 *  - `po_notification` is a per-user "notify me" subscription for a PO or quote,
 *    and `message_setup` is the old routing flag. The new system keeps no such
 *    tables (reminders and routing are job settings), so both are reported once
 *    for the table instead of hung on a table they do not fit.
 */
import { eq, sql } from 'drizzle-orm'
import type { Tx } from '@cls/db'
import {
  auditLog,
  jobRuns,
  messageThreadParticipants,
  messageThreads,
  messages,
  notifications,
  rgaNotifications,
  rgas,
  subStockMessages,
  subStockNotifications,
  users,
} from '@cls/db/schema'
import { stagingTable } from '../manifest'
import type { GroupTransformer, TransformContext, TransformHelpers } from '../types'

/** The manifest calls this group `messaging-history`; the module is `messaging`. */
const GROUP = 'messaging-history'

const ENTITIES: Record<string, string> = {
  messages: 'message',
  messages_links: 'message_link',
  messages_links_po: 'message_link_po',
  po_notification: 'po_notification',
  rga_notification: 'rga_notification',
  cron_run_history: 'cron_run_history',
  site_activity_logs: 'site_activity_log',
  message_setup: 'message_setup',
  email_messages_to_sub: 'email_message_to_sub',
  sub_stock_messages: 'sub_stock_message',
  sub_stock_notification: 'sub_stock_notification',
}

function entityFor(table: string): string {
  return ENTITIES[table] ?? table
}

function intOf(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Legacy wall-clock text to an instant in the company timezone.
 *
 * The old server wrote local Toronto time. `new Date(text)` would read it in
 * whatever zone the migration machine happens to be in and shift every value, so
 * the offset is taken from the zone itself and the wall clock is preserved.
 */
function instantOf(value: string | null): Date | undefined {
  if (value === null) return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value.trim())
  if (!match) return undefined
  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match
  const utc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  )
  return new Date(utc - zoneOffsetMs(new Date(utc)))
}

/** How far Toronto is from UTC at that instant, in milliseconds. */
function zoneOffsetMs(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)
  const local = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour') % 24,
    read('minute'),
    read('second'),
  )
  return local - date.getTime()
}

function businessDate(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

/** A mojibake signature, kept as a fact and never repaired. */
const MOJIBAKE = /[ÃÂ]/

/* ------------------------------- users ------------------------------- */

async function resolveUser(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<string | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('user', 'users', String(legacyId))
  if (mapped !== null) {
    const [byId] = await tx.select({ id: users.id }).from(users).where(eq(users.id, mapped)).limit(1)
    if (byId) return byId.id
  }
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.legacyId, legacyId))
    .limit(1)
  return row?.id ?? null
}

/** The legacy inbox identifies people by username, not by id. */
async function resolveUserByName(tx: Tx, name: string | null): Promise<string | null> {
  if (name === null) return null
  const [byUsername] = await tx
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.username}) = lower(${name})`)
    .limit(1)
  if (byUsername) return byUsername.id
  const [byEmail] = await tx
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${name})`)
    .limit(1)
  return byEmail?.id ?? null
}

/* ------------------------------- inbox ------------------------------- */

/**
 * A thread is a conversation, not a message: the legacy inbox has no thread id,
 * so the identity is the sender/receiver/subject triple. Replies to the same
 * subject from the same pair land in one thread, which is what the portal showed.
 */
function conversationKey(sender: string | null, receiver: string | null, subject: string | null): string {
  return [sender ?? '', receiver ?? '', subject ?? ''].map((part) => part.trim().toLowerCase()).join('|')
}

async function transformMessage(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const sender = helpers.text('sender')
  const authorUserId = await resolveUserByName(tx, sender)
  if (authorUserId === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity,
      sourceKey,
      action: 'message not inserted: author_user_id is NOT NULL and the sender is not an app user',
      notes: `sender = ${JSON.stringify(row.sender)}`,
    })
    return
  }

  const receiver = helpers.text('receiver')
  const recipientUserId = await resolveUserByName(tx, receiver)
  const subject = helpers.text('subject')
  const key = conversationKey(sender, receiver, subject)
  const createdAt = helpers.timestamp('datetime')

  // The body is copied byte-for-byte: no trim, no repair, no transcoding.
  const body = row.message ?? ''
  const suspicious = MOJIBAKE.test(body) || (subject !== null && MOJIBAKE.test(subject))
  if (suspicious) {
    await helpers.exception({
      exceptionClass: 'mojibake_suspected',
      entity,
      sourceKey,
      action: 'body and subject preserved exactly as stored; no repair attempted',
      notes: `${MOJIBAKE.test(body) ? 'body' : 'subject'} contains a latin1-as-utf8 sequence (Ã/Â)`,
    })
  }

  let threadId = await helpers.targetKey('message_thread', 'messages', key)
  if (threadId === null) {
    const [thread] = await tx
      .insert(messageThreads)
      .values({
        subject: subject ?? '(no subject)',
        createdBy: authorUserId,
        ...(createdAt === null ? {} : { lastMessageAt: instantOf(createdAt) }),
      })
      .returning({ id: messageThreads.id })
    threadId = thread!.id
    await helpers.remember({
      entity: 'message_thread',
      sourceTable: 'messages',
      sourceKey: key,
      targetTable: 'message_threads',
      targetKey: threadId,
    })
  }

  await tx
    .insert(messageThreadParticipants)
    .values({ threadId, userId: authorUserId })
    .onConflictDoNothing()
  if (recipientUserId !== null && recipientUserId !== authorUserId) {
    await tx
      .insert(messageThreadParticipants)
      .values({ threadId, userId: recipientUserId })
      .onConflictDoNothing()
  }

  const [inserted] = await tx
    .insert(messages)
    .values({
      threadId,
      authorUserId,
      body,
      ...(createdAt === null ? {} : { createdAt: instantOf(createdAt) }),
    })
    .returning({ id: messages.id })

  // The thread's ordering key is the newest message it holds, computed from the
  // rows themselves so a replayed message cannot move it backwards.
  await tx.execute(sql`
    update app.message_threads set
      last_message_at = coalesce(
        (select max(created_at) from app.messages where thread_id = ${threadId}),
        last_message_at
      ),
      updated_at = now()
    where id = ${threadId}
  `)

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'messages',
    targetKey: String(inserted!.id),
  })
}

/* ------------------------- confirmation links ------------------------ */

async function transformMessageLink(
  context: TransformContext,
  entityType: 'work_order' | 'purchase_order',
): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const documentId =
    entityType === 'work_order' ? helpers.int('woid') : helpers.int('poid')
  const title = helpers.text('message_title')
  const body = row.message_text ?? ''
  const confirmationKey = helpers.text('confirmation_key')
  const sentAt = helpers.timestamp('date')

  const [inserted] = await tx
    .insert(notifications)
    .values({
      kind: 'legacy.message_link',
      templateKey: 'legacy.message_link',
      entityType,
      // Text, no FK: the raw legacy id is the honest value even when the document
      // is gone, and nothing here is allowed to invent a parent.
      entityId: documentId === null ? null : String(documentId),
      subject: title ?? '(no subject)',
      bodyText: body,
      status: 'sent',
      // The legacy confirmation key is preserved in the payload; the dedupe key is
      // namespaced so two tables cannot collide on the same legacy key.
      dedupeKey: `legacy:${context.table}:${confirmationKey ?? sourceKey}`,
      payload: {
        legacyId: intOf(row.id),
        confirmationKey,
        isResponded: helpers.flag('is_responded'),
      },
      legacyRef: `${context.table}:${sourceKey}`,
      ...(sentAt === null ? {} : { sentAt: instantOf(sentAt) }),
    })
    .returning({ id: notifications.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'notifications',
    targetKey: String(inserted!.id),
  })
}

/* --------------------------- RGA reminders --------------------------- */

async function transformRgaNotification(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const legacyRgaId = helpers.int('rgaid')
  const rgaCandidate = intOf(await helpers.targetKey('rga', 'rga', String(legacyRgaId ?? '')))
  const [rga] =
    rgaCandidate === null
      ? []
      : await tx.select({ id: rgas.id }).from(rgas).where(eq(rgas.id, rgaCandidate)).limit(1)
  if (!rga) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity,
      sourceKey,
      action: 'notification not inserted: rga_id is NOT NULL and the RGA does not exist',
      notes: `rgaid = ${JSON.stringify(row.rgaid)}`,
    })
    return
  }

  const notified = helpers.flag('is_notified') === 1
  const dueOn = helpers.date('notify_date')

  const [inserted] = await tx
    .insert(rgaNotifications)
    .values({
      rgaId: rga.id,
      notifyType: helpers.text('notify_type') ?? 'legacy',
      status: notified ? 'sent' : 'pending',
      recipientUserId: await resolveUser(tx, helpers, helpers.int('user_id')),
      idempotencyKey: `legacy:rga_notification:${sourceKey}`,
      ...(dueOn === null ? {} : { dueAt: sql`${dueOn}::timestamptz`, sentAt: notified ? sql`${dueOn}::timestamptz` : undefined }),
    })
    .returning({ id: rgaNotifications.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'rga_notifications',
    targetKey: String(inserted!.id),
  })
}

/* --------------------------- scheduler history ----------------------- */

/**
 * `execute_timeint` is a unix stamp in either seconds or milliseconds; the
 * magnitude is the only evidence available, so it is stated rather than assumed
 * silently. A value that is neither is reported and skipped.
 */
function epochInstant(raw: string | null | undefined): Date | null {
  const value = intOf(raw)
  if (value === null || value <= 0) return null
  const millis = value > 1e11 ? value : value * 1000
  const instant = new Date(millis)
  if (Number.isNaN(instant.getTime())) return null
  // Anything before the portal existed is not a run time.
  if (instant.getUTCFullYear() < 2000 || instant.getUTCFullYear() > 2100) return null
  return instant
}

async function transformCronRun(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const instant = epochInstant(row.execute_timeint)
  if (instant === null) {
    await helpers.exception({
      exceptionClass: 'zero_date',
      entity,
      sourceKey,
      action: 'run not inserted: scheduled_for is NOT NULL and the epoch value is not a usable time',
      notes: `execute_timeint = ${JSON.stringify(row.execute_timeint)}`,
    })
    return
  }

  const jobKey = `legacy.cron.${helpers.text('cronname') ?? 'unknown'}`
  const [inserted] = await tx
    .insert(jobRuns)
    .values({
      // A namespaced key keeps the old scheduler's history separate from the live
      // job registry, so a legacy row can never collide with a real slot.
      jobKey,
      scheduledFor: instant,
      businessDate: businessDate(instant),
      status: 'succeeded',
      finishedAt: instant,
      detail: { legacyRuntime: helpers.text('runtime'), legacyId: intOf(row.id), imported: true },
    })
    .onConflictDoNothing({ target: [jobRuns.jobKey, jobRuns.scheduledFor] })
    .returning({ id: jobRuns.id })

  // A duplicate slot is not an error: the legacy history can hold the same
  // cron/second twice, and the ledger's unique key is what settles it.
  const jobRunId =
    inserted?.id ??
    (
      await tx
        .select({ id: jobRuns.id })
        .from(jobRuns)
        .where(sql`${jobRuns.jobKey} = ${jobKey} and ${jobRuns.scheduledFor} = ${instant.toISOString()}`)
        .limit(1)
    )[0]?.id
  if (jobRunId === undefined) return

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'job_runs',
    targetKey: String(jobRunId),
  })
}

/* ---------------------------- activity log --------------------------- */

async function transformActivityLog(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const logType = helpers.text('log_type')
  const tableName = helpers.text('table_name')
  const loggedAt = helpers.timestamp('log_date')
  const rowId = helpers.int('row_id')
  const phpFilename = helpers.text('php_filename')
  const section = helpers.text('section')

  const [inserted] = await tx
    .insert(auditLog)
    .values({
      // `action` is a stable event name; the namespace keeps legacy events from
      // being mistaken for events the new app emits.
      action: `legacy.${logType ?? tableName ?? 'activity'}`,
      entityType: tableName,
      entityId: rowId === null ? null : String(rowId),
      actorUserId: await resolveUser(tx, helpers, helpers.int('user_id')),
      summary: helpers.text('notes_comments'),
      // No column for the PHP entry point or the page section, and dropping them
      // would lose the only clue about what wrote the row.
      after: { phpFilename, section },
      ...(loggedAt === null ? {} : { createdAt: instantOf(loggedAt) }),
    })
    .returning({ id: auditLog.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'audit_log',
    targetKey: String(inserted!.id),
  })
}

/* ----------------------- subcontractor portal mail -------------------- */

/**
 * `email_messages_to_sub` is the log of real emails to a subcontractor. The
 * outbox is the right home: it keeps the subject, the body as sent, the
 * recipients, and a legacy reference. `datetime` is a unix stamp.
 */
async function transformEmailToSub(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const sentAt = epochInstant(row.datetime)
  if (row.datetime !== null && sentAt === null) {
    await helpers.exception({
      exceptionClass: 'zero_date',
      entity,
      sourceKey,
      action: 'sent_at stored NULL: the epoch value is not a usable time',
      notes: `datetime = ${JSON.stringify(row.datetime)}`,
    })
  }

  const subId = helpers.int('subid')
  const confirmationKey = helpers.text('confirmation_key')
  const [inserted] = await tx
    .insert(notifications)
    .values({
      kind: 'legacy.email_to_sub',
      templateKey: 'legacy.email_to_sub',
      entityType: 'subcontractor',
      entityId: subId === null ? null : String(subId),
      recipientEmail: helpers.text('receiver_emails'),
      subject: helpers.text('subject') ?? '(no subject)',
      bodyText: row.message ?? '',
      status: 'sent',
      dedupeKey: `legacy:email_messages_to_sub:${confirmationKey ?? sourceKey}`,
      payload: {
        legacyId: intOf(row.id),
        senderId: helpers.int('sender_id'),
        sender: helpers.text('sender'),
        subId,
        parentId: helpers.int('parent_id'),
        attachments: helpers.text('file_attachments'),
        confirmationKey,
      },
      legacyRef: `${context.table}:${sourceKey}`,
      createdBy: await resolveUser(tx, helpers, helpers.int('sender_id')),
      ...(sentAt === null ? {} : { sentAt }),
    })
    .returning({ id: notifications.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'notifications',
    targetKey: String(inserted!.id),
  })
}

async function transformSubStockMessage(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const subcontractorId = helpers.int('subid')
  if (subcontractorId === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity,
      sourceKey,
      action: 'message not inserted: subcontractor_id is NOT NULL and subid is blank',
      notes: `subid = ${JSON.stringify(row.subid)}`,
    })
    return
  }

  const createdAt = instantOf(helpers.timestamp('date_created'))
  const [inserted] = await tx
    .insert(subStockMessages)
    .values({
      notificationId: helpers.int('notification_id'),
      subcontractorId,
      userId: await resolveUser(tx, helpers, helpers.int('userid')),
      userType: helpers.text('usertype') ?? 'sub',
      username: helpers.text('username'),
      subject: helpers.text('message_subject'),
      // An empty body stays an empty string: the column is NOT NULL, as in `messages`.
      message: row.message_text ?? '',
      isRead: helpers.flag('is_read') === 1,
      readBy: await resolveUser(tx, helpers, helpers.int('is_read_by')),
      confirmationKey: helpers.text('confirmation_key'),
      ...(createdAt === undefined ? {} : { createdAt }),
    })
    .returning({ id: subStockMessages.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'sub_stock_messages',
    targetKey: String(inserted!.id),
  })
}

async function transformSubStockNotification(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, row } = context
  const entity = entityFor(context.table)
  if ((await helpers.targetKey(entity, context.table, sourceKey)) !== null) return

  const subcontractorId = helpers.int('subid')
  if (subcontractorId === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity,
      sourceKey,
      action: 'subscription not inserted: subcontractor_id is NOT NULL and subid is blank',
      notes: `subid = ${JSON.stringify(row.subid)}`,
    })
    return
  }

  let notificationCode = helpers.text('notification_code')
  if (notificationCode === null) {
    // NOT NULL and unique: an unset code still has to identify the row, so it gets
    // a deterministic legacy code and the gap is listed.
    notificationCode = `LGC-${sourceKey}`
    await helpers.exception({
      exceptionClass: 'missing_po_number',
      entity,
      sourceKey,
      action: `migrated with the generated code ${notificationCode} so the unique series stays intact`,
      notes: `notification_code = ${JSON.stringify(row.notification_code)}`,
    })
  }

  const containStock = helpers.flag('contain_stock')
  const createdAt = instantOf(helpers.timestamp('date_created'))
  const [inserted] = await tx
    .insert(subStockNotifications)
    .values({
      subcontractorId,
      userId: await resolveUser(tx, helpers, helpers.int('userid')),
      ...(containStock === null ? {} : { containStock: containStock === 1 }),
      notificationCode,
      isResponded: helpers.flag('is_responded') === 1,
      ...(createdAt === undefined ? {} : { createdAt }),
    })
    .returning({ id: subStockNotifications.id })

  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'sub_stock_notifications',
    targetKey: String(inserted!.id),
  })
}

/* ---------------------------- not migrated --------------------------- */

/**
 * Rows staged for this table and dump.
 *
 * The staging relation is generated from the manifest, so a table added to the
 * manifest before the DDL is regenerated would make the count fail; a policy skip
 * still has to be recorded. The floor of 1 is the row being processed.
 */
async function stagedRowCount(context: TransformContext): Promise<number> {
  try {
    const rows = (await context.tx.execute(
      sql`select count(*)::int as rows from ${sql.raw(`migration."${stagingTable(context.table)}"`)} where "_dump_id" = ${context.dumpId}`,
    )) as unknown as Array<{ rows: number }>
    const count = Number(rows[0]?.rows ?? 0)
    return count > 0 ? count : 1
  } catch {
    return 1
  }
}

async function recordNotMigrated(context: TransformContext, reason: string): Promise<void> {
  const count = await stagedRowCount(context)
  await context.helpers.exception({
    exceptionClass: 'not_migrated',
    entity: entityFor(context.table),
    sourceKey: `${context.table}:all`,
    rowCount: count > 0 ? count : 1,
    action: 'not migrated: no target table for a subscription',
    notes: reason,
  })
}

/* ------------------------------ transformer --------------------------- */

export const transformer: GroupTransformer = {
  group: GROUP,

  async transform(context) {
    switch (context.table) {
      case 'messages':
        return transformMessage(context)
      case 'messages_links':
        return transformMessageLink(context, 'work_order')
      case 'messages_links_po':
        return transformMessageLink(context, 'purchase_order')
      case 'rga_notification':
        return transformRgaNotification(context)
      case 'cron_run_history':
        return transformCronRun(context)
      case 'site_activity_logs':
        return transformActivityLog(context)
      case 'email_messages_to_sub':
        return transformEmailToSub(context)
      case 'sub_stock_messages':
        return transformSubStockMessage(context)
      case 'sub_stock_notification':
        return transformSubStockNotification(context)
      case 'message_setup':
        // Per-user routing for the old notification check-in. Settings are curated
        // in the rebuild (§2.5), and there is no per-user routing table to load.
        return recordNotMigrated(
          context,
          'per-user notification routing flag; the rebuild curates settings instead of bulk-copying them and has no routing table',
        )
      case 'po_notification':
        // A per-user "notify me" subscription, not a message. The new system models
        // reminders as job settings, so there is no row to attach it to.
        return recordNotMigrated(
          context,
          'per-user notify-me subscription for a PO/quote; the new purchasing reminders are job settings, so the subscription has no table (client decides whether to re-subscribe people)',
        )
      default:
        throw new Error(`${GROUP}: no mapping for table ${context.table}`)
    }
  },

  unmapped: {
    'messages.id': 'the legacy row id lives in migration.row_map, not on app.messages',
    'messages.read':
      'per-message read flag; app.messages models read state per thread participant (last_read_at), which the legacy row cannot say',
    'messages.receiver':
      'used as the thread participant and never stored on the message; the new model has one author per message',
    'messages_links.id': 'the legacy row id is preserved in notifications.payload, not as the target key',
    'messages_links_po.id': 'the legacy row id is preserved in notifications.payload, not as the target key',
    'po_notification.*':
      'subscription with no target table; see the table-level not_migrated exception',
    'site_activity_logs.php_filename':
      'no column on app.audit_log; kept in the `after` payload so the entry point is not lost',
    'site_activity_logs.section':
      'no column on app.audit_log; kept in the `after` payload',
    'message_setup.*': 'routing preference; see the table-level not_migrated exception',
    'email_messages_to_sub.datetime':
      'unix seconds; converted to notifications.sent_at instead of being kept as text',
    'email_messages_to_sub.sender_id':
      'resolved to notifications.created_by when the user crosswalk exists',
    'email_messages_to_sub.file_attachments':
      'no column on app.notifications; the legacy list is kept in the payload',
    'email_messages_to_sub.parent_id':
      'no thread column on app.notifications; the parent id is kept in the payload',
    'sub_stock_notification.stockfilename':
      'no target column; the uploaded stock file is re-uploaded, not referenced',
  },

  parity: [
    {
      group: GROUP,
      label: 'messages kept',
      // `app.messages.author_user_id` is NOT NULL. A message whose legacy sender
      // is not a migrated username/e-mail has no honest author and is recorded
      // as orphan_line; the anchor counts only attributable messages.
      oldSql: `select count(*)::int as rows
from migration."stg_messages" m
where exists (
  select 1 from migration."stg_users" u
  where lower(btrim(u.username)) = lower(btrim(m.sender))
     or lower(btrim(u.email)) = lower(btrim(m.sender))
)`,
      newSql:
        "select count(*)::int as rows from app.messages m join migration.row_map r on r.entity = 'message' and r.source_table = 'messages' and r.target_key = m.id::text",
    },
    {
      group: GROUP,
      label: 'message body characters preserved',
      oldSql: `select coalesce(sum(length(m.message)), 0)::int as total
from migration."stg_messages" m
where exists (
  select 1 from migration."stg_users" u
  where lower(btrim(u.username)) = lower(btrim(m.sender))
     or lower(btrim(u.email)) = lower(btrim(m.sender))
)`,
      newSql:
        "select coalesce(sum(length(m.body)), 0)::int as total from app.messages m join migration.row_map r on r.entity = 'message' and r.source_table = 'messages' and r.target_key = m.id::text",
    },
    {
      group: GROUP,
      label: 'confirmation messages imported',
      oldSql:
        'select (select count(*) from migration."stg_messages_links") + (select count(*) from migration."stg_messages_links_po") as rows',
      newSql:
        "select count(*)::int as rows from app.notifications where kind = 'legacy.message_link'",
    },
    {
      group: GROUP,
      label: 'RGA reminder notifications kept',
      // The reminder names its RGA; an RGA with a status the app state machine
      // does not allow was not inserted, so its reminder is orphan_line.
      oldSql: `select count(*)::int as rows
from migration."stg_rga_notification" n
where exists (
  select 1 from migration."stg_rga" g
  where g.id = n.rgaid
    and (case when g.status ~ '^[0-9]+$' then g.status::int end) in (2, 3, 4, 6, 7, 10, 11)
)`,
      newSql: `select count(*)::int as rows
from app.rga_notifications n
join migration.row_map r
  on r.entity = 'rga_notification'
 and r.target_table = 'rga_notifications'
 and r.target_key = n.id::text`,
    },
  ],
}
