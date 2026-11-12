/**
 * Group 2 — parties (plan §2.5 step 2).
 *
 * Five tables get a forward row and two do not:
 *
 *  - `customer` and `sites` share one id space (Sage `tcustomr.lId`), so both keep
 *    their legacy id as the primary key and `sage_*_id` records the link. A site
 *    whose `custid` has no customer stays valid with `customer_id = NULL` and one
 *    `orphan_site_customer` exception; no parent is invented (1,086 measured).
 *  - `subcontractor` has no Sage id column in the dump at all, so
 *    `sage_subcontractor_id` is left for reconciliation to fill.
 *  - `suppliers.user_id` points at a legacy user, and users are group 3. The
 *    supplier row is written with `user_id = NULL`; the identity transformer
 *    back-links it when it creates the user, because a uuid cannot be guessed
 *    before the user exists.
 *  - `customer_emails` and `site_address_change_log` have no forward table. They
 *    are recorded once per table as `not_migrated` and crosswalked to the mirror
 *    row that still holds them, so "kept in staging" is a decision with a reason.
 */
import { eq } from 'drizzle-orm'
import type { Tx } from '@cls/db'
import { customers, subcontractorContacts, subcontractors, suppliers, sites } from '@cls/db/schema'
import type { GroupTransformer, TransformContext, TransformHelpers } from '../types'

const GROUP = 'parties'

/** The manifest entity name, used for row_map and exception rows. */
function entityFor(table: string): string {
  switch (table) {
    case 'customer':
      return 'customer'
    case 'sites':
      return 'site'
    case 'subcontractor':
      return 'subcontractor'
    case 'subcontractor_contact_info':
      return 'subcontractor_contact'
    case 'suppliers':
      return 'supplier'
    case 'customer_emails':
      return 'customer_email'
    case 'site_address_change_log':
      return 'site_address_change'
    default:
      throw new Error(`${GROUP}: no mapping for table ${table}`)
  }
}

function intOf(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The natural key is the legacy id, which *is* the Sage id for both customers and
 * sites. A non-numeric id is a loader defect, so it fails the row instead of
 * producing a null-keyed record.
 */
function requiredId(context: TransformContext): number {
  const id = context.helpers.int('id')
  if (id === null) {
    throw new Error(`${context.table}.id is not an integer: ${JSON.stringify(context.row.id)}`)
  }
  return id
}

/**
 * The customer crosswalk first, then the target id. `app.customers.id` is the
 * legacy `customer.id`, so the direct hit is the normal path.
 */
async function resolveCustomer(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<number | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('customer', 'customer', String(legacyId))
  const candidate = intOf(mapped) ?? legacyId
  const [row] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.id, candidate))
    .limit(1)
  return row?.id ?? null
}

/**
 * A row the forward model has no table for. It is counted once per table (the
 * class is a policy skip, not a defect) and every row is still crosswalked to the
 * mirror row that holds it.
 */
async function keepInMirror(context: TransformContext, reason: string): Promise<void> {
  const { helpers, sourceKey } = context
  const entity = entityFor(context.table)
  await helpers.exception({
    exceptionClass: 'not_migrated',
    entity,
    sourceKey: context.table,
    action: 'kept in the read-only legacy mirror only; no app table exists',
    notes: reason,
  })
  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: `public.${context.table}`,
    targetKey: sourceKey,
  })
}

async function transformCustomer(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const id = requiredId(context)
  // `name` is NOT NULL in `app`; a nameless legacy row keeps a deterministic label
  // so its sites do not lose their billing parent.
  const name = helpers.text('name') ?? `Customer ${id}`
  const row = {
    // Legacy `customer.id` must equal the Sage `tcustomr.lId`, so the id is both
    // the primary key and the Sage link; neither is generated or renumbered.
    sageCustomerId: id,
    name,
    street: helpers.text('street'),
    city: helpers.text('city'),
    province: helpers.text('province'),
    postalCode: helpers.text('postalcode'),
    contactName: helpers.text('cname'),
    contactNumber: helpers.text('cnumber'),
    contactEmail: helpers.text('cemail1'),
    salesperson: helpers.text('salesp'),
  }

  await tx
    .insert(customers)
    .values({ id, ...row })
    .onConflictDoUpdate({
      target: customers.id,
      // `is_active` is app-owned: a rerun must not undo a deactivation.
      set: { ...row, updatedAt: new Date() },
    })

  await helpers.remember({
    entity: 'customer',
    sourceTable: context.table,
    sourceKey,
    targetTable: 'customers',
    targetKey: String(id),
  })
}

