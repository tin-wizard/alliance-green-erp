import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { ROLES } from '@cls/core'
import { getDb } from '@cls/db'
import { permissionMiddleware } from '../../../server/middleware'

const role = z.enum(ROLES as [string, ...string[]])

export const listAdminUsersFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({}).parse(input ?? {}))
  .middleware([permissionMiddleware('admin:users')])
  .handler(async ({ context }) => {
    const { listAdminUsers } = await import('./admin.server')
    return listAdminUsers(context.session, getDb())
  })

export const inviteUserFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z
      .object({
        email: z.email(),
        displayName: z.string().trim().min(1).max(120),
        username: z.string().trim().max(120).optional(),
        role,
      })
      .parse(input),
  )
  .middleware([permissionMiddleware('admin:users')])
  .handler(async ({ data, context }) => {
    const { inviteUserCore } = await import('./admin.server')
    return inviteUserCore(
      { ...data, role: data.role as (typeof ROLES)[number] },
      context.session,
    )
  })

export const updateUserFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z
      .object({
        id: z.uuid(),
        role: role.optional(),
        isEnabled: z.boolean().optional(),
        displayName: z.string().trim().min(1).max(120).optional(),
      })
      .parse(input),
  )
  .middleware([permissionMiddleware('admin:users')])
  .handler(async ({ data, context }) => {
    const { updateUserCore } = await import('./admin.server')
    await getDb().transaction((tx) =>
      updateUserCore(
        tx,
        { ...data, role: data.role as (typeof ROLES)[number] | undefined },
        context.session,
      ),
    )
    return { ok: true }
  })

export const grantPermissionFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z
      .object({
        userId: z.uuid(),
        permissionKey: z.string().trim().min(1),
        note: z.string().trim().max(500).optional(),
        scopeSubcontractorId: z.number().int().positive().nullable().optional(),
        expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      })
      .parse(input),
  )
  .middleware([permissionMiddleware('admin:users')])
  .handler(async ({ data, context }) => {
    const { grantPermissionCore } = await import('./admin.server')
    await getDb().transaction((tx) => grantPermissionCore(tx, data, context.session))
    return { ok: true }
  })

export const revokePermissionFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z.object({ userId: z.uuid(), permissionKey: z.string().trim().min(1) }).parse(input),
  )
  .middleware([permissionMiddleware('admin:users')])
  .handler(async ({ data, context }) => {
    const { revokePermissionCore } = await import('./admin.server')
    await getDb().transaction((tx) => revokePermissionCore(tx, data, context.session))
    return { ok: true }
  })

export const forcePasswordResetFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => z.object({ id: z.uuid() }).parse(input))
  .middleware([permissionMiddleware('admin:users')])
  .handler(async ({ data, context }) => {
    const { forcePasswordResetCore } = await import('./admin.server')
    await forcePasswordResetCore(data.id, context.session)
    return { ok: true }
  })

export const listSettingsFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({}).parse(input ?? {}))
  .middleware([permissionMiddleware('admin:settings')])
  .handler(async ({ context }) => {
    const { listSettings } = await import('./admin.server')
    return listSettings(context.session, getDb())
  })

export const saveSettingFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z.object({ key: z.string().trim().min(1), value: z.unknown() }).parse(input),
  )
  .middleware([permissionMiddleware('admin:settings')])
  .handler(async ({ data, context }) => {
    const { saveSettingCore } = await import('./admin.server')
    return getDb().transaction((tx) => saveSettingCore(tx, data, context.session))
  })

export const listAuditFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) =>
    z
      .object({
        actor: z.string().trim().max(120).optional(),
        action: z.string().trim().max(120).optional(),
        entityType: z.string().trim().max(80).optional(),
        entityId: z.string().trim().max(80).optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(200).optional(),
      })
      .parse(input ?? {}),
  )
  .middleware([permissionMiddleware('admin:audit')])
  .handler(async ({ data, context }) => {
    const { listAudit } = await import('./admin.server')
    return listAudit(context.session, data, getDb())
  })
