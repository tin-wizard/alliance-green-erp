/**
 * Admin integration tests. Real database, always rolled back.
 *
 * Pins the typed settings catalogue and validation, role/enablement updates
 * with the last-administrator guard, and the activity-log filters.
 */
import { and, eq, ne } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

import { getConfig } from '@cls/core/env.server'
import { getDb, type Tx } from '@cls/db'
import { auditLog, settings, users } from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import {
  createUserRowCore,
  grantPermissionCore,
  listAdminUsers,
  listAudit,
  listSettings,
  revokePermissionCore,
  saveSettingCore,
  updateUserCore,
} from './admin.server'

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

const suffix = 700_000 + Math.floor(Math.random() * 200_000)
const ADMIN_ID = '00000000-0000-4000-8000-0000000000d1'
const OTHER_ADMIN_ID = '00000000-0000-4000-8000-0000000000d2'
const TECH_ID = '00000000-0000-4000-8000-0000000000d3'
const ADMIN_EMAIL = `admin-${suffix}@example.test`

function session(id = ADMIN_ID, email = ADMIN_EMAIL): AuthSessionView {
  return {
    id: 'session-test',
    expiresAt: new Date(Date.now() + 3_600_000),
    lastSeenAt: new Date(),
    user: {
      id,
      email,
      username: email,
      displayName: 'Admin Test',
      role: 'admin',
      subcontractorId: null,
      grants: [
        { key: 'admin:users', scopeSubcontractorId: null },
        { key: 'admin:settings', scopeSubcontractorId: null },
        { key: 'admin:audit', scopeSubcontractorId: null },
      ],
    },
  }
}

async function seedAdmins(tx: Tx): Promise<void> {
  await tx.insert(users).values([
    {
      id: ADMIN_ID,
      email: ADMIN_EMAIL,
      username: `admin-${suffix}`,
      displayName: 'Admin Test',
      role: 'admin',
    },
    {
      id: OTHER_ADMIN_ID,
      email: `admin2-${suffix}@example.test`,
      username: `admin2-${suffix}`,
      displayName: 'Other Admin',
      role: 'admin',
    },
    {
      id: TECH_ID,
      email: `tech-${suffix}@example.test`,
      username: `tech-${suffix}`,
      displayName: 'Tech Test',
      role: 'technician',
    },
  ])
}

