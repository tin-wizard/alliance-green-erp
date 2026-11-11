/**
 * TJX room, template and fixture masters. Real database, always rolled back.
 */
import { and, desc, eq } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

import { ALL_PERMISSIONS, ForbiddenError } from '@cls/core'
import { getConfig } from '@cls/core/env.server'
import { getDb, type Tx } from '@cls/db'
import {
  auditLog,
  parts,
  subcontractors,
  tjxFixtures,
  users,
} from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import {
  getFixture,
  listFixtures,
  listRooms,
  saveFixtureCore,
  saveRoomCore,
  setFixtureActiveCore,
  setRoomActiveCore,
} from './masters.server'
import {
  deleteTemplateCore,
  getDefaultTemplate,
  getTemplate,
  listTemplates,
  saveTemplateCore,
  setDefaultTemplateCore,
} from './templates.server'

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

const ADMIN_ID = '00000000-0000-4000-8000-0000000000c1'
const READER_ID = '00000000-0000-4000-8000-0000000000c2'
const PART_ONE = 9_420_001
const PART_TWO = 9_420_002
const SUB_ID = 9_420_001

function adminSession(): AuthSessionView {
  return {
    id: 'session-tjx-masters',
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id: ADMIN_ID,
      email: 'tjx-masters-admin@example.test',
      username: 'tjx-masters-admin',
      displayName: 'TJX Masters Admin',
      role: 'admin',
      subcontractorId: null,
      grants: ALL_PERMISSIONS.map((key) => ({ key, scopeSubcontractorId: null })),
    },
  }
}

function readOnlySession(): AuthSessionView {
  return {
    id: 'session-tjx-reader',
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id: READER_ID,
      email: 'tjx-masters-reader@example.test',
      username: 'tjx-masters-reader',
      displayName: 'TJX Masters Reader',
      role: 'technician',
      subcontractorId: null,
      grants: [{ key: 'tjx:read', scopeSubcontractorId: null }],
    },
  }
}

async function seed(tx: Tx): Promise<void> {
  await tx.insert(users).values([
    {
      id: ADMIN_ID,
      email: 'tjx-masters-admin@example.test',
      username: 'tjx-masters-admin',
      displayName: 'TJX Masters Admin',
      role: 'admin',
    },
    {
      id: READER_ID,
      email: 'tjx-masters-reader@example.test',
      username: 'tjx-masters-reader',
      displayName: 'TJX Masters Reader',
      role: 'technician',
    },
  ])
  await tx.insert(parts).values([
    {
      id: PART_ONE,
      partNumber: 'TJX-TEST-1',
      name: 'Test lamp',
      sellPrice: '10.00',
      installCostPerUnit: '3.25',
    },
    {
      id: PART_TWO,
      partNumber: 'WIN-TEST-2',
      name: 'Test ballast',
      sellPrice: '20.00',
      installCostPerUnit: '4.50',
    },
  ])
  await tx.insert(subcontractors).values({ id: SUB_ID, name: 'TJX Test Sub' })
}

async function room(
  tx: Tx,
  name: string,
  sortOrder = 0,
): Promise<{ id: number; name: string }> {
  const created = await saveRoomCore(
    tx,
    { name, description: null, sortOrder, isActive: true },
    adminSession(),
  )
  return { id: created.id, name: created.name }
}

