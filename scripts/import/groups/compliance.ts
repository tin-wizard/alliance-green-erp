/**
 * Group 5 — compliance and documents (plan §2.5 step 5).
 *
 * Three destinations, because the forward model has three shapes:
 *
 *  - WSIB/insurance files and additional subcontractor files land in
 *    `app.subcontractor_documents`, split by `kind`. The legacy `file_name` is a
 *    path on the old file server, never a storage key, so it is preserved as a
 *    display name and the file itself is re-uploaded (`storageKey` stays null).
 *  - `site_warranty` and `material_warranty` both land in `app.site_warranties`.
 *    A material warranty has no table of its own; its part number and type are
 *    folded into the description rather than dropped.
 *  - `signoff_cron` is a work queue for a cron that scanned uploaded PDFs. It is
 *    a transient row, not a record of anything, so it is deliberately not mapped
 *    and every column is listed in `unmapped`.
 *
 * Parents come from groups 2 (sites, subcontractors) and 6 (work orders). Group 5
 * runs before group 6 in the manifest, so `work_order_id` resolves on a replay but
 * is null on the first pass; the row is still complete without it.
 */
import { eq } from 'drizzle-orm'
import type { Tx } from '@cls/db'
import {
  subcontractorDocuments,
  subcontractors,
  sites,
  siteWarranties,
  workOrders,
} from '@cls/db/schema'
import type { GroupTransformer, TransformContext, TransformHelpers } from '../types'
import { selectIdMemo } from '../exists-memo'

const GROUP = 'compliance'
const SUB_DOCUMENT_KINDS = ['wsib', 'insurance', 'other'] as const

/** The manifest entity name, used for row_map and exception rows. */
function entityFor(table: string): string {
  if (table === 'subcontractor_wsib_insurance_documents') return 'subcontractor_wsib_document'
  if (table === 'subcontractor_additional_documents') return 'subcontractor_document'
  if (table === 'material_warranty') return 'material_warranty'
  if (table === 'site_warranty') return 'site_warranty'
  return 'signoff_cron'
}

function intOf(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? parsed : null
}

/** Legacy unix-seconds upload stamps; 0 and negatives are "never recorded". */
async function uploadedAt(
  helpers: TransformHelpers,
  context: TransformContext,
  column: string,
): Promise<Date | null> {
  const seconds = helpers.int(column)
  if (seconds === null) return null
  if (seconds <= 0) {
    await helpers.exception({
      exceptionClass: 'zero_date',
      entity: entityFor(context.table),
      sourceKey: context.sourceKey,
      action: 'stored migration time because uploaded_at is NOT NULL; legacy stamp is 0',
      notes: `${column} = ${String(seconds)} is not a real timestamp`,
    })
    return null
  }
  return new Date(seconds * 1000)
}

/**
 * The subcontractor crosswalk first, then the target id. `app.subcontractors.id`
 * is the legacy `subcontractor.id`, so the direct hit is the normal path and the
 * row map only matters when a group-2 row was renumbered.
 */
async function resolveSubcontractor(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<number | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('subcontractor', 'subcontractor', String(legacyId))
  const candidate = intOf(mapped) ?? legacyId
  const [row] = await selectIdMemo(tx, subcontractors.id, candidate)
  return row?.id ?? null
}

async function resolveSite(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<number | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('site', 'sites', String(legacyId))
  const candidate = intOf(mapped) ?? legacyId
  const [row] = await selectIdMemo(tx, sites.id, candidate)
  return row?.id ?? null
}

/** Only returns a work order that exists, because the FK would reject a guess. */
async function resolveWorkOrder(
  tx: Tx,
  helpers: TransformHelpers,
  legacyId: number | null,
): Promise<number | null> {
  if (legacyId === null) return null
  const mapped = await helpers.targetKey('work_order', 'workorder', String(legacyId))
  const candidate = intOf(mapped) ?? legacyId
  const [row] = await selectIdMemo(tx, workOrders.id, candidate)
  return row?.id ?? null
}

type DocumentValues = typeof subcontractorDocuments.$inferInsert

async function upsertDocument(context: TransformContext, values: DocumentValues): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const entity = entityFor(context.table)
  const existing = await helpers.targetKey(entity, context.table, sourceKey)
  let targetKey = existing
  if (existing === null) {
    const [inserted] = await tx
      .insert(subcontractorDocuments)
      .values(values)
      .returning({ id: subcontractorDocuments.id })
    targetKey = inserted!.id
  } else {
    await tx
      .update(subcontractorDocuments)
      .set(values)
      .where(eq(subcontractorDocuments.id, existing))
  }
  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'subcontractor_documents',
    targetKey: targetKey!,
  })
}