async function transformSite(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const id = requiredId(context)
  const custId = helpers.int('custid')
  let customerId: number | null = null

  if (custId !== null) {
    customerId = await resolveCustomer(tx, helpers, custId)
    if (customerId === null) {
      // Measured: 1,086 sites bill to a customer that was never imported. The site
      // stays selectable; no fake customer row is created.
      await helpers.exception({
        exceptionClass: 'orphan_site_customer',
        entity: 'site',
        sourceKey,
        action: 'site kept with customer_id = NULL; list and detail show "No billing customer"',
        notes: `custid = ${String(custId)} has no app.customers row`,
      })
    }
  } else {
    await helpers.exception({
      exceptionClass: 'orphan_site_customer',
      entity: 'site',
      sourceKey,
      action: 'site kept with customer_id = NULL',
      notes: `custid = ${JSON.stringify(context.row.custid)}`,
    })
  }

  const row = {
    sageSiteId: id,
    customerId,
    name: helpers.text('name') ?? `Site ${id}`,
    street: helpers.text('street'),
    street2: helpers.text('street_2'),
    city: helpers.text('city'),
    province: helpers.text('province'),
    postalCode: helpers.text('postalcode'),
    contactName: helpers.text('cname'),
    contactNumber: helpers.text('cnumber'),
    warranty: helpers.flag('warranty') === 1,
    warrantyExpiresOn: helpers.date('warranty_exp'),
    warrantyNotes: helpers.text('warranty_notes'),
    notes: helpers.text('notes'),
    // Free-text legacy labels, preserved verbatim (including `lift = '0'`).
    dns: helpers.text('dns'),
    lift: helpers.text('lift'),
    mall: helpers.text('mall'),
  }

  await tx
    .insert(sites)
    .values({ id, ...row })
    .onConflictDoUpdate({ target: sites.id, set: { ...row, updatedAt: new Date() } })

  await helpers.remember({
    entity: 'site',
    sourceTable: context.table,
    sourceKey,
    targetTable: 'sites',
    targetKey: String(id),
  })
}

async function transformSubcontractor(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const id = requiredId(context)
  const row = {
    // The dump has no `subid`/Sage column for a vendor: the link is filled by the
    // Sage reconciliation import, never guessed from the local id.
    sageSubcontractorId: null,
    name: helpers.text('name') ?? `Subcontractor ${id}`,
    street: helpers.text('street'),
    city: helpers.text('city'),
    province: helpers.text('province'),
    postalCode: helpers.text('postalcode'),
    contactName: helpers.text('cname'),
    contactNumber: helpers.text('cnumber'),
    contactEmail: helpers.text('cemail1'),
    email2: helpers.text('cemail2'),
    email3: helpers.text('cemail3'),
    // Labour rates are decimal in the dump, but the parse is shared with money so
    // ''.  and junk follow the same rule: NULL, never 0.
    rateInterior: helpers.money('interior'),
    rateExterior: helpers.money('exterior'),
    rateOther: helpers.money('other'),
    stockNotificationAlertType: helpers.int('stock_notification_alert_type'),
  }

  await tx
    .insert(subcontractors)
    .values({ id, ...row })
    .onConflictDoUpdate({ target: subcontractors.id, set: { ...row, updatedAt: new Date() } })

  await helpers.remember({
    entity: 'subcontractor',
    sourceTable: context.table,
    sourceKey,
    targetTable: 'subcontractors',
    targetKey: String(id),
  })
}

