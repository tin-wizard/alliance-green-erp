/**
 * Group 3 — identity (plan §2.5 step 3, §6).
 *
 * `app.users` is the profile/role/enablement row; credentials belong to Neon Auth
 * and are never migrated. This transformer therefore never touches `password`,
 * `mailing_password` or `cls_mailing_password` — not "reads and discards", but
 * never names the columns at all, so a dump cannot leak an MD5 into Neon even by
 * accident.
 *
 * Decisions worth knowing:
 *
 *  - The natural key is `legacy_id`. A username clash (case-insensitive) is two
 *    legacy accounts competing for one login: the first row is kept and the second
 *    becomes a `duplicate_username` exception, never a second row that the unique
 *    index would reject at the end of the run.
 *  - `users.email` is NOT NULL and unique (lower). A blank address cannot stay
 *    blank, and inventing a deliverable address would be worse than a placeholder:
 *    `user-<legacyId>@legacy.invalid` is reserved-domain, undeliverable and
 *    obviously synthetic, and the row is recorded as `no_email` for the office to
 *    resolve by phone (§6.3). A second account sharing a real address gets the same
 *    placeholder for the same reason; the invitation planner ranks those accounts
 *    in its `shared-email` cohort.
 *  - Disabled accounts are migrated disabled: no credential, no invite, history
 *    kept (§6.3).
 *  - `subid` is a legacy `subcontractor.id`, so the vendor link is a lookup, never
 *    a guess. A missing vendor row is an exception, not a fake vendor.
 *  - The invitation queue (`migration.user_invites`) belongs to
 *    `scripts/import/users.ts`; this transformer does not write it, so the two
 *    cannot disagree about a cohort.
 */
import { eq, sql } from 'drizzle-orm'
import type { Tx } from '@cls/db'
import { ALL_PERMISSIONS } from '@cls/core'
import { subcontractors, suppliers, userPermissions, users } from '@cls/db/schema'
import type { GroupTransformer, TransformContext, TransformHelpers } from '../types'
import { normaliseEmail } from '../users'

const GROUP = 'identity'

type UserRole = 'admin' | 'technician' | 'subcontractor' | 'supplier'

/** `inventory:edit_price` replaces the legacy price-editor grant table (§5). */
const PRICE_MANAGEMENT_PERMISSION = 'inventory:edit_price'

const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set<string>(ALL_PERMISSIONS)

/**
 * The legacy `user_permissions.permission_name` vocabulary predates the app's
 * `<domain>:<action>` keys. The legacy `permission_type` lookup is empty in the
 * recovered snapshot, so the equivalence is stated here, once, from the names
 * the dump actually carries; a name outside this map is still reported and
 * never guessed at.
 */
const LEGACY_PERMISSION_KEYS: Readonly<Record<string, string>> = {
  'workorders.view': 'workorder:read',
  'workorders.edit': 'workorder:write',
  'quotes.edit': 'quote:write',
  'purchasing.approve': 'purchasing:approve',
  'reports.view': 'reports:read',
  'users.admin': 'admin:users',
}

function intOf(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? parsed : null
}