async function transformSubcontractorDocument(
  context: TransformContext,
  source: 'wsib' | 'additional',
): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const subcontractorId = await resolveSubcontractor(tx, helpers, helpers.int('subid'))
  if (subcontractorId === null) {
    // `subcontractor_id` is NOT NULL and FK-bound, so an unresolved vendor means
    // the file cannot be attached anywhere without inventing a parent.
    await helpers.exception({
      exceptionClass: 'subcontractor_without_vendor',
      entity: entityFor(context.table),
      sourceKey,
      action: 'row not inserted: no app.subcontractors row for subid',
      notes: `subid = ${JSON.stringify(context.row.subid)}`,
    })
    return
  }

  const uploaded = await uploadedAt(helpers, context, 'uploaded_timespan')
  const isWsib = source === 'wsib'
  // The legacy WSIB certificate type is spelled `WSIB-WCB` (the board's two names),
  // so an exact match on the new kind would file every certificate as `other`.
  const legacyType = isWsib ? helpers.text('document_type') : null
  const wsibAlias = legacyType !== null && /^wsib([-_ /]?wcb)?$/i.test(legacyType.trim()) ? 'wsib' : null
  const declared = isWsib ? (wsibAlias ?? helpers.enumOf('document_type', SUB_DOCUMENT_KINDS)) : null

  const values: DocumentValues = {
    subcontractorId,
    kind: declared ?? 'other',
    // The additional-document table has no type column; naming its source table
    // keeps the two document sets distinguishable in the new list.
    documentType: isWsib ? helpers.text('document_type') : 'additional',
    documentName: helpers.text('document_name'),
    storageKey: null,
    fileName: helpers.text('file_name'),
    expiresOn: isWsib ? helpers.date('expiration_date') : null,
    isExpired: isWsib ? helpers.flag('is_expired') === 1 : false,
    // The legacy reminder flags and the day-count expiry live here verbatim: the
    // target has one free-form state column and the new expiry job owns the rest.
    reminderState: isWsib
      ? {
          legacyNearExpireReminderDone: helpers.flag('near_expire_reminder_done'),
          legacySendEmailToSub: helpers.flag('send_email_to_sub'),
          legacyEmailSentSuccess: helpers.flag('email_sent_success'),
          legacyLastReminderDate: helpers.date('last_reminder_date'),
          legacyExpirationDays: helpers.int('expiration_timespan'),
        }
      : null,
    ...(uploaded === null ? {} : { uploadedAt: uploaded }),
  }

  await upsertDocument(context, values)
}

type SiteWarrantyValues = typeof siteWarranties.$inferInsert

async function upsertSiteWarranty(
  context: TransformContext,
  values: SiteWarrantyValues,
): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const entity = entityFor(context.table)
  const existing = await helpers.targetKey(entity, context.table, sourceKey)
  let targetKey = existing
  if (existing === null) {
    const [inserted] = await tx
      .insert(siteWarranties)
      .values(values)
      .returning({ id: siteWarranties.id })
    targetKey = inserted!.id
  } else {
    await tx.update(siteWarranties).set(values).where(eq(siteWarranties.id, existing))
  }
  await helpers.remember({
    entity,
    sourceTable: context.table,
    sourceKey,
    targetTable: 'site_warranties',
    targetKey: targetKey!,
  })
}

async function transformSiteWarranty(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const siteId = await resolveSite(tx, helpers, helpers.int('site_id'))
  if (siteId === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey,
      action: 'row not inserted: site_id is NOT NULL and no app.sites row exists',
      notes: `site_id = ${JSON.stringify(context.row.site_id)}`,
    })
    return
  }
  await upsertSiteWarranty(context, {
    siteId,
    description: helpers.text('warranty_notes'),
    expiresOn: helpers.date('expiration_date'),
  })
}