async function transformSubcontractorContact(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const subid = helpers.int('subid')
  let subcontractorId: number | null = null
  if (subid !== null) {
    const mapped = await helpers.targetKey('subcontractor', 'subcontractor', String(subid))
    subcontractorId = intOf(mapped) ?? subid
    const [parent] = await tx
      .select({ id: subcontractors.id })
      .from(subcontractors)
      .where(eq(subcontractors.id, subcontractorId))
      .limit(1)
    if (!parent) subcontractorId = null
  }

  if (subcontractorId === null) {
    // `subcontractor_id` is NOT NULL and FK-bound: an unresolvable parent means
    // the contact cannot be attached anywhere without inventing a vendor.
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity: 'subcontractor_contact',
      sourceKey,
      action: 'row not inserted: no app.subcontractors row for subid',
      notes: `subid = ${JSON.stringify(context.row.subid)}`,
    })
    return
  }

  const values = {
    subcontractorId,
    contactName: helpers.text('contact_name'),
    phone: helpers.text('phone'),
    phoneExt: helpers.text('phone_ext'),
  }

  // The target id is a uuid, so idempotency comes from the crosswalk rather than
  // from an upsert key.
  const existing = await helpers.targetKey('subcontractor_contact', context.table, sourceKey)
  let targetKey = existing
  if (existing === null) {
    const [inserted] = await tx
      .insert(subcontractorContacts)
      .values(values)
      .returning({ id: subcontractorContacts.id })
    targetKey = inserted!.id
  } else {
    await tx.update(subcontractorContacts).set(values).where(eq(subcontractorContacts.id, existing))
  }

  await helpers.remember({
    entity: 'subcontractor_contact',
    sourceTable: context.table,
    sourceKey,
    targetTable: 'subcontractor_contacts',
    targetKey: targetKey!,
  })
}

async function transformSupplier(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const id = requiredId(context)
  const sageVendorId = helpers.int('sage_vendor_id')

  if (sageVendorId !== null) {
    // `sage_vendor_id` is unique in `app`. Two legacy suppliers claiming one vendor
    // is a master-data conflict a human must settle, so the row fails loudly
    // instead of one of them silently losing its Sage link.
    const [owner] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.sageVendorId, sageVendorId))
      .limit(1)
    if (owner && owner.id !== id) {
      throw new Error(
        `suppliers.sage_vendor_id ${sageVendorId} already belongs to supplier ${owner.id}, not ${id}`,
      )
    }
  }

  const row = {
    sageVendorId,
    name: helpers.text('name') ?? `Supplier ${id}`,
    address: helpers.text('address'),
    city: helpers.text('city'),
    province: helpers.text('province'),
    postalCode: helpers.text('postalcode'),
    contactPerson: helpers.text('contact_person'),
    contactNumber: helpers.text('contact_number'),
    additionalEmails: helpers.text('additional_emails'),
    additionalEmailsAccounting: helpers.text('additional_emails_accounting'),
    isUnderCls: helpers.flag('is_under_cls') === 1,
    isOnlineVendor: helpers.flag('is_online_vendor') === 1,
    bypassPoApproval: helpers.flag('bypass_po_approval') === 1,
    poNotes: helpers.text('popnotes'),
  }

  await tx
    .insert(suppliers)
    .values({ id, ...row })
    .onConflictDoUpdate({ target: suppliers.id, set: { ...row, updatedAt: new Date() } })

  // `users.user_id` is deliberately not written here: the portal identity is an
  // `app.users` uuid and users are group 3. Group 3 back-links it.
  await helpers.remember({
    entity: 'supplier',
    sourceTable: context.table,
    sourceKey,
    targetTable: 'suppliers',
    targetKey: String(id),
  })
}

async function transformCustomerEmail(context: TransformContext): Promise<void> {
  await keepInMirror(
    context,
    'legacy generic e-mail list with no customer key; the forward model keeps one contact e-mail on app.customers',
  )
}

async function transformSiteAddressChange(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const siteId = helpers.int('site_id')
  if (siteId !== null) {
    const [site] = await tx
      .select({ id: sites.id })
      .from(sites)
      .where(eq(sites.id, siteId))
      .limit(1)
    if (!site) {
      await helpers.exception({
        exceptionClass: 'orphan_line',
        entity: 'site_address_change',
        sourceKey,
        action: 'address-drift log row kept in the mirror; its site was not migrated',
        notes: `site_id = ${String(siteId)}`,
      })
    }
  }
  await keepInMirror(
    context,
    'cron-detected Sage-vs-portal address drift; audit history with no forward table, address changes after cutover go to app.audit_log',
  )
}

