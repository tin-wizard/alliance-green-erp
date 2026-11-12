/**
 * Admin read/write model: users, settings and the activity log. Credentials and
 * sessions stay with Neon Auth; this module owns the application role,
 * enablement, typed settings and the audit reader.
 */
import { and, asc, desc, eq, gte, ilike, lte, ne, or, sql, type SQL } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PERMISSIONS,
  ROLES,
  ValidationError,
  type Role,
} from '@cls/core'
import { getConfig } from '@cls/core/env.server'
import { getDb, type Db, type Tx } from '@cls/db'
import {
  auditLog,
  rolePermissions,
  settings,
  subcontractors,
  userPermissions,
  users,
} from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import {
  SETTING_DEFINITIONS,
  parseSettingValue,
  settingDefinition,
} from '../lib/settings'

type Executor = Db

export interface AdminUser {
  id: string
  email: string
  username: string
  displayName: string
  role: Role
  subcontractorId: number | null
  subcontractor: string | null
  isEnabled: boolean
  lastLoginAt: string | null
  createdAt: string
  grants: { key: string; note: string | null; expiresAt: string | null }[]
}

export interface AuditRowView {
  id: number
  action: string
  entityType: string | null
  entityId: string | null
  actor: string
  actorEmail: string | null
  summary: string | null
  createdAt: string
  ip: string | null
}

export interface AuditFilter {
  actor?: string
  action?: string
  entityType?: string
  entityId?: string
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

export interface SettingRow {
  key: string
  label: string
  description: string
  module: string
  type: string
  value: string | number | boolean
  isDefault: boolean
  updatedAt: string | null
}

function assertAdminUsers(session: AuthSessionView): void {
  if (!session.user.grants.some((grant) => grant.key === 'admin:users')) {
    throw new ForbiddenError('Administrator access is required.')
  }
}

function assertAdminSettings(session: AuthSessionView): void {
  if (!session.user.grants.some((grant) => grant.key === 'admin:settings')) {
    throw new ForbiddenError('Administrator access is required.')
  }
}

export async function listAdminUsers(
  session: AuthSessionView,
  executor?: Executor,
): Promise<AdminUser[]> {
  assertReadUsers(session)
  const db = executor ?? getDb()
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      subcontractorId: users.subcontractorId,
      subcontractor: subcontractors.name,
      isEnabled: users.isEnabled,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(subcontractors, eq(subcontractors.id, users.subcontractorId))
    .orderBy(asc(users.displayName))
  if (rows.length === 0) return []
  const grants = await db
    .select({
      userId: userPermissions.userId,
      key: userPermissions.permissionKey,
      note: userPermissions.note,
      expiresAt: userPermissions.expiresAt,
    })
    .from(userPermissions)
    .where(eq(userPermissions.isAllowed, true))
  const byUser = new Map<string, AdminUser['grants']>()
  for (const grant of grants) {
    byUser.set(grant.userId, [
      ...(byUser.get(grant.userId) ?? []),
      {
        key: grant.key,
        note: grant.note,
        expiresAt: grant.expiresAt?.toISOString() ?? null,
      },
    ])
  }
  return rows.map((row) => ({
    ...row,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    grants: byUser.get(row.id) ?? [],
  }))
}

function assertReadUsers(session: AuthSessionView): void {
  if (!session.user.grants.some((grant) => grant.key === 'admin:users')) {
    throw new ForbiddenError('Administrator access is required.')
  }
}

export interface InviteUserInput {
  email: string
  displayName: string
  username?: string
  role: Role
}

/**
 * Provider-side account creation. The random password is never returned or
 * logged; the person receives a reset link and chooses their own password.
 */
async function createProviderIdentity(input: InviteUserInput): Promise<void> {
  const config = getConfig()
  if (!config.neonAuth.baseUrl) {
    throw new ValidationError('Neon Auth is not configured; cannot invite a user.')
  }
  const password = randomBytes(32).toString('base64url')
  const signUp = await fetch(`${config.neonAuth.baseUrl}/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: config.appUrl },
    body: JSON.stringify({
      email: input.email,
      password,
      name: input.displayName,
    }),
  })
  if (!signUp.ok) {
    throw new ValidationError(
      `The identity provider rejected the invitation (${signUp.status}). The account may already exist.`,
    )
  }
}

async function requestPasswordResetEmail(email: string): Promise<void> {
  const config = getConfig()
  if (!config.neonAuth.baseUrl) throw new ValidationError('Neon Auth is not configured.')
  const reset = await fetch(`${config.neonAuth.baseUrl}/request-password-reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: config.appUrl },
    body: JSON.stringify({ email, redirectTo: `${config.appUrl}/login` }),
  })
  if (!reset.ok) {
    throw new ValidationError(`The password reset email was rejected (${reset.status}).`)
  }
}

