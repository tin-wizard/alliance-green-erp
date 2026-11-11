import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { app } from './app/base'

/**
 * Application schema (`app`). Everything the rebuild owns lives here, separate
 * from the legacy mirror in `public` so migration parity and new behaviour
 * never fight over a table name.
 *
 * Identity is split three ways:
 *  - credentials and provider sessions: Neon Auth (`neon_auth` schema);
 *  - application profile, role and enablement: `app.users`;
 *  - granular authorization and audit: the tables below.
 */
export { app }

// Module slices. Each module owns one file; this index only re-exports.
export * from './app/workorder'

export const userRoleEnum = app.enum('user_role', [
  'admin',
  'technician',
  'subcontractor',
  'supplier',
])

export const users = app.table(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Neon Auth `sub`. Null until an invited user signs in for the first time. */
    neonUserId: text('neon_user_id'),
    email: text('email').notNull(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    /** Legacy `users.phone` / `users.email2` profile fields, kept for migration parity. */
    phone: text('phone'),
    secondaryEmail: text('secondary_email'),
    /** Legacy `users.department_type` label (free text). */
    departmentType: text('department_type'),
    role: userRoleEnum('role').notNull().default('technician'),
    /** Legacy `users.access` (1-9). Kept for reconciliation; never used for auth. */
    legacyAccess: smallint('legacy_access'),
    /** Legacy `users.subid` -> Sage `tvendor.lId`, for subcontractor accounts. */
    subcontractorId: integer('subcontractor_id'),
    /** Legacy `users.id` for row-by-row migration mapping. */
    legacyId: integer('legacy_id'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_email_unique').on(sql`lower(${table.email})`),
    uniqueIndex('users_username_unique').on(sql`lower(${table.username})`),
    uniqueIndex('users_legacy_id_unique').on(table.legacyId),
    uniqueIndex('users_neon_user_id_unique').on(table.neonUserId),
    index('users_role_idx').on(table.role),
  ],
)

export const permissionDefinitions = app.table(
  'permission_definitions',
  {
    key: text('key').primaryKey(),
    module: text('module').notNull(),
    label: text('label').notNull(),
    description: text('description').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('permission_definitions_module_idx').on(table.module)],
)

export const rolePermissions = app.table(
  'role_permissions',
  {
    role: userRoleEnum('role').notNull(),
    permissionKey: text('permission_key').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.role, table.permissionKey] }),
    index('role_permissions_key_idx').on(table.permissionKey),
  ],
)

export const userPermissions = app.table(
  'user_permissions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permissionKey: text('permission_key').notNull(),
    isAllowed: boolean('is_allowed').notNull().default(true),
    /** NULL means the grant never expires (legacy `permission_date IS NULL`). */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /**
     * Scope for the WSIB override: the Sage vendor id of the subcontractor.
     * NULL for ordinary grants.
     */
    scopeSubcontractorId: integer('scope_subcontractor_id'),
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    note: text('note'),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.permissionKey] }),
    index('user_permissions_key_idx').on(table.permissionKey),
  ],
)

export const auditLog = app.table(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorLabel: text('actor_label'),
    actorRole: text('actor_role'),
    /** Stable event name, e.g. `auth.login`, `workorder.update`. */
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    summary: text('summary'),
    before: jsonb('before').$type<Record<string, unknown> | null>(),
    after: jsonb('after').$type<Record<string, unknown> | null>(),
    /** Correlation id for a request; generated per request by the server. */
    requestId: text('request_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_entity_idx').on(table.entityType, table.entityId),
    index('audit_log_actor_idx').on(table.actorUserId),
    index('audit_log_action_idx').on(table.action),
    index('audit_log_created_at_idx').on(table.createdAt),
  ],
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type UserPermission = typeof userPermissions.$inferSelect
export type AuditLogRow = typeof auditLog.$inferSelect
export type NewAuditLogRow = typeof auditLog.$inferInsert