export const transformer: GroupTransformer = {
  group: GROUP,

  async transform(context) {
    switch (context.table) {
      case 'customer':
        return transformCustomer(context)
      case 'sites':
        return transformSite(context)
      case 'subcontractor':
        return transformSubcontractor(context)
      case 'subcontractor_contact_info':
        return transformSubcontractorContact(context)
      case 'suppliers':
        return transformSupplier(context)
      case 'customer_emails':
        return transformCustomerEmail(context)
      case 'site_address_change_log':
        return transformSiteAddressChange(context)
      default:
        throw new Error(`${GROUP}: no mapping for table ${context.table}`)
    }
  },

  unmapped: {
    'customer.name':
      'NOT NULL in app; a blank legacy name becomes `Customer <id>` so its sites keep a billing parent',
    'sites.name': 'NOT NULL in app; a blank legacy name becomes `Site <id>`',
    'subcontractor.name': 'NOT NULL in app; a blank legacy name becomes `Subcontractor <id>`',
    'subcontractor.sage_subcontractor_id':
      'no `subid` column exists in legacy `subcontractor`; the Sage vendor link is left NULL for reconciliation to fill (schema gap)',
    'suppliers.name': 'NOT NULL in app; a blank legacy name becomes `Supplier <id>`',
    'suppliers.user_id':
      'written by group 3 (identity) as an app.users uuid, because no user exists yet at group 2',
    'customer_emails.*':
      'generic e-mail list with no customer key; no forward table, rows stay in the mirror (not_migrated)',
    'site_address_change_log.*':
      'address-drift audit history; no forward table, rows stay in the mirror (not_migrated)',
  },

  parity: [
    {
      group: GROUP,
      label: 'customers',
      oldSql: 'select count(*)::int as value from migration."stg_customer"',
      newSql: 'select count(*)::int as value from app.customers where id > 0',
    },
    {
      group: GROUP,
      label: 'sites',
      oldSql: 'select count(*)::int as value from migration."stg_sites"',
      // Read this import's sites through the crosswalk: a rehearsal reset cannot
      // always delete an earlier run's parent rows, and a delta over the whole
      // table would silently deduct them.
      newSql: `select count(*)::int as value
from app.sites s
join migration.row_map r
  on r.entity = 'site' and r.target_table = 'sites' and r.target_key = s.id::text`,
    },
    {
      group: GROUP,
      label: 'sites without a billing customer',
      oldSql: `select count(*)::int as value
from migration."stg_sites" s
where not exists (select 1 from migration."stg_customer" c where c."id" = s."custid")`,
      newSql: `select count(*)::int as value
from app.sites s
join migration.row_map r
  on r.entity = 'site' and r.target_table = 'sites' and r.target_key = s.id::text
where s.customer_id is null`,
    },
    {
      group: GROUP,
      label: 'subcontractors',
      oldSql: 'select count(*)::int as value from migration."stg_subcontractor"',
      newSql: `select count(*)::int as value
from app.subcontractors s
join migration.row_map r
  on r.entity = 'subcontractor' and r.target_table = 'subcontractors' and r.target_key = s.id::text`,
    },
    {
      group: GROUP,
      label: 'subcontractor interior rate sum',
      oldSql: `select coalesce(sum(case when "interior" ~ '^-?[0-9]+(\\.[0-9]+)?$' then "interior"::numeric else 0 end), 0)::numeric as value
from migration."stg_subcontractor"`,
      newSql:
        'select coalesce(sum(rate_interior), 0)::numeric as value from app.subcontractors where id > 0',
    },
    {
      group: GROUP,
      label: 'suppliers',
      oldSql: 'select count(*)::int as value from migration."stg_suppliers"',
      newSql: 'select count(*)::int as value from app.suppliers where id > 0',
    },
    {
      group: GROUP,
      label: 'subcontractor contacts',
      oldSql: 'select count(*)::int as value from migration."stg_subcontractor_contact_info"',
      newSql: 'select count(*)::int as value from app.subcontractor_contacts',
    },
    {
      group: GROUP,
      label: 'customer e-mails kept in the mirror (loaded from the dump, not this run)',
      oldSql: 'select count(*)::int as value from migration."stg_customer_emails"',
      newSql: 'select count(*)::int as value from public.customer_emails',
      mode: 'oldOnly' as const,
    },
    {
      group: GROUP,
      label: 'site address changes kept in the mirror (loaded from the dump, not this run)',
      oldSql: 'select count(*)::int as value from migration."stg_site_address_change_log"',
      newSql: 'select count(*)::int as value from public.site_address_change_log',
      mode: 'oldOnly' as const,
    },
  ],
}
