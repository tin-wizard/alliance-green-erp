/**
 * Messaging integration tests. Real database, always rolled back.
 *
 * Covers internal thread/unread state, recipient-scoped notifications, admin
 * outbox retries and the drain job with the memory transport.
 */
import { describe, expect, test, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

import { getConfig } from '@cls/core/env.server'
import { getDb, type Tx } from '@cls/db'
import { notifications, messageThreadParticipants, users } from '@cls/db/schema'
import { MemoryTransport, queueNotification } from '@cls/notifications'
import type { AuthSessionView } from '../../../server/auth.types'
import {
  createThreadCore,
  drainOutboxCore,
  getThread,
  listNotifications,
  listOutbox,
  listMessageUsers,
  listThreads,
  markNotificationReadCore,
  markThreadReadCore,
  replyThreadCore,
  retryNotificationCore,
} from './messaging.server'

function databaseConfigured(): boolean {
  try {
    return Boolean(getConfig().databaseUrl)
  } catch {
    return false
  }
}

class Rollback extends Error {}

async function inRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await getDb().transaction(async (tx) => {
      await fn(tx)
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
}

const suffix = 100_000 + Math.floor(Math.random() * 800_000)
const ALICE = '00000000-0000-4000-8000-0000000000d1'
const BOB = '00000000-0000-4000-8000-0000000000d2'
const OUTSIDER = '00000000-0000-4000-8000-0000000000d3'

function sessionFor(
  id: string,
  email: string,
  grants: string[] = ['messages:read', 'messages:write'],
): AuthSessionView {
  return {
    id: `session-${id}`,
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id,
      email,
      username: email,
      displayName: email.split('@')[0]!,
      role: 'admin',
      subcontractorId: null,
      grants: grants.map((key) => ({ key, scopeSubcontractorId: null })),
    },
  }
}

const alice = sessionFor(ALICE, `alice-${suffix}@example.test`, [
  'messages:read',
  'messages:write',
  'messages:admin',
])
const bob = sessionFor(BOB, `bob-${suffix}@example.test`)
const outsider = sessionFor(OUTSIDER, `outsider-${suffix}@example.test`)

async function seed(tx: Tx): Promise<void> {
  await tx.insert(users).values([
    {
      id: ALICE,
      email: `alice-${suffix}@example.test`,
      username: `alice-${suffix}`,
      displayName: 'Alice',
      role: 'admin',
    },
    {
      id: BOB,
      email: `bob-${suffix}@example.test`,
      username: `bob-${suffix}`,
      displayName: 'Bob',
      role: 'technician',
    },
    {
      id: OUTSIDER,
      email: `outsider-${suffix}@example.test`,
      username: `outsider-${suffix}`,
      displayName: 'Outsider',
      role: 'technician',
    },
  ])
}

describe.skipIf(!databaseConfigured())('messaging', () => {
  test('a subcontractor sees admins and their own vendor contacts only', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const VENDOR_USER = '00000000-0000-4000-8000-0000000000d4'
      const VENDOR_MATE = '00000000-0000-4000-8000-0000000000d5'
      const OTHER_VENDOR = '00000000-0000-4000-8000-0000000000d6'
      await tx.insert(users).values([
        {
          id: VENDOR_USER,
          email: `vendor-${suffix}@example.test`,
          username: `vendor-${suffix}`,
          displayName: 'Vendor User',
          role: 'subcontractor',
          subcontractorId: 7701,
        },
        {
          id: VENDOR_MATE,
          email: `vendor-mate-${suffix}@example.test`,
          username: `vendor-mate-${suffix}`,
          displayName: 'Vendor Mate',
          role: 'subcontractor',
          subcontractorId: 7701,
        },
        {
          id: OTHER_VENDOR,
          email: `other-vendor-${suffix}@example.test`,
          username: `other-vendor-${suffix}`,
          displayName: 'Other Vendor',
          role: 'subcontractor',
          subcontractorId: 7702,
        },
      ])
      const baseSession = sessionFor(VENDOR_USER, `vendor-${suffix}@example.test`)
      const vendorSession: AuthSessionView = {
        ...baseSession,
        user: {
          ...baseSession.user,
          role: 'subcontractor',
          subcontractorId: 7701,
        },
      }

      const visible = (await listMessageUsers(vendorSession, tx)).map((person) => person.id)
      expect(visible).toContain(ALICE)
      expect(visible).toContain(VENDOR_MATE)
      expect(visible).not.toContain(BOB)
      expect(visible).not.toContain(OTHER_VENDOR)
      expect(visible).not.toContain(VENDOR_USER)
    })
  })

  test('threads keep unread state per participant', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const created = await createThreadCore(
        tx,
        { subject: 'Dispatch hand-off', body: 'Please check WO 42.', participantIds: [BOB] },
        alice,
      )

      const bobThreads = await listThreads(bob, tx)
      expect(bobThreads[0]).toMatchObject({ id: created.id, unread: 1, preview: 'Please check WO 42.' })

      const detail = await getThread(created.id, bob, tx)
      expect(detail.participants.map((person) => person.name).sort()).toEqual(['Alice', 'Bob'])
      expect(detail.messages).toHaveLength(1)

      // This test runs in one transaction, where Postgres `now()` is frozen at
      // the first statement. Real replies arrive in a later transaction; set
      // Alice's read point back so the reply is observably newer.
      await tx
        .update(messageThreadParticipants)
        .set({ lastReadAt: new Date(0) })
        .where(
          and(
            eq(messageThreadParticipants.threadId, created.id),
            eq(messageThreadParticipants.userId, ALICE),
          ),
        )

      await replyThreadCore(tx, { threadId: created.id, body: 'On it.' }, bob)
      const aliceThreads = await listThreads(alice, tx)
      expect(aliceThreads[0]?.unread).toBe(1)
      expect((await listThreads(bob, tx))[0]?.unread).toBe(0)

      await markThreadReadCore(tx, created.id, alice)
      expect((await listThreads(alice, tx))[0]?.unread).toBe(0)

      await expect(getThread(created.id, outsider, tx)).rejects.toThrow('not found')
      await expect(
        createThreadCore(tx, { subject: '', body: 'x', participantIds: [BOB] }, alice),
      ).rejects.toThrow('subject')
    })
  })

  test('notification centre, admin outbox, retry and drain', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const queued = await queueNotification(tx, {
        kind: 'system',
        templateKey: 'system-test',
        recipientEmail: alice.user.email,
        recipientUserId: ALICE,
        subject: `System ${suffix}`,
        bodyText: 'Queued body',
        dedupeKey: `system:${suffix}:1`,
      })
      expect(queued).not.toBeNull()
      const duplicate = await queueNotification(tx, {
        kind: 'system',
        templateKey: 'system-test',
        recipientEmail: alice.user.email,
        recipientUserId: ALICE,
        subject: `System duplicate ${suffix}`,
        bodyText: 'Duplicate',
        dedupeKey: `system:${suffix}:1`,
      })
      expect(duplicate).toBeNull()

      const failed = await queueNotification(tx, {
        kind: 'compliance',
        templateKey: 'compliance-wsib-expiry',
        recipientEmail: alice.user.email,
        recipientUserId: ALICE,
        subject: `Failed ${suffix}`,
        bodyText: 'Failed body',
        dedupeKey: `system:${suffix}:2`,
      })
      await tx
        .update(notifications)
        .set({ status: 'failed', attempts: 2, lastError: 'SMTP rejected' })
        .where(eq(notifications.id, failed!))

      const centre = await listNotifications(alice, {}, tx)
      expect(centre.total).toBeGreaterThanOrEqual(2)
      expect(centre.unread).toBeGreaterThanOrEqual(1)
      await markNotificationReadCore(tx, queued!, alice)
      const afterRead = await listNotifications(alice, {}, tx)
      expect(afterRead.rows.find((row) => row.id === queued)?.readAt).not.toBeNull()

      const outbox = await listOutbox(alice, {}, tx)
      expect(outbox.counts.failed).toBeGreaterThanOrEqual(1)
      expect(outbox.rows.some((row) => row.lastError === 'SMTP rejected')).toBe(true)
      await expect(listOutbox(bob, {}, tx)).rejects.toThrow('administrator')

      await retryNotificationCore(tx, failed!, alice)
      const retried = await listOutbox(alice, { status: 'queued' }, tx)
      expect(retried.rows.some((row) => row.id === failed)).toBe(true)

      const transport = new MemoryTransport()
      const drained = await drainOutboxCore(tx, { transport, limit: 25 })
      expect(drained.claimed).toBeGreaterThanOrEqual(2)
      expect(drained.sent).toBeGreaterThanOrEqual(2)
      expect(transport.sent.some((message) => message.subject === `Failed ${suffix}`)).toBe(true)
      const sent = await listOutbox(alice, { status: 'sent' }, tx)
      expect(sent.rows.some((row) => row.id === failed)).toBe(true)
    })
  })

  test('a transport failure backs off instead of losing the message', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const id = await queueNotification(tx, {
        kind: 'system',
        templateKey: 'system-test',
        recipientEmail: alice.user.email,
        recipientUserId: ALICE,
        subject: `Backoff ${suffix}`,
        bodyText: 'Backoff body',
        dedupeKey: `system:${suffix}:backoff`,
      })
      const transport = {
        name: 'failing',
        async send(): Promise<never> {
          throw new Error('connection refused')
        },
      }
      const result = await drainOutboxCore(tx, { transport, limit: 1 })
      expect(result.failed).toBe(1)
      const outbox = await listOutbox(alice, {}, tx)
      const row = outbox.rows.find((item) => item.id === id)
      expect(row?.status).toBe('queued')
      expect(row?.attempts).toBe(1)
      expect(row?.lastError).toContain('connection refused')
    })
  })
})
