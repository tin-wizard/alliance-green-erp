/**
 * Exception classes, in the shape `reports/purchasing-migration-exceptions.*`
 * already uses: one class, one owner, one action, every row listed by source key.
 *
 * A class the client's finance, operations or admin team must decide carries its
 * owner here rather than in a meeting note.
 */
import type { ExceptionClass } from './types'

export interface ExceptionClassMeta {
  title: string
  owner: 'finance' | 'operations' | 'admin' | 'data platform' | 'module owner' | 'business owner'
  description: string
  /** A policy skip is not a defect: it is what the migration deliberately does not do. */
  policySkip: boolean
}

export const EXCEPTION_CLASSES: Record<ExceptionClass, ExceptionClassMeta> = {
  placeholder_work_order: {
    title: 'Placeholder work orders',
    owner: 'business owner',
    description: 'WO ids 99999999, 44444444, 9999999, 9999998 and 0 are markers, not jobs. Not inserted; the allocator must never issue them.',
    policySkip: true,
  },
  woid_mismatch: {
    title: 'Work order id disagrees with woid',
    owner: 'operations',
    description: 'The row names two different work orders. Skipped rather than guessed; attach or archive after review.',
    policySkip: true,
  },
  duplicate_username: {
    title: 'Duplicate usernames',
    owner: 'admin',
    description: 'Two legacy accounts share a username. One canonical account is kept and the other is quarantined before any credential exists.',
    policySkip: true,
  },
  disabled_user: {
    title: 'Disabled users',
    owner: 'admin',
    description: 'Migrated disabled, with no credential and no invitation. History is retained.',
    policySkip: false,
  },
  no_email: {
    title: 'Accounts without an email',
    owner: 'admin',
    description: 'No invitation can be sent. Office verifies identity by phone and issues a one-time code.',
    policySkip: false,
  },
  subcontractor_without_vendor: {
    title: 'Subcontractor accounts without a vendor row',
    owner: 'operations',
    description: 'The account is kept but not invited until a real vendor row exists. Never create a fake vendor.',
    policySkip: false,
  },
  orphan_workorder_site: {
    title: 'Work orders whose site does not exist',
    owner: 'operations',
    description: 'The raw site id is preserved on the work order; no site is invented.',
    policySkip: false,
  },
  orphan_site_customer: {
    title: 'Sites without a billing customer',
    owner: 'operations',
    description: 'Site is kept and selectable with a NULL customer; list and detail mark "No billing customer".',
    policySkip: false,
  },
  orphan_line: {
    title: 'Lines whose parent does not exist',
    owner: 'module owner',
    description: 'The line is kept with a NULL parent; no FK is forced and no parent is fabricated.',
    policySkip: false,
  },
  duplicate_sage_item: {
    title: 'Two parts claim one Sage item',
    owner: 'operations',
    description: 'The part is kept with a NULL sage_item_id; the row that already owns the item keeps it. Merging two stock records is a decision, not a migration step.',
    policySkip: false,
  },
  duplicate_display_number: {
    title: 'Two purchase orders claim one display number',
    owner: 'operations',
    description: 'The later row gets a suffixed display number; the number a person quotes stays unique.',
    policySkip: false,
  },
  duplicate_invoice_number: {
    title: 'Two supplier invoices claim one number',
    owner: 'finance',
    description: 'The later row gets a suffixed number; neither invoice is overwritten.',
    policySkip: false,
  },
  quote_id_collision: {
    title: 'Quote numbers collide across the two legacy id spaces',
    owner: 'operations',
    description: 'Customer quotes and standalone quotes shared a number range. The colliding row is not inserted; resolve before cutover.',
    policySkip: false,
  },
  legacy_deleted_line: {
    title: 'Lines deleted in the legacy system',
    owner: 'operations',
    description: "A -99999 quantity is the old delete marker. The line is not inserted.",
    policySkip: true,
  },
  missing_invoice_number: {
    title: 'Invoices without a number',
    owner: 'finance',
    description: 'Migrated with a deterministic legacy number so the series stays unique; the gap is listed.',
    policySkip: false,
  },
  status_not_allowed_for_kind: {
    title: 'Status not valid for this record kind',
    owner: 'module owner',
    description: 'The row kept a status that the new state machine does not allow for its kind; it is left for review rather than remapped.',
    policySkip: false,
  },
  unparseable_json: {
    title: 'Unparseable JSON snapshots',
    owner: 'data platform',
    description: 'The raw text is preserved (or the snapshot skipped) and listed; nothing is guessed.',
    policySkip: false,
  },
  unparseable_timestamp: {
    title: 'Unparseable timestamps',
    owner: 'data platform',
    description: 'Stored NULL and listed with the raw value; no timezone is invented.',
    policySkip: false,
  },
  unresolved_part_line: {
    title: 'Unresolved part lines',
    owner: 'operations',
    description: "Part numbers such as '---' are preserved as exceptions; no fake part is created.",
    policySkip: false,
  },
  blank_money: {
    title: 'Blank money values',
    owner: 'finance',
    description:
      'Stored NULL wherever the target allows it. Where the column is NOT NULL the row stores 0.00 and says so in its action; nothing is blank-filled silently.',
    policySkip: false,
  },
  blank_tax: {
    title: 'Blank tax on invoices',
    owner: 'finance',
    description: 'Stored NULL and counted separately from zero tax. Decide whether to backfill from Sage.',
    policySkip: false,
  },
  unparseable_money: {
    title: 'Unparseable money',
    owner: 'finance',
    description: 'The raw value is listed with its source key and stored NULL. No rounding, no guessing.',
    policySkip: false,
  },
  money_zero_owed: {
    title: 'Amount owed is zero',
    owner: 'finance',
    description: 'A zero is preserved as a zero; this list exists so a real zero is distinguishable from a missing value.',
    policySkip: false,
  },
  zero_amount: {
    title: 'Zero amounts',
    owner: 'finance',
    description: 'Zero kept as zero; NULL kept as NULL. The exception records which case the row is, never a coercion.',
    policySkip: false,
  },
  unbalanced_totals: {
    title: 'Totals that do not match their lines',
    owner: 'finance',
    description: 'Both totals are recorded; the new total is recomputed from lines. Neither number is silently chosen.',
    policySkip: false,
  },
  missing_po_number: {
    title: 'Purchase orders without a number',
    owner: 'operations',
    description: 'Migrated with a generated PO-LEGACY-<id> number so the series stays unique; the gap is listed.',
    policySkip: false,
  },
  series_seed: {
    title: 'Number series seeded',
    owner: 'operations',
    description: 'The next number was taken from the legacy counter, not from the highest number issued.',
    policySkip: false,
  },
  zero_date: {
    title: 'Zero dates',
    owner: 'data platform',
    description: "MySQL '0000-00-00' becomes NULL; it is not rewritten as 1970.",
    policySkip: false,
  },
  unknown_enum: {
    title: 'Unknown status values',
    owner: 'module owner',
    description: 'Stored NULL rather than mapped to the nearest label; the raw value is in the exception.',
    policySkip: false,
  },
  latin1_text: {
    title: 'latin1 text',
    owner: 'data platform',
    description: 'Converted once at extract; the affected rows stay listed for accent verification.',
    policySkip: false,
  },
  mojibake_suspected: {
    title: 'Text that may be mojibake',
    owner: 'operations',
    description: 'Preserved exactly as stored. The list lets the client decide whether to repair it after cutover.',
    policySkip: false,
  },
  dated_duplicate_skipped: {
    title: 'Dated duplicate tables skipped',
    owner: 'data platform',
    description: 'Frozen copies taken before a mass edit (po_status_v2, *_backup_*, *_july_*). The definition is archived; the rows are not migrated.',
    policySkip: true,
  },
  missing_in_dump: {
    title: 'Tables missing from the dump',
    owner: 'data platform',
    description: 'The module stays blocked until the live dump is loaded and counted.',
    policySkip: false,
  },
  not_migrated: {
    title: 'Tables deliberately not migrated',
    owner: 'operations',
    description: 'Audit/history tables with no target in the new schema. Counted once per table, with the reason.',
    policySkip: true,
  },
}

export function exceptionClassMeta(exceptionClass: string): ExceptionClassMeta {
  return (
    EXCEPTION_CLASSES[exceptionClass as ExceptionClass] ?? {
      title: exceptionClass,
      owner: 'data platform',
      description: 'Class added by a group transformer; document it here before cutover.',
      policySkip: false,
    }
  )
}