describe.skipIf(!databaseConfigured())('admin', () => {
  test('settings are typed, validated, stored and audited', async () => {
    await inRollback(async (tx) => {
      await seedAdmins(tx)
      const defaults = await listSettings(session(), tx)
      expect(defaults.find((row) => row.key === 'company.name')?.value).toBe('Alliance Lighting')
      expect(defaults.find((row) => row.key === 'reports.default_page_size')?.isDefault).toBe(true)

      const saved = await saveSettingCore(
        tx,
        { key: 'reports.default_page_size', value: '250' },
        session(),
      )
      expect(saved.find((row) => row.key === 'reports.default_page_size')?.value).toBe(250)
      expect(saved.find((row) => row.key === 'reports.default_page_size')?.isDefault).toBe(false)

      await expect(
        saveSettingCore(tx, { key: 'reports.default_page_size', value: '9999' }, session()),
      ).rejects.toThrow(/at most 500/)
      await expect(
        saveSettingCore(tx, { key: 'company.timezone', value: 'Mars/Olympus' }, session()),
      ).rejects.toThrow(/IANA timezone/)
      await expect(
        saveSettingCore(tx, { key: 'not.a.setting', value: 'x' }, session()),
      ).rejects.toThrow(/Unknown setting/)

      const rows = await tx
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, 'admin.settings.update'))
      const savedRows = rows.filter((row) => row.entityId === 'reports.default_page_size')
      expect(savedRows).toHaveLength(1)
      expect(savedRows[0]?.before).toBeNull()
      expect(savedRows[0]?.after).toEqual({ value: 250 })
    })
  })

  test('users are created, updated and the last administrator is protected', async () => {
    await inRollback(async (tx) => {
      await seedAdmins(tx)
      await tx.insert(settings).values({ key: 'company.name', valueType: 'string', value: 'x' })

      const created = await createUserRowCore(
        tx,
        {
          email: `new-tech-${suffix}@Example.Test`,
          displayName: 'New Tech',
          role: 'technician',
        },
        session(),
      )
      expect(created.id).toBeTruthy()
      const [row] = await tx.select().from(users).where(eq(users.id, created.id))
      expect(row?.email).toBe(`new-tech-${suffix}@example.test`)
      expect(row?.role).toBe('technician')

      await expect(
        createUserRowCore(
          tx,
          { email: `NEW-TECH-${suffix}@example.test`, displayName: 'Dup', role: 'technician' },
          session(),
        ),
      ).rejects.toThrow(/already exists/)

      await updateUserCore(tx, { id: created.id, role: 'admin', displayName: 'Promoted Tech' }, session())
      const [promoted] = await tx.select().from(users).where(eq(users.id, created.id))
      expect(promoted?.role).toBe('admin')
      expect(promoted?.displayName).toBe('Promoted Tech')

      await grantPermissionCore(
        tx,
        {
          userId: created.id,
          permissionKey: 'workorder:override_wsib_hold',
          note: 'Temporary coverage',
        },
        session(),
      )
      await expect(
        grantPermissionCore(
          tx,
          { userId: created.id, permissionKey: 'not:a:permission' },
          session(),
        ),
      ).rejects.toThrow(/Unknown permission/)
      let withGrant = await listAdminUsers(session(), tx)
      expect(withGrant.find((user) => user.id === created.id)?.grants).toEqual([
        {
          key: 'workorder:override_wsib_hold',
          note: 'Temporary coverage',
          expiresAt: null,
        },
      ])
      await revokePermissionCore(
        tx,
        { userId: created.id, permissionKey: 'workorder:override_wsib_hold' },
        session(),
      )
      withGrant = await listAdminUsers(session(), tx)
      expect(withGrant.find((user) => user.id === created.id)?.grants).toEqual([])
      const grantAudit = await tx
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.entityId, created.id),
            eq(auditLog.action, 'admin.user.grant'),
          ),
        )
      expect(grantAudit).toHaveLength(1)

      await updateUserCore(tx, { id: created.id, isEnabled: false }, session())
      const listed = await listAdminUsers(session(), tx)
      expect(listed.find((user) => user.id === created.id)?.isEnabled).toBe(false)
      expect(listed.find((user) => user.id === TECH_ID)?.role).toBe('technician')

      // Demote the other admins one by one; the last enabled admin survives.
      await updateUserCore(tx, { id: created.id, role: 'technician' }, session())
      await updateUserCore(tx, { id: OTHER_ADMIN_ID, role: 'technician' }, session())
      // Other administrators may exist in the shared database; demote them in
      // this transaction so ADMIN_ID is genuinely the last enabled one.
      const remaining = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.isEnabled, true), ne(users.id, ADMIN_ID)))
      for (const admin of remaining) {
        await tx.update(users).set({ role: 'technician' }).where(eq(users.id, admin.id))
      }
      await expect(
        updateUserCore(tx, { id: ADMIN_ID, role: 'technician' }, session()),
      ).rejects.toThrow(/last enabled administrator/)
      await expect(
        updateUserCore(tx, { id: ADMIN_ID, isEnabled: false }, session()),
      ).rejects.toThrow(/last enabled administrator/)

      const auditRows = await tx
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.action, 'admin.user.update'), eq(auditLog.entityId, created.id)),
        )
      expect(auditRows.length).toBeGreaterThanOrEqual(2)
    })
  })

  test('activity log filters by actor, action, entity and date', async () => {
    await inRollback(async (tx) => {
      await seedAdmins(tx)
      await tx.insert(auditLog).values([
        {
          actorUserId: ADMIN_ID,
          actorLabel: ADMIN_EMAIL,
          action: 'admin.test.alpha',
          entityType: 'widget',
          entityId: 'w-1',
          summary: 'First',
        },
        {
          actorUserId: TECH_ID,
          actorLabel: `tech-${suffix}@example.test`,
          action: 'admin.test.beta',
          entityType: 'widget',
          entityId: 'w-2',
          summary: 'Second',
        },
        {
          actorUserId: ADMIN_ID,
          actorLabel: ADMIN_EMAIL,
          action: 'admin.test.beta',
          entityType: 'gadget',
          entityId: 'g-1',
          summary: 'Third',
        },
      ])
      const byAction = await listAudit(session(), { action: 'admin.test.beta' }, tx)
      expect(byAction.total).toBe(2)
      expect(byAction.actions).toContain('admin.test.alpha')

      const byEntity = await listAudit(
        session(),
        { entityType: 'widget', entityId: 'w-1' },
        tx,
      )
      expect(byEntity.rows).toHaveLength(1)
      expect(byEntity.rows[0]?.summary).toBe('First')

      const byActor = await listAudit(session(), { actor: `tech-${suffix}` }, tx)
      expect(byActor.rows).toHaveLength(1)
      expect(byActor.rows[0]?.action).toBe('admin.test.beta')

      const paged = await listAudit(session(), { entityType: 'widget', page: 2, pageSize: 1 }, tx)
      expect(paged.total).toBe(2)
      expect(paged.rows).toHaveLength(1)

      const nonAdmin = session(TECH_ID, `tech-${suffix}@example.test`)
      nonAdmin.user.grants = []
      await expect(listAudit(nonAdmin, {}, tx)).rejects.toThrow(/Administrator access/)
    })
  })
})