async function transformMaterialWarranty(context: TransformContext): Promise<void> {
  const { tx, helpers, sourceKey } = context
  const workOrderId = await resolveWorkOrder(tx, helpers, helpers.int('woid'))
  let siteId = await resolveSite(tx, helpers, helpers.int('site_id'))

  // A material warranty is often recorded against the work order only; the site
  // is then the work order's site. No work order at group-5 time means no site.
  if (siteId === null && workOrderId !== null) {
    const [parent] = await tx
      .select({ siteId: workOrders.siteId })
      .from(workOrders)
      .where(eq(workOrders.id, workOrderId))
      .limit(1)
    siteId = parent?.siteId ?? null
  }

  if (siteId === null) {
    await helpers.exception({
      exceptionClass: 'orphan_line',
      entity: entityFor(context.table),
      sourceKey,
      action: 'row not inserted: site_id is NOT NULL and neither site_id nor woid resolves',
      notes: `site_id = ${JSON.stringify(context.row.site_id)}, woid = ${JSON.stringify(context.row.woid)}`,
    })
    return
  }

  // The part number and warranty type are the only identity this row has; the
  // target has one free-text description, so both go in it.
  const description = [
    helpers.text('warranty_type'),
    helpers.text('partno'),
    helpers.text('partdesc'),
  ]
    .filter((part): part is string => part !== null)
    .join(' — ')

  await upsertSiteWarranty(context, {
    siteId,
    description: description === '' ? null : description,
    expiresOn: helpers.date('expiration_date'),
    workOrderId,
  })
}

/**
 * Why `signoff_cron` is not migrated. It is a cron work queue: `is_processed` and
 * `signature_found` record what the old scanner did, and the signature itself was
 * a page inside a PDF that is re-uploaded with the work order.
 */
const SIGNOFF_CRON =
  'transient PDF sign-off extraction queue; the signatures live in the re-uploaded work-order PDFs, so nothing is reconstructed'

/** One `not_migrated` row per table: the report names the decision once, not per row. */
async function skipTable(context: TransformContext, reason: string): Promise<void> {
  await context.helpers.exception({
    exceptionClass: 'not_migrated',
    entity: context.table,
    sourceKey: context.table,
    action: `not migrated: ${reason}`,
    notes: 'whole-table decision; every row of this table is skipped and stays in staging',
  })
}

export const transformer: GroupTransformer = {
  group: GROUP,

  async transform(context) {
    switch (context.table) {
      case 'subcontractor_wsib_insurance_documents':
        return transformSubcontractorDocument(context, 'wsib')
      case 'subcontractor_additional_documents':
        return transformSubcontractorDocument(context, 'additional')
      case 'site_warranty':
        return transformSiteWarranty(context)
      case 'material_warranty':
        return transformMaterialWarranty(context)
      case 'signoff_cron':
        return skipTable(context, SIGNOFF_CRON)
      default:
        throw new Error(`${GROUP}: no mapping for table ${context.table}`)
    }
  },

  unmapped: {
    'subcontractor_wsib_insurance_documents.near_expire_reminder_done':
      'legacy cron state; preserved verbatim in reminder_state, the new expiry job owns reminders',
    'subcontractor_wsib_insurance_documents.send_email_to_sub':
      'legacy cron state; preserved verbatim in reminder_state',
    'subcontractor_wsib_insurance_documents.email_sent_success':
      'legacy cron state; preserved verbatim in reminder_state',
    'subcontractor_wsib_insurance_documents.last_reminder_date':
      'legacy cron state; preserved verbatim in reminder_state',
    'subcontractor_wsib_insurance_documents.expiration_timespan':
      'derived day count; kept in reminder_state, expiration_date is authoritative',
    'subcontractor_additional_documents.document_notes':
      'no target column on app.subcontractor_documents; text stays in staging (schema gap)',
    'material_warranty.partno':
      'folded into site_warranties.description; the target has no part column',
    'material_warranty.partdesc': 'folded into site_warranties.description',
    'material_warranty.warranty_type': 'folded into site_warranties.description',
    'material_warranty.start_date': 'no target column; only the expiry is modelled',
    'site_warranty.expiration_timespan': 'derived day count; expiration_date is authoritative',
    'signoff_cron.*': SIGNOFF_CRON,
  },

  parity: [
    {
      group: GROUP,
      label: 'subcontractor documents (wsib, insurance, additional)',
      oldSql:
        'select (select count(*) from migration."stg_subcontractor_wsib_insurance_documents") + (select count(*) from migration."stg_subcontractor_additional_documents") as rows',
      newSql: 'select count(*)::int as rows from app.subcontractor_documents',
    },
    {
      group: GROUP,
      label: 'warranty rows (site + material)',
      oldSql:
        'select (select count(*) from migration."stg_site_warranty") + (select count(*) from migration."stg_material_warranty") as rows',
      newSql: 'select count(*)::int as rows from app.site_warranties',
    },
  ],
}
