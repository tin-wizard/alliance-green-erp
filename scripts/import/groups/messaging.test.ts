/**
 * Group 12 mapping rules: history and latin1 text.
 *
 * The rule this file exists to protect: a legacy body is copied exactly as it was
 * stored. No trim, no repair, no transcoding — and a `Ã`/`Â` sequence is recorded
 * so the client, not the migration, decides what to do about it.
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { getDb, type Tx } from '@cls/db'
import {
  auditLog,
  jobRuns,
  messageThreadParticipants,
  migrationExceptions,
  migrationRowMap,
  messages,
  notifications,
  users,
} from '@cls/db/schema'
import { runTransformerRow, databaseConfigured } from '../testing'
import { transformer } from './messaging'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 })

const db = getDb()
const RUN = `g12-${Date.now()}-${Math.floor(Math.random() * 100_000)}`
const GROUP = 'messaging-history'
const POLICY_SKIP_KEYS = ['po_notification:all']

const createdUserIds: string[] = []

function key(name: string): string {
  return `${RUN}-${name}`
}

async function inTransaction(fn: (tx: Tx) => Promise<void>): Promise<void> {
  await db.transaction(async (tx) => {
    await fn(tx)
  })
}

async function createUser(name: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      email: `${RUN}-${name}@example.com`,
      username: `${RUN}-${name}`,
      displayName: `Test ${name}`,
    })
    .returning({ id: users.id })
  createdUserIds.push(row!.id)
  return row!.id
}

async function exceptionsFor(sourceKey: string) {
  return db
    .select()
    .from(migrationExceptions)
    .where(eq(migrationExceptions.sourceKey, sourceKey))
}

async function targetKey(sourceKey: string): Promise<string | null> {
  const [row] = await db
    .select({ targetKey: migrationRowMap.targetKey })
    .from(migrationRowMap)
    .where(eq(migrationRowMap.sourceKey, sourceKey))
    .limit(1)
  return row?.targetKey ?? null
}

afterAll(async () => {
  await db.execute(sql`
    delete from app.message_threads where id in (
      select target_key::uuid from migration.row_map
      where target_table = 'message_threads' and source_key like ${`${RUN}-%`}
    )`)
  await db.execute(sql`
    delete from app.notifications where id in (
      select target_key::uuid from migration.row_map
      where target_table = 'notifications' and source_key like ${`${RUN}-%`}
    )`)
  await db.execute(sql`
    delete from app.job_runs where id in (
      select target_key::bigint from migration.row_map
      where target_table = 'job_runs' and source_key like ${`${RUN}-%`}
    )`)
  await db.execute(sql`
    delete from app.sub_stock_messages where id in (
      select target_key::bigint from migration.row_map
      where target_table = 'sub_stock_messages' and source_key like ${`${RUN}-%`}
    )`)
  await db.execute(sql`
    delete from app.audit_log where id in (
      select target_key::bigint from migration.row_map
      where target_table = 'audit_log' and source_key like ${`${RUN}-%`}
    )`)
  if (createdUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUserIds))
  }
  await db
    .delete(migrationRowMap)
    .where(sql`${migrationRowMap.sourceKey} like ${`${RUN}-%`}`)
  await db
    .delete(migrationExceptions)
    .where(
      sql`${migrationExceptions.sourceKey} like ${`${RUN}-%`} or ${inArray(migrationExceptions.sourceKey, POLICY_SKIP_KEYS)}`,
    )
})

describe.skipIf(!databaseConfigured())(`${GROUP} transformer`, () => {
  it('preserves a latin1 body exactly and reports the mojibake signature', async () => {
    const alice = await createUser('alice')
    const bob = await createUser('bob')
    const sourceKey = key('msg-latin1')
    const body = 'Caf\u00c3\u00a9 \u00c3\u00a9clairage \u00e2\u0082\u00ac'

    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'messages',
        sourceKey,
        row: {
          id: '101',
          sender: `${RUN}-alice`,
          receiver: `${RUN}-bob`,
          subject: 'Caf\u00c3\u00a9',
          datetime: '2024-09-01 08:30:00',
          message: body,
          read: '1',
        },
      }),
    )

    const mapped = await targetKey(sourceKey)
    expect(mapped).not.toBeNull()
    const [message] = await db.select().from(messages).where(eq(messages.id, mapped!))
    expect(message?.body).toBe(body)
    expect(message?.authorUserId).toBe(alice)
    // 08:30 Toronto on 1 September is 12:30 UTC.
    expect(message?.createdAt.toISOString()).toBe('2024-09-01T12:30:00.000Z')

    const participants = await db
      .select()
      .from(messageThreadParticipants)
      .where(eq(messageThreadParticipants.threadId, message!.threadId))
    expect(participants.map((row) => row.userId).sort()).toEqual([alice, bob].sort())

    const classes = (await exceptionsFor(sourceKey)).map((row) => row.exceptionClass)
    expect(classes).toContain('mojibake_suspected')
  })

  it('stores an empty body as an empty string, never NULL', async () => {
    await createUser('carol')
    const sourceKey = key('msg-empty')
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'messages',
        sourceKey,
        row: { id: '102', sender: `${RUN}-carol`, receiver: '', subject: '', message: null },
      }),
    )

    const mapped = await targetKey(sourceKey)
    expect(mapped).not.toBeNull()
    const [message] = await db.select().from(messages).where(eq(messages.id, mapped!))
    expect(message?.body).toBe('')
  })

  it('reports a message whose sender is not an app user, and inserts nothing', async () => {
    const sourceKey = key('msg-orphan')
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'messages',
        sourceKey,
        row: { id: '103', sender: 'nobody-here', receiver: 'x', subject: 's', message: 'hi' },
      }),
    )

    expect(await targetKey(sourceKey)).toBeNull()
    const classes = (await exceptionsFor(sourceKey)).map((row) => row.exceptionClass)
    expect(classes).toContain('orphan_line')
  })

  it('keeps a confirmation message as a notification with its legacy reference', async () => {
    const sourceKey = key('link-1')
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'messages_links',
        sourceKey,
        row: {
          id: '201',
          woid: '555',
          confirmation_key: `${RUN}-confirm`,
          message_text: 'Confirm you received the parts.',
          message_title: 'Parts confirmation',
          date: '2024-10-02 15:45:00',
          is_responded: '1',
        },
      }),
    )

    const mapped = await targetKey(sourceKey)
    expect(mapped).not.toBeNull()
    const [row] = await db.select().from(notifications).where(eq(notifications.id, mapped!))
    expect(row?.kind).toBe('legacy.message_link')
    expect(row?.entityType).toBe('work_order')
    expect(row?.entityId).toBe('555')
    expect(row?.status).toBe('sent')
    expect(row?.legacyRef).toBe(`messages_links:${sourceKey}`)
    expect(row?.dedupeKey).toBe(`legacy:messages_links:${RUN}-confirm`)
    expect(row?.payload).toMatchObject({ confirmationKey: `${RUN}-confirm`, isResponded: 1 })
  })

  it('keeps a PO confirmation message on the purchase-order entity', async () => {
    const sourceKey = key('link-po')
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'messages_links_po',
        sourceKey,
        row: { id: '202', poid: '88', message_title: 'PO', message_text: 'Confirm order' },
      }),
    )

    const [row] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, (await targetKey(sourceKey))!))
    expect(row?.entityType).toBe('purchase_order')
    expect(row?.entityId).toBe('88')
  })

  it('records one policy skip for the PO subscription table', async () => {
    for (const id of ['301', '302']) {
      await inTransaction((tx) =>
        runTransformerRow(tx, transformer, {
          group: GROUP,
          table: 'po_notification',
          sourceKey: key(`po-notify-${id}`),
          row: { id, poid: '1', notify_type: 'po', user_id: '1', is_notified: '1' },
        }),
      )
    }

    const rows = await db
      .select()
      .from(migrationExceptions)
      .where(
        and(
          eq(migrationExceptions.exceptionClass, 'not_migrated'),
          eq(migrationExceptions.sourceKey, 'po_notification:all'),
        ),
      )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.entity).toBe('po_notification')
  })

  it('keeps the old scheduler history in the job ledger with a business date', async () => {
    const sourceKey = key('cron-1')
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'cron_run_history',
        sourceKey,
        row: {
          id: '401',
          cronname: `${RUN}-reminders`,
          // 2025-01-01T00:00:00Z is still 31 December in Toronto.
          execute_timeint: '1735689600000',
          runtime: '4.2s',
        },
      }),
    )

    const [row] = await db
      .select()
      .from(jobRuns)
      .where(eq(jobRuns.id, Number(await targetKey(sourceKey))))
    expect(row?.jobKey).toBe(`legacy.cron.${RUN}-reminders`)
    expect(row?.businessDate).toBe('2024-12-31')
    expect(row?.scheduledFor.toISOString()).toBe('2025-01-01T00:00:00.000Z')
    expect(row?.detail).toMatchObject({ legacyRuntime: '4.2s', imported: true })
  })

  it('folds a site activity row into the audit log, keeping the PHP entry point', async () => {
    const sourceKey = key('activity-1')
    const actor = await createUser('dave')
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'site_activity_logs',
        sourceKey,
        row: {
          id: '501',
          row_id: '42',
          table_name: 'workorder',
          log_type: 'wo_update',
          user_id: String(9_999_999),
          log_date: '2024-11-05 16:10:00',
          php_filename: 'wo_edit.php',
          section: 'notes',
          notes_comments: 'changed the service date',
        },
      }),
    )

    const [row] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.id, Number(await targetKey(sourceKey))))
    expect(row?.action).toBe('legacy.wo_update')
    expect(row?.entityType).toBe('workorder')
    expect(row?.entityId).toBe('42')
    expect(row?.summary).toBe('changed the service date')
    expect(row?.after).toEqual({ phpFilename: 'wo_edit.php', section: 'notes' })
    // The legacy user id has no crosswalk here, so the actor stays NULL rather
    // than pointing at the first user that happens to exist.
    expect(row?.actorUserId).toBeNull()
    expect(actor).toBeDefined()
    expect(row?.createdAt.toISOString()).toBe('2024-11-05T21:10:00.000Z')
  })

  it('maps a subcontractor stock message into the portal table', async () => {
    const sourceKey = key('sub-stock-message')
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'sub_stock_messages',
        sourceKey,
        row: {
          id: '701',
          notification_id: '',
          subid: '42',
          // A sub-authored message carries no staff `userid`; the portal shows the
          // subcontractor, not the person.
          userid: '',
          usertype: 'sub',
          username: `${RUN}-sub`,
          message_subject: 'Stock count',
          message_text: 'Please confirm the count.',
          is_read: '0',
          date_created: '2024-12-02 07:45:00',
        },
      }),
    )

    const mapped = await targetKey(sourceKey)
    expect(mapped).not.toBeNull()
    const [row] = await db.execute(
      sql`select subcontractor_id, user_id, message, is_read, created_at from app.sub_stock_messages where id = ${Number(mapped)}`,
    ) as unknown as Array<{
      subcontractor_id: number
      user_id: string | null
      message: string
      is_read: boolean
      created_at: string
    }>
    expect(row?.subcontractor_id).toBe(42)
    expect(row?.user_id).toBeNull()
    expect(row?.message).toBe('Please confirm the count.')
    expect(row?.is_read).toBe(false)
    // 07:45 Toronto wall clock is 12:45 UTC in December (EST).
    expect(new Date(row!.created_at).toISOString()).toBe('2024-12-02T12:45:00.000Z')
  })

  it('reports an RGA reminder whose RGA does not exist', async () => {
    const sourceKey = key('rga-notify-orphan')
    await inTransaction((tx) =>
      runTransformerRow(tx, transformer, {
        group: GROUP,
        table: 'rga_notification',
        sourceKey,
        row: { id: '601', rgaid: '777777', notify_type: 'rga', user_id: '1', is_notified: '0' },
      }),
    )

    expect(await targetKey(sourceKey)).toBeNull()
    const classes = (await exceptionsFor(sourceKey)).map((row) => row.exceptionClass)
    expect(classes).toContain('orphan_line')
  })
})
