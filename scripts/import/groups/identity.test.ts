/**
 * Group 3 — identity.
 *
 * Two rules get a test each because they are the ones that go wrong in a real
 * migration: a duplicate username must not abort the table on the unique index,
 * and no password column may be read — the rows below simply do not have them.
 */
import { and, eq, inArray, like, sql } from 'drizzle-orm'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { getDb } from '@cls/db'
import { getConfig } from '@cls/core/env.server'
import { migrationExceptions, migrationRowMap, userPermissions, users } from '@cls/db/schema'
import { runTransformerRow } from '../testing'
import { transformer } from './identity'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

const configured = (() => {
  try {
    return Boolean(getConfig().databaseUrl)
  } catch {
    return false
  }
})()

const marker = `id${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

const base = 2_100_000_000 + Math.floor(Math.random() * 900_000)
const technicianId = base
const duplicateFirstId = base + 1
const duplicateSecondId = base + 2
const disabledId = base + 3
const noEmailId = base + 4
const adminId = base + 5
const orphanVendorId = base + 6
const grantHolderId = base + 7
const priceEditorId = base + 8
const legacyNameHolderId = base + 9

const legacyIds = [
  technicianId,
  duplicateFirstId,
  duplicateSecondId,
  disabledId,
  noEmailId,
  adminId,
  orphanVendorId,
  grantHolderId,
  priceEditorId,
  legacyNameHolderId,
]

async function transform(table: string, sourceKey: string, row: Record<string, string | null>) {
  await getDb().transaction(async (tx) => {
    await runTransformerRow(tx, transformer, { group: 'identity', table, sourceKey, row })
  })
}

async function userByLegacyId(legacyId: number) {
  const [row] = await getDb().select().from(users).where(eq(users.legacyId, legacyId))
  return row ?? null
}

async function exceptionFor(exceptionClass: string, entity: string, sourceKey: string) {
  const [row] = await getDb()
    .select()
    .from(migrationExceptions)
    .where(
      and(
        eq(migrationExceptions.exceptionClass, exceptionClass),
        eq(migrationExceptions.entity, entity),
        eq(migrationExceptions.sourceKey, sourceKey),
      ),
    )
    .limit(1)
  return row ?? null
}

afterAll(async () => {
  if (!configured) return
  const db = getDb()
  const owned = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.legacyId, legacyIds))
  if (owned.length > 0) {
    await db.delete(userPermissions).where(
      inArray(
        userPermissions.userId,
        owned.map((row) => row.id),
      ),
    )
  }
  await db.delete(users).where(inArray(users.legacyId, legacyIds))
  await db.delete(migrationRowMap).where(like(migrationRowMap.sourceKey, `%${marker}%`))
  await db.delete(migrationExceptions).where(like(migrationExceptions.sourceKey, `%${marker}%`))
})

describe.skipIf(!configured)('identity group', () => {
  test('a user is mapped without any password column present', async () => {
    const sourceKey = `users:${marker}:${technicianId}`
    // Deliberately no `password`, `mailing_password` or `cls_mailing_password` key:
    // the transformer must not need them, and must not name them.
    await transform('users', sourceKey, {
      id: String(technicianId),
      username: `tech-${marker}`,
      email: `tech-${marker}@example.test`,
      access: '3',
      subid: null,
      phone: '555-0100',
      email2: `tech2-${marker}@example.test`,
      full_name: 'Tech One',
      department_type: 'Field',
      user_addworkorder_without_wsib: '0',
      is_enabled: '1',
    })

    const row = await userByLegacyId(technicianId)
    expect(row?.username).toBe(`tech-${marker}`)
    expect(row?.email).toBe(`tech-${marker}@example.test`)
    expect(row?.displayName).toBe('Tech One')
    expect(row?.role).toBe('technician')
    expect(row?.legacyAccess).toBe(3)
    expect(row?.isEnabled).toBe(true)
    expect(row?.phone).toBe('555-0100')
    expect(row?.secondaryEmail).toBe(`tech2-${marker}@example.test`)
    expect(row?.departmentType).toBe('Field')

    const [mapped] = await getDb()
      .select()
      .from(migrationRowMap)
      .where(and(eq(migrationRowMap.entity, 'user'), eq(migrationRowMap.sourceKey, sourceKey)))
    expect(mapped?.targetTable).toBe('users')
    expect(mapped?.targetKey).toBe(row?.id)
  })

  test('a duplicate username keeps one account and records the clash', async () => {
    const shared = `dup-${marker}`
    await transform('users', `users:${marker}:${duplicateFirstId}`, {
      id: String(duplicateFirstId),
      username: shared,
      email: `dup1-${marker}@example.test`,
      access: '3',
      is_enabled: '1',
    })
    // Same username, different case: the unique index is on lower(username).
    await transform('users', `users:${marker}:${duplicateSecondId}`, {
      id: String(duplicateSecondId),
      username: shared.toUpperCase(),
      email: `dup2-${marker}@example.test`,
      access: '3',
      is_enabled: '1',
    })

    const rows = await getDb()
      .select()
      .from(users)
      .where(sql`lower(${users.username}) = ${shared.toLowerCase()}`)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.legacyId).toBe(duplicateFirstId)
    expect(await userByLegacyId(duplicateSecondId)).toBeNull()

    const recorded = await exceptionFor(
      'duplicate_username',
      'user',
      `users:${marker}:${duplicateSecondId}`,
    )
    expect(recorded?.migrationAction).toContain('first row')
  })

  test('a disabled user is migrated disabled and recorded', async () => {
    const sourceKey = `users:${marker}:${disabledId}`
    await transform('users', sourceKey, {
      id: String(disabledId),
      username: `off-${marker}`,
      email: `off-${marker}@example.test`,
      access: '3',
      is_enabled: '0',
    })

    const row = await userByLegacyId(disabledId)
    expect(row?.isEnabled).toBe(false)
    expect((await exceptionFor('disabled_user', 'user', sourceKey))?.migrationAction).toContain(
      'no credential',
    )
  })

  test('a blank email becomes a reserved placeholder and is recorded', async () => {
    const sourceKey = `users:${marker}:${noEmailId}`
    await transform('users', sourceKey, {
      id: String(noEmailId),
      username: `nomail-${marker}`,
      email: '   ',
      access: '3',
      is_enabled: '1',
    })

    const row = await userByLegacyId(noEmailId)
    expect(row?.email).toBe(`user-${noEmailId}@legacy.invalid`)
    expect(row?.email.endsWith('.invalid')).toBe(true)
    expect((await exceptionFor('no_email', 'user', sourceKey))?.migrationAction).toContain(
      'placeholder',
    )
  })

  test('the legacy access level decides the admin role', async () => {
    await transform('users', `users:${marker}:${adminId}`, {
      id: String(adminId),
      username: `boss-${marker}`,
      email: `boss-${marker}@example.test`,
      access: '9',
      is_enabled: '1',
    })

    const row = await userByLegacyId(adminId)
    expect(row?.role).toBe('admin')
    expect(row?.legacyAccess).toBe(9)
  })

  test('a subid with no vendor row is an exception, not a fake vendor', async () => {
    const sourceKey = `users:${marker}:${orphanVendorId}`
    await transform('users', sourceKey, {
      id: String(orphanVendorId),
      username: `subacct-${marker}`,
      email: `subacct-${marker}@example.test`,
      access: '2',
      subid: String(base + 901),
      is_enabled: '1',
    })

    const row = await userByLegacyId(orphanVendorId)
    expect(row?.subcontractorId).toBeNull()
    expect(
      (await exceptionFor('subcontractor_without_vendor', 'user', sourceKey))?.migrationAction,
    ).toContain('NULL')
  })

  test('named grants map to app permission keys and unknown names become exceptions', async () => {
    await transform('users', `users:${marker}:${grantHolderId}`, {
      id: String(grantHolderId),
      username: `grants-${marker}`,
      email: `grants-${marker}@example.test`,
      access: '3',
      is_enabled: '1',
    })
    const holder = await userByLegacyId(grantHolderId)
    expect(holder).not.toBeNull()

    await transform('user_permissions', `user_permissions:${marker}:1`, {
      id: '1',
      user_id: String(grantHolderId),
      permission_name: 'workorder:read',
      is_allowed: '1',
      permission_date: null,
    })

    const granted = await getDb()
      .select()
      .from(userPermissions)
      .where(eq(userPermissions.userId, holder!.id))
    expect(granted).toHaveLength(1)
    expect(granted[0]?.permissionKey).toBe('workorder:read')
    expect(granted[0]?.isAllowed).toBe(true)
    expect(granted[0]?.expiresAt).toBeNull()

    const unknownKey = `user_permissions:${marker}:2`
    await transform('user_permissions', unknownKey, {
      id: '2',
      user_id: String(grantHolderId),
      permission_name: 'legacy:not_a_key',
      is_allowed: '1',
      permission_date: null,
    })
    expect(await exceptionFor('unknown_enum', 'user_permission', unknownKey)).not.toBeNull()

    const orphanKey = `user_permissions:${marker}:3`
    await transform('user_permissions', orphanKey, {
      id: '3',
      user_id: String(base + 902),
      permission_name: 'workorder:read',
      is_allowed: '1',
      permission_date: null,
    })
    expect(await exceptionFor('orphan_line', 'user_permission', orphanKey)).not.toBeNull()

    // The unknown and orphan rows added nothing: one grant, still.
    const after = await getDb()
      .select()
      .from(userPermissions)
      .where(eq(userPermissions.userId, holder!.id))
    expect(after).toHaveLength(1)
  })

  test('the permission_type catalogue is kept in the mirror, not raised as an error', async () => {
    const sourceKey = `permission_type:${marker}:1`
    await transform('permission_type', sourceKey, {
      id: '1',
      permission_name: 'perm_edit_wsib_insurance',
      permission_label: 'Edit WSIB Insurance Document',
      sort_order: '10',
    })
    const recorded = await exceptionFor('not_migrated', 'permission_type', 'permission_type')
    expect(recorded?.migrationAction).toContain('ERP permission catalogue replaces it')
    const [mapped] = await getDb()
      .select()
      .from(migrationRowMap)
      .where(and(eq(migrationRowMap.entity, 'permission_type'), eq(migrationRowMap.sourceKey, sourceKey)))
      .limit(1)
    expect(mapped?.targetTable).toBe('public.permission_type')
  })

  test('the price-editor grant table becomes inventory:edit_price', async () => {
    await transform('users', `users:${marker}:${priceEditorId}`, {
      id: String(priceEditorId),
      username: `prices-${marker}`,
      email: `prices-${marker}@example.test`,
      access: '9',
      is_enabled: '1',
    })
    const editor = await userByLegacyId(priceEditorId)

    const sourceKey = `user_permissions_price_management:${marker}:1`
    await transform('user_permissions_price_management', sourceKey, {
      id: '1',
      user_id: String(priceEditorId),
      allowed_by: String(priceEditorId),
      permission_date: '2026-01-31',
    })

    const [granted] = await getDb()
      .select()
      .from(userPermissions)
      .where(eq(userPermissions.userId, editor!.id))
    expect(granted?.permissionKey).toBe('inventory:edit_price')
    expect(granted?.isAllowed).toBe(true)
    expect(granted?.expiresAt?.toISOString()).toBe('2026-01-31T00:00:00.000Z')
    expect(granted?.grantedBy).toBe(editor!.id)
  })

  test('legacy dotted permission names map to app keys and keep their provenance', async () => {
    await transform('users', `users:${marker}:${legacyNameHolderId}`, {
      id: String(legacyNameHolderId),
      username: `legacygrants-${marker}`,
      email: `legacygrants-${marker}@example.test`,
      access: '3',
      is_enabled: '1',
    })
    const holder = await userByLegacyId(legacyNameHolderId)
    expect(holder).not.toBeNull()

    const sourceKey = `user_permissions:${marker}:legacy`
    await transform('user_permissions', sourceKey, {
      id: '9',
      user_id: String(legacyNameHolderId),
      permission_name: 'workorders.edit',
      is_allowed: '1',
      permission_date: null,
    })

    const [granted] = await getDb()
      .select()
      .from(userPermissions)
      .where(eq(userPermissions.userId, holder!.id))
    expect(granted?.permissionKey).toBe('workorder:write')
    // The raw legacy name stays on the row so a reviewer can see where it came from.
    expect(granted?.note).toContain('workorders.edit')
  })

  test('the unmapped record names every credential column as never migrated', () => {
    expect(transformer.unmapped?.['users.password']).toContain('never read')
    expect(transformer.unmapped?.['users.mailing_password']).toContain('not identity')
    expect(transformer.unmapped?.['users.cls_mailing_password']).toContain('not identity')
  })
})