export async function createUserRowCore(
  tx: Tx,
  input: InviteUserInput,
  session: AuthSessionView,
): Promise<{ id: string }> {
  assertAdminUsers(session)
  const email = input.email.trim().toLowerCase()
  const displayName = input.displayName.trim()
  if (!email || !displayName) throw new ValidationError('Email and display name are required.')
  if (!ROLES.includes(input.role)) throw new ValidationError('Unknown role.')
  const [existing] = await tx
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1)
  if (existing) throw new ConflictError('A user with that email already exists.')
  const [row] = await tx
    .insert(users)
    .values({
      email,
      username: input.username?.trim() || email,
      displayName,
      role: input.role,
    })
    .returning({ id: users.id })
  await tx.insert(auditLog).values({
    actorUserId: session.user.id,
    actorLabel: session.user.email,
    action: 'admin.user.create',
    entityType: 'user',
    entityId: row!.id,
    summary: `Created user ${email} with role ${input.role}.`,
    after: { email, displayName, role: input.role },
  })
  return { id: row!.id }
}

export async function inviteUserCore(
  input: InviteUserInput,
  session: AuthSessionView,
): Promise<{ id: string }> {
  assertAdminUsers(session)
  await createProviderIdentity(input)
  let created: { id: string }
  try {
    created = await getDb().transaction((tx) => createUserRowCore(tx, input, session))
  } catch (error) {
    // The provider account exists; the app row did not. Report the failure
    // rather than hiding it, and leave the row for a retry after the cause is
    // fixed.
    throw new ValidationError(
      `Identity created, but the application user was not: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  try {
    await requestPasswordResetEmail(input.email)
  } catch (error) {
    throw new ValidationError(
      `User ${input.email} was created, but the invitation email failed: ${
        error instanceof Error ? error.message : String(error)
      } Use “Force reset” after checking mail configuration.`,
    )
  }
  return created
}

export interface UpdateUserInput {
  id: string
  role?: Role
  isEnabled?: boolean
  displayName?: string
}

export async function updateUserCore(
  tx: Tx,
  input: UpdateUserInput,
  session: AuthSessionView,
): Promise<void> {
  assertAdminUsers(session)
  const [before] = await tx.select().from(users).where(eq(users.id, input.id)).limit(1)
  if (!before) throw new NotFoundError('User not found.')
  if (input.role !== undefined && !ROLES.includes(input.role)) {
    throw new ValidationError('Unknown role.')
  }
  const losesAdmin =
    before.role === 'admin' &&
    ((input.role !== undefined && input.role !== 'admin') || input.isEnabled === false)
  if (losesAdmin) {
    const [other] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.isEnabled, true), ne(users.id, input.id)))
      .limit(1)
    if (!other) throw new ValidationError('The last enabled administrator cannot be disabled or demoted.')
  }
  const changes: Partial<typeof users.$inferInsert> = { updatedAt: new Date() }
  if (input.role !== undefined) changes.role = input.role
  if (input.isEnabled !== undefined) changes.isEnabled = input.isEnabled
  if (input.displayName !== undefined) {
    const displayName = input.displayName.trim()
    if (!displayName) throw new ValidationError('Display name cannot be empty.')
    changes.displayName = displayName
  }
  await tx.update(users).set(changes).where(eq(users.id, input.id))
  await tx.insert(auditLog).values({
    actorUserId: session.user.id,
    actorLabel: session.user.email,
    action: 'admin.user.update',
    entityType: 'user',
    entityId: input.id,
    summary: `Updated user ${before.email}.`,
    before: {
      role: before.role,
      isEnabled: before.isEnabled,
      displayName: before.displayName,
    },
    after: changes as unknown as Record<string, unknown>,
  })
}

export interface GrantPermissionInput {
  userId: string
  permissionKey: string
  note?: string
  scopeSubcontractorId?: number | null
  expiresAt?: string | null
}

export async function grantPermissionCore(
  tx: Tx,
  input: GrantPermissionInput,
  session: AuthSessionView,
): Promise<void> {
  assertAdminUsers(session)
  const definition = PERMISSIONS.find((permission) => permission.key === input.permissionKey)
  if (!definition) throw new ValidationError(`Unknown permission “${input.permissionKey}”.`)
  const [user] = await tx
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1)
  if (!user) throw new NotFoundError('User not found.')
  if (input.scopeSubcontractorId !== undefined && input.scopeSubcontractorId !== null) {
    const [vendor] = await tx
      .select({ id: subcontractors.id })
      .from(subcontractors)
      .where(eq(subcontractors.id, input.scopeSubcontractorId))
      .limit(1)
    if (!vendor) throw new ValidationError('The scoped subcontractor does not exist.')
  }
  const expiresAt = input.expiresAt ? new Date(`${input.expiresAt}T23:59:59.999Z`) : null
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    throw new ValidationError('Expiry must be a valid date.')
  }
  await tx
    .insert(userPermissions)
    .values({
      userId: user.id,
      permissionKey: definition.key,
      isAllowed: true,
      expiresAt,
      scopeSubcontractorId: input.scopeSubcontractorId ?? null,
      grantedBy: session.user.id,
      note: input.note?.trim() || null,
    })
    .onConflictDoUpdate({
      target: [userPermissions.userId, userPermissions.permissionKey],
      set: {
        isAllowed: true,
        expiresAt,
        scopeSubcontractorId: input.scopeSubcontractorId ?? null,
        grantedBy: session.user.id,
        grantedAt: new Date(),
        note: input.note?.trim() || null,
      },
    })
  await tx.insert(auditLog).values({
    actorUserId: session.user.id,
    actorLabel: session.user.email,
    action: 'admin.user.grant',
    entityType: 'user',
    entityId: user.id,
    summary: `Granted ${definition.key} to ${user.email}.`,
    after: {
      permissionKey: definition.key,
      scopeSubcontractorId: input.scopeSubcontractorId ?? null,
      expiresAt: expiresAt?.toISOString() ?? null,
      note: input.note?.trim() || null,
    },
  })
}

export async function revokePermissionCore(
  tx: Tx,
  input: { userId: string; permissionKey: string },
  session: AuthSessionView,
): Promise<void> {
  assertAdminUsers(session)
  const [user] = await tx
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1)
  if (!user) throw new NotFoundError('User not found.')
  await tx
    .delete(userPermissions)
    .where(
      and(
        eq(userPermissions.userId, user.id),
        eq(userPermissions.permissionKey, input.permissionKey),
      ),
    )
  await tx.insert(auditLog).values({
    actorUserId: session.user.id,
    actorLabel: session.user.email,
    action: 'admin.user.revoke',
    entityType: 'user',
    entityId: user.id,
    summary: `Revoked ${input.permissionKey} from ${user.email}.`,
    before: { permissionKey: input.permissionKey },
  })
}

export async function forcePasswordResetCore(
  id: string,
  session: AuthSessionView,
): Promise<void> {
  assertAdminUsers(session)
  const [target] = await getDb()
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)
  if (!target) throw new NotFoundError('User not found.')
  await requestPasswordResetEmail(target.email)
  await getDb().transaction(async (tx) => {
    await tx.insert(auditLog).values({
      actorUserId: session.user.id,
      actorLabel: session.user.email,
      action: 'admin.user.force_reset',
      entityType: 'user',
      entityId: id,
      summary: `Requested a forced password reset for ${target.email}.`,
    })
  })
}

export async function listSettings(
  session: AuthSessionView,
  executor?: Executor,
): Promise<SettingRow[]> {
  assertReadSettings(session)
  return readSettings(executor ?? getDb())
}

function assertReadSettings(session: AuthSessionView): void {
  if (
    !session.user.grants.some(
      (grant) => grant.key === 'admin:settings' || grant.key === 'admin:users',
    )
  ) {
    throw new ForbiddenError('Administrator access is required.')
  }
}

async function readSettings(db: Executor | Tx): Promise<SettingRow[]> {
  const rows = await db.select().from(settings).orderBy(asc(settings.key))
  const stored = new Map(rows.map((row) => [row.key, row]))
  return SETTING_DEFINITIONS.map((definition) => {
    const row = stored.get(definition.key)
    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      module: definition.module,
      type: definition.type,
      value: (row?.value as string | number | boolean | undefined) ?? definition.defaultValue,
      isDefault: !row,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    }
  })
}

export async function saveSettingCore(
  tx: Tx,
  input: { key: string; value: unknown },
  session: AuthSessionView,
): Promise<SettingRow[]> {
  assertAdminSettings(session)
  const definition = settingDefinition(input.key)
  if (!definition) throw new ValidationError(`Unknown setting “${input.key}”.`)
  let value: string | number | boolean
  try {
    value = parseSettingValue(definition, input.value)
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : String(error))
  }
  const [before] = await tx.select().from(settings).where(eq(settings.key, input.key)).limit(1)
  await tx
    .insert(settings)
    .values({
      key: input.key,
      valueType: definition.type,
      value,
      updatedBy: session.user.id,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, valueType: definition.type, updatedBy: session.user.id, updatedAt: new Date() },
    })
  await tx.insert(auditLog).values({
    actorUserId: session.user.id,
    actorLabel: session.user.email,
    action: 'admin.settings.update',
    entityType: 'setting',
    entityId: input.key,
    summary: `Changed ${definition.label}.`,
    before: before ? { value: before.value } : null,
    after: { value },
  })
  return readSettings(tx)
}

export async function listAudit(
  session: AuthSessionView,
  input: AuditFilter = {},
  executor?: Executor,
): Promise<{ rows: AuditRowView[]; total: number; actions: string[] }> {
  if (!session.user.grants.some((grant) => grant.key === 'admin:audit')) {
    throw new ForbiddenError('Administrator access is required.')
  }
  const db = executor ?? getDb()
  const page = Math.max(1, input.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, input.pageSize ?? 100))
  const conditions: SQL[] = []
  if (input.actor) {
    conditions.push(
      or(
        ilike(auditLog.actorLabel, `%${input.actor}%`),
        sql`${auditLog.actorUserId}::text ilike ${`%${input.actor}%`}`,
      )!,
    )
  }
  if (input.action) conditions.push(ilike(auditLog.action, `%${input.action}%`))
  if (input.entityType) conditions.push(eq(auditLog.entityType, input.entityType))
  if (input.entityId) conditions.push(eq(auditLog.entityId, input.entityId))
  if (input.from) conditions.push(gte(auditLog.createdAt, new Date(`${input.from}T00:00:00`)))
  if (input.to) conditions.push(lte(auditLog.createdAt, new Date(`${input.to}T23:59:59.999`)))
  const where = conditions.length ? and(...conditions) : undefined
  const [rows, total, actions] = await Promise.all([
    db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        actor: sql<string>`coalesce(${auditLog.actorLabel}, ${users.displayName}, 'System')`,
        actorEmail: users.email,
        summary: auditLog.summary,
        createdAt: auditLog.createdAt,
        ip: auditLog.ip,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(auditLog).where(where),
    db
      .select({ action: auditLog.action })
      .from(auditLog)
      .groupBy(auditLog.action)
      .orderBy(asc(auditLog.action))
      .limit(300),
  ])
  return {
    rows: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    total: total[0]?.count ?? 0,
    actions: actions.map((row) => row.action),
  }
}

export async function listDefaultGrants(
  executor?: Executor,
): Promise<{ role: Role; permissionKey: string }[]> {
  const db = executor ?? getDb()
  return db
    .select({ role: rolePermissions.role, permissionKey: rolePermissions.permissionKey })
    .from(rolePermissions)
    .orderBy(asc(rolePermissions.role), asc(rolePermissions.permissionKey))
}

export function permissionCatalogue() {
  return PERMISSIONS
}