/** `YYYY-MM-DD` is a calendar date; midnight UTC keeps the digits unchanged. */
function midnightUtc(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00.000Z`)
}

function requiredId(context: TransformContext): number {
  const id = context.helpers.int('id')
  if (id === null) {
    throw new Error(`${context.table}.id is not an integer: ${JSON.stringify(context.row.id)}`)
  }
  return id
}

/**
 * The legacy `subcontractor.id` behind `users.subid`. Direct hit first (the target
 * keeps the legacy id), then the crosswalk in case group 2 renumbered.
 */
async function resolveSubcontractor(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<number | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('subcontractor', 'subcontractor', String(legacyId))
  const candidate = intOf(mapped) ?? legacyId
  const [row] = await tx
    .select({ id: subcontractors.id })
    .from(subcontractors)
    .where(eq(subcontractors.id, candidate))
    .limit(1)
  return row?.id ?? null
}

/** The user crosswalk, then `legacy_id`; a grant never attaches to a guess. */
async function resolveUser(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<string | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('user', 'users', String(legacyId))
  if (mapped !== null) {
    const [row] = await tx.select({ id: users.id }).from(users).where(eq(users.id, mapped)).limit(1)
    return row?.id ?? null
  }
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.legacyId, legacyId))
    .limit(1)
  return row?.id ?? null
}

/**
 * `suppliers.user_id` is the supplier portal identity for this legacy user. It is
 * read from staging because the forward `app.suppliers` column stores a uuid that
 * only exists once this row is created.
 */
async function supplierForUser(tx: Tx, dumpId: string, legacyId: number): Promise<number | null> {
  const rows = (await tx.execute(sql`
    select "id" as id
    from migration."stg_suppliers"
    where "_dump_id" = ${dumpId} and "user_id" = ${String(legacyId)}
    order by "_row_no"
    limit 1
  `)) as unknown as Array<{ id: string | null }>
  return intOf(rows[0]?.id)
}

/**
 * Role, in the order that keeps authorization honest: the legacy numeric level is
 * what gated the admin pages (`access > 5`), so it wins. Only then does an explicit
 * portal link decide between supplier and subcontractor.
 */
function roleFor(
  access: number | null,
  supplierId: number | null,
  subcontractorId: number | null,
): UserRole {
  if ((access ?? 0) >= 6) return 'admin'
  if (supplierId !== null) return 'supplier'
  if (subcontractorId !== null) return 'subcontractor'
  return 'technician'
}

async function transformUser(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey, dumpId, row } = context
  const legacyId = requiredId(context)

  const username = helpers.text('username') ?? `user-${legacyId}`
  const displayName = helpers.text('full_name') ?? helpers.text('username') ?? `User ${legacyId}`

  // Duplicate username: keep the row that arrives first. The check is by lower(),
  // exactly like `users_username_unique`, so a case-only clash cannot slip through
  // and abort the table with a raw index error.
  const [clash] = await tx
    .select({ legacyId: users.legacyId })
    .from(users)
    .where(sql`lower(${users.username}) = ${username.toLowerCase()}`)
    .limit(1)
  if (clash && clash.legacyId !== legacyId) {
    await helpers.exception({
      exceptionClass: 'duplicate_username',
      entity: 'user',
      sourceKey,
      action: 'account not created: the first row with this username is kept',
      notes: `username = ${JSON.stringify(username)}; kept legacy id ${String(clash.legacyId)}`,
    })
    return
  }

  const email = normaliseEmail(helpers.text('email'))
  let storedEmail: string
  if (email === null) {
    // NOT NULL and no deliverable alternative: a reserved-domain placeholder keeps
    // the profile and is never mailed to. The office resolves identity by phone.
    storedEmail = `user-${legacyId}@legacy.invalid`
    await helpers.exception({
      exceptionClass: 'no_email',
      entity: 'user',
      sourceKey,
      action: 'placeholder address stored; no invitation can be sent',
      notes:
        'users.email is NOT NULL; office verifies identity by phone and issues a one-time code',
    })
  } else {
    const [mailClash] = await tx
      .select({ legacyId: users.legacyId })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1)
    if (mailClash && mailClash.legacyId !== legacyId) {
      // One address cannot belong to two accounts. The profile is kept with the
      // same kind of placeholder; the invitation planner owns the `shared-email`
      // cohort and the office picks one named account per person.
      storedEmail = `user-${legacyId}@legacy.invalid`
      await helpers.exception({
        exceptionClass: 'no_email',
        entity: 'user',
        sourceKey,
        action: 'shared address replaced by a placeholder; onboarding is office-assisted',
        notes: `email is already used by legacy id ${String(mailClash.legacyId)}`,
      })
    } else {
      storedEmail = email
    }
  }

  const subid = helpers.int('subid')
  const subcontractorId = await resolveSubcontractor(tx, helpers, subid)
  if (subid !== null && subcontractorId === null) {
    await helpers.exception({
      exceptionClass: 'subcontractor_without_vendor',
      entity: 'user',
      sourceKey,
      action: 'account kept with subcontractor_id = NULL and not invited until a vendor row exists',
      notes: `subid = ${String(subid)} has no app.subcontractors row`,
    })
  }

  const supplierId = await supplierForUser(tx, dumpId, legacyId)
  const access = helpers.int('access')
  const isEnabled = helpers.flag('is_enabled') !== 0

  const values = {
    email: storedEmail,
    username,
    displayName,
    role: roleFor(access, supplierId, subcontractorId),
    legacyAccess: access,
    subcontractorId,
    isEnabled,
    phone: helpers.text('phone'),
    secondaryEmail: helpers.text('email2'),
    departmentType: helpers.text('department_type'),
  }

  if (!isEnabled) {
    await helpers.exception({
      exceptionClass: 'disabled_user',
      entity: 'user',
      sourceKey,
      action: 'migrated disabled: no credential, no invite, history retained',
      notes: `is_enabled = ${JSON.stringify(row.is_enabled)}`,
    })
  }

  const [saved] = await tx
    .insert(users)
    .values({ legacyId, ...values })
    .onConflictDoUpdate({
      target: users.legacyId,
      set: { ...values, updatedAt: new Date() },
    })
    .returning({ id: users.id })
  const userId = saved!.id

  if (supplierId !== null) {
    // The supplier was written by group 2 with a NULL portal user because this uuid
    // did not exist yet; this is the only place the two identities can meet.
    await tx
      .update(suppliers)
      .set({ userId, updatedAt: new Date() })
      .where(eq(suppliers.id, supplierId))
  }

  await helpers.remember({
    entity: 'user',
    sourceTable: context.table,
    sourceKey,
    targetTable: 'users',
    targetKey: userId,
  })
}

interface GrantValues {
  userId: string
  permissionKey: string
  isAllowed: boolean
  expiresAt: Date | null
  grantedBy: string | null
  note: string
}

async function upsertGrant(context: TransformContext, values: GrantValues): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const { userId, permissionKey, ...rest } = values
  await tx
    .insert(userPermissions)
    .values({ userId, permissionKey, ...rest })
    .onConflictDoUpdate({
      target: [userPermissions.userId, userPermissions.permissionKey],
      set: rest,
    })
  await helpers.remember({
    entity: 'user_permission',
    sourceTable: context.table,
    sourceKey,
    targetTable: 'user_permissions',
    targetKey: `${userId}:${permissionKey}`,
  })
}

async function transformUserPermission(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const userId = await resolveUser(tx, helpers, helpers.int('user_id'))
  if (userId === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity: 'user_permission',
      sourceKey,
      action: 'grant not inserted: no app.users row for user_id',
      notes: `user_id = ${JSON.stringify(context.row.user_id)}`,
    })
    return
  }

  const permissionName = helpers.text('permission_name')
  const permissionKey =
    permissionName === null ? null : (LEGACY_PERMISSION_KEYS[permissionName] ?? permissionName)
  if (permissionKey === null || !KNOWN_PERMISSIONS.has(permissionKey)) {
    // A grant to a permission the app does not define would be dead weight that
    // looks like a grant; it is reported instead of stored.
    await helpers.exception({
      exceptionClass: 'unknown_enum',
      entity: 'user_permission',
      sourceKey,
      action: 'grant not inserted: the permission key is not in the app registry',
      notes: `permission_name = ${JSON.stringify(permissionName)}; app key = ${JSON.stringify(permissionKey)}`,
    })
    return
  }

  await upsertGrant(context, {
    userId,
    permissionKey,
    // Presence of a row was the legacy grant; `is_allowed` could only narrow it.
    isAllowed: helpers.flag('is_allowed') !== 0,
    // The schema documents `permission_date` as the expiry, where NULL never expires.
    expiresAt: midnightUtc(helpers.date('permission_date')),
    grantedBy: null,
    note: `legacy user_permissions.id = ${JSON.stringify(context.row.id)}; permission_name = ${JSON.stringify(permissionName)}`,
  })
}

async function transformPriceManagementPermission(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const userId = await resolveUser(tx, helpers, helpers.int('user_id'))
  if (userId === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity: 'user_permission_price',
      sourceKey,
      action: 'grant not inserted: no app.users row for user_id',
      notes: `user_id = ${JSON.stringify(context.row.user_id)}`,
    })
    return
  }

  await upsertGrant(context, {
    userId,
    permissionKey: PRICE_MANAGEMENT_PERMISSION,
    // The table's existence was the grant (§5 replaces it with one permission key).
    isAllowed: true,
    expiresAt: midnightUtc(helpers.date('permission_date')),
    grantedBy: await resolveUser(tx, helpers, helpers.int('allowed_by')),
    note: `legacy user_permissions_price_management.id = ${JSON.stringify(context.row.id)}`,
  })
}

export const transformer: GroupTransformer = {
  group: GROUP,

  async transform(context) {
    switch (context.table) {
      case 'users':
        return transformUser(context)
      case 'user_permissions':
        return transformUserPermission(context)
      case 'user_permissions_price_management':
        return transformPriceManagementPermission(context)
      default:
        throw new Error(`${GROUP}: no mapping for table ${context.table}`)
    }
  },

  unmapped: {
    'users.password':
      'never read: credentials belong to Neon Auth, and a legacy MD5 is never copied into the app (§6.1)',
    'users.mailing_password':
      'legacy SMTP credential, not identity; the notification service owns one configured sender (§6.4)',
    'users.cls_mailing_user': 'legacy SMTP credential user; not identity, not migrated (§6.4)',
    'users.cls_mailing_password': 'legacy SMTP credential; not identity, not migrated (§6.4)',
    'users.mailing_user':
      'legacy per-user SMTP sender identity; replaced by the notification service',
    'users.phone2': 'second phone number with no forward column; stays in staging (schema gap)',
    'users.phone2_ext': 'extension of `phone2`, which has no forward column',
    'users.user_addworkorder_without_wsib':
      'legacy per-user WSIB bypass; replaced by the scoped permission `workorder:override_wsib_hold`',
    'user_permissions.permission_date':
      'mapped to expires_at where it is an expiry; no separate grant date is stored',
    'user_permissions_price_management.allowed_by':
      'mapped to granted_by when that legacy user was migrated; NULL otherwise',
  },

  parity: [
    {
      group: GROUP,
      label: 'users (one per username; duplicates are quarantined, not duplicated)',
      oldSql: `select count(distinct lower(btrim("username")))::int as value
        from migration."stg_users" where btrim("username") <> ''`,
      newSql: `select count(*)::int as value
from app.users u
join migration.row_map r
  on r.entity = 'user' and r.target_table = 'users' and r.target_key = u.id::text
where u.legacy_id is not null`,
    },
    {
      group: GROUP,
      label: 'disabled users',
      oldSql: `select count(*)::int as value from migration."stg_users" where "is_enabled" = '0'`,
      newSql: 'select count(*)::int as value from app.users where is_enabled = false',
    },
    {
      group: GROUP,
      label: 'duplicate usernames',
      oldSql: `select coalesce(sum(n - 1), 0)::int as value
from (
  select count(*) as n
  from migration."stg_users"
  group by lower("username")
  having count(*) > 1
) duplicates`,
      newSql: `select count(*)::int as value from migration.exceptions
where exception_class = 'duplicate_username' and entity = 'user'`,
    },
    {
      group: GROUP,
      label: 'user permission grants (named + price management)',
      // The policy promises one app grant per legacy grant whose user was
      // migrated and whose name maps to an app key. A grant on the quarantined
      // duplicate account (duplicate_username) or on a NULL user (orphan_line)
      // is not a grant the app can hold.
      oldSql: `with kept_users as (
  select u.id::int as id
  from migration."stg_users" u
  where u."_row_no" = (
    select min(x."_row_no")
    from migration."stg_users" x
    where lower(coalesce(nullif(btrim(x."username"), ''), 'user-' || x.id)) =
          lower(coalesce(nullif(btrim(u."username"), ''), 'user-' || u.id))
  )
)
select
  (select count(*) from migration."stg_user_permissions" p
    where p."permission_name" in
      ('workorders.view', 'workorders.edit', 'quotes.edit',
       'purchasing.approve', 'reports.view', 'users.admin')
      and p."user_id" ~ '^[0-9]+$'
      and p."user_id"::int in (select id from kept_users))
  + (select count(*) from migration."stg_user_permissions_price_management" p
    where p."user_id" ~ '^[0-9]+$'
      and p."user_id"::int in (select id from kept_users)) as value`,
      newSql: `select count(distinct p.user_id::text || ':' || p.permission_key)::int as value
from app.user_permissions p
join migration.row_map r
  on r.entity = 'user_permission'
 and r.source_table in ('user_permissions', 'user_permissions_price_management')
 and r.target_table = 'user_permissions'
 and r.target_key = p.user_id::text || ':' || p.permission_key`,
    },
  ],
}