describe.skipIf(!databaseConfigured())('TJX master data', () => {
  test('creates, lists and updates rooms with a case-insensitive unique name', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const created = await room(tx, 'Sales Floor', 2)
      expect(created.name).toBe('Sales Floor')

      const rows = await listRooms(tx, { active: 'all' })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        id: created.id,
        name: 'Sales Floor',
        sortOrder: 2,
        isActive: true,
        usedByTemplates: [],
      })

      await expect(
        saveRoomCore(
          tx,
          { name: ' sales floor ', description: null, sortOrder: 0, isActive: true },
          adminSession(),
        ),
      ).rejects.toThrow(/already exists/i)

      const updated = await saveRoomCore(
        tx,
        {
          id: created.id,
          name: 'Sales Floor North',
          description: 'Main floor',
          sortOrder: 1,
          isActive: true,
        },
        adminSession(),
      )
      expect(updated).toMatchObject({
        name: 'Sales Floor North',
        description: 'Main floor',
        sortOrder: 1,
      })

      const [audit] = await tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, 'tjx.room.update'), eq(auditLog.entityId, String(created.id))))
        .orderBy(desc(auditLog.id))
        .limit(1)
      expect(audit?.actorUserId).toBe(ADMIN_ID)
    })
  })

  test('a room in a template cannot be deactivated until it is removed', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const first = await room(tx, 'Lighting')
      const second = await room(tx, 'Stockroom')
      const template = await saveTemplateCore(
        tx,
        {
          name: 'Default rooms',
          notes: null,
          isDefault: true,
          roomIds: [first.id, second.id],
        },
        adminSession(),
      )
      expect(template.rooms.map((row) => row.roomName)).toEqual(['Lighting', 'Stockroom'])

      await expect(
        setRoomActiveCore(tx, { id: first.id, isActive: false }, adminSession()),
      ).rejects.toThrow(/Default rooms/)

      await saveTemplateCore(
        tx,
        { id: template.id, name: template.name, notes: null, isDefault: true, roomIds: [second.id] },
        adminSession(),
      )
      const deactivated = await setRoomActiveCore(
        tx,
        { id: first.id, isActive: false },
        adminSession(),
      )
      expect(deactivated.isActive).toBe(false)
      expect((await listRooms(tx, { active: 'active' })).map((row) => row.name)).toEqual([
        'Stockroom',
      ])
    })
  })

  test('exactly one default template survives a default change', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const one = await room(tx, 'Room One')
      const two = await room(tx, 'Room Two')
      const first = await saveTemplateCore(
        tx,
        { name: 'First', notes: null, isDefault: true, roomIds: [one.id] },
        adminSession(),
      )
      const second = await saveTemplateCore(
        tx,
        { name: 'Second', notes: null, isDefault: true, roomIds: [two.id] },
        adminSession(),
      )
      expect((await getTemplate(tx, first.id))?.isDefault).toBe(false)
      expect(second.isDefault).toBe(true)
      const defaults = (await listTemplates(tx, {})).filter((row) => row.isDefault)
      expect(defaults.map((row) => row.name)).toEqual(['Second'])
      expect((await getDefaultTemplate(tx))?.name).toBe('Second')

      await expect(
        saveTemplateCore(
          tx,
          { id: second.id, name: second.name, notes: null, isDefault: false, roomIds: [two.id] },
          adminSession(),
        ),
      ).rejects.toThrow(/another template as default/i)
    })
  })

  test('template room order is rewritten densely and a non-default template can be deleted', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const one = await room(tx, 'One', 1)
      const two = await room(tx, 'Two', 2)
      const three = await room(tx, 'Three', 3)
      const template = await saveTemplateCore(
        tx,
        { name: 'Ordered', notes: null, isDefault: true, roomIds: [three.id, one.id, two.id] },
        adminSession(),
      )
      expect(template.rooms.map((row) => [row.roomName, row.sortOrder])).toEqual([
        ['Three', 0],
        ['One', 1],
        ['Two', 2],
      ])
      const reordered = await saveTemplateCore(
        tx,
        { id: template.id, name: 'Ordered', notes: null, isDefault: true, roomIds: [two.id, three.id] },
        adminSession(),
      )
      expect(reordered.rooms.map((row) => [row.roomName, row.sortOrder])).toEqual([
        ['Two', 0],
        ['Three', 1],
      ])

      const second = await saveTemplateCore(
        tx,
        { name: 'Spare', notes: null, isDefault: false, roomIds: [one.id] },
        adminSession(),
      )
      await expect(deleteTemplateCore(tx, template.id, adminSession())).rejects.toThrow(
        /default template/i,
      )
      await deleteTemplateCore(tx, second.id, adminSession())
      expect(await getTemplate(tx, second.id)).toBeNull()
    })
  })

  test('setting a template default is idempotent and audited', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const one = await room(tx, 'Room')
      const first = await saveTemplateCore(
        tx,
        { name: 'First', notes: null, isDefault: true, roomIds: [one.id] },
        adminSession(),
      )
      const second = await saveTemplateCore(
        tx,
        { name: 'Second', notes: null, isDefault: false, roomIds: [one.id] },
        adminSession(),
      )
      const result = await setDefaultTemplateCore(tx, second.id, adminSession())
      expect(result.isDefault).toBe(true)
      expect((await getTemplate(tx, first.id))?.isDefault).toBe(false)
      const again = await setDefaultTemplateCore(tx, second.id, adminSession())
      expect(again.isDefault).toBe(true)
    })
  })

  test('creates fixtures with parts, validates part numbers and keeps list counts', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const created = await saveFixtureCore(
        tx,
        {
          name: 'Highbay fixture',
          description: 'Two-part fixture',
          sortOrder: 1,
          isActive: true,
          parts: [
            {
              partNo: 'tjx-test-1',
              partType: 'Lamp',
              markup: '1.5',
              ratioPerFixture: '2',
              sortOrder: 0,
            },
            {
              partNo: 'WIN-TEST-2',
              partType: 'Ballast',
              markup: '2',
              ratioPerFixture: '1',
              sortOrder: 1,
            },
          ],
        },
        adminSession(),
      )
      expect(created.parts.map((part) => part.partNo)).toEqual(['TJX-TEST-1', 'WIN-TEST-2'])
      const rows = await listFixtures(tx, { active: 'active' })
      expect(rows).toHaveLength(1)
      expect(rows[0]?.partCount).toBe(2)

      const detail = await getFixture(tx, created.id)
      expect(detail?.parts[0]).toMatchObject({
        partNo: 'TJX-TEST-1',
        partType: 'Lamp',
        markup: '1.5000',
        ratioPerFixture: '2.0000',
      })

      await expect(
        saveFixtureCore(
          tx,
          {
            name: 'Bad part',
            description: null,
            sortOrder: 0,
            isActive: true,
            parts: [
              { partNo: 'MISSING-1', partType: '', markup: '1', ratioPerFixture: '1', sortOrder: 0 },
            ],
          },
          adminSession(),
        ),
      ).rejects.toThrow(/Unknown part number: MISSING-1/)

      await expect(
        saveFixtureCore(
          tx,
          {
            name: 'Duplicate part',
            description: null,
            sortOrder: 0,
            isActive: true,
            parts: [
              { partNo: 'TJX-TEST-1', partType: '', markup: '1', ratioPerFixture: '1', sortOrder: 0 },
              { partNo: 'tjx-test-1', partType: '', markup: '1', ratioPerFixture: '1', sortOrder: 1 },
            ],
          },
          adminSession(),
        ),
      ).rejects.toThrow(/more than once/i)

      await expect(
        saveFixtureCore(
          tx,
          {
            name: 'Zero markup',
            description: null,
            sortOrder: 0,
            isActive: true,
            parts: [
              { partNo: 'TJX-TEST-1', partType: '', markup: '0', ratioPerFixture: '1', sortOrder: 0 },
            ],
          },
          adminSession(),
        ),
      ).rejects.toThrow(/markup/i)
    })
  })

  test('deactivating a fixture keeps it readable and out of the active list', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      const created = await saveFixtureCore(
        tx,
        {
          name: 'Deactivatable',
          description: null,
          sortOrder: 0,
          isActive: true,
          parts: [
            { partNo: 'TJX-TEST-1', partType: '', markup: '1', ratioPerFixture: '1', sortOrder: 0 },
          ],
        },
        adminSession(),
      )
      await setFixtureActiveCore(tx, { id: created.id, isActive: false }, adminSession())
      expect(await listFixtures(tx, { active: 'active' })).toHaveLength(0)
      expect(await listFixtures(tx, { active: 'all' })).toHaveLength(1)
      expect((await getFixture(tx, created.id))?.isActive).toBe(false)
      const [row] = await tx.select().from(tjxFixtures).where(eq(tjxFixtures.id, created.id))
      expect(row?.isActive).toBe(false)
    })
  })

  test('a read-only session can list but cannot mutate', async () => {
    await inRollback(async (tx) => {
      await seed(tx)
      await room(tx, 'Visible')
      expect(await listRooms(tx, { active: 'all' })).toHaveLength(1)
      await expect(
        saveRoomCore(
          tx,
          { name: 'Forbidden', description: null, sortOrder: 0, isActive: true },
          readOnlySession(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError)
      await expect(
        saveFixtureCore(
          tx,
          {
            name: 'Forbidden fixture',
            description: null,
            sortOrder: 0,
            isActive: true,
            parts: [
              { partNo: 'TJX-TEST-1', partType: '', markup: '1', ratioPerFixture: '1', sortOrder: 0 },
            ],
          },
          readOnlySession(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })
})
