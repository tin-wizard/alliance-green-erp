/**
 * The manifest must classify every legacy table, exactly once.
 *
 * The load manifest is an allow-list: a table that is neither loaded, skipped as
 * a dated duplicate, nor named as out of scope simply disappears from the
 * migration without anyone deciding that it should. These tests are the guard —
 * they fail on the next legacy table before a rehearsal can quietly drop it.
 *
 * No database is needed: this is the manifest's own shape, not the staging data.
 */
import { describe, expect, it } from 'vitest'
import {
  ALL_TABLES,
  GROUPS,
  LEGACY_TABLES,
  MANIFEST_VERSION,
  OUT_OF_SCOPE_TABLES,
  SKIPPED_DATED_DUPLICATES,
  dispositionFor,
  groupForTable,
} from './manifest'

/** The thirteen import groups, in dependency order. */
const GROUP_NAMES = [
  'lookups',
  'parties',
  'identity',
  'parts',
  'compliance',
  'work-orders',
  'quotes',
  'purchasing',
  'inventory',
  'invoicing-rga',
  'tjx',
  'messaging-history',
  'bell',
] as const

/**
 * The tables this pass classified, and the group each one lands in.
 *
 * Pinned on purpose: moving a table between groups is a decision about
 * dependency order, and it must be a deliberate edit here and in the manifest,
 * not a side effect of a refactor.
 */
const NEWLY_CLASSIFIED: Record<string, string> = {
  // 3 — identity
  permission_type: 'identity',
  // 4 — parts and rates
  parts_sub_suppliers: 'parts',
  parts_supplier_model_rates: 'parts',
  // 6 — work orders
  localwo_cusprofile: 'work-orders',
  localwo_hours_change_histroy: 'work-orders',
  localwo_quotes: 'work-orders',
  localwo_sigs: 'work-orders',
  material_checklist: 'work-orders',
  material_checklist_custom_entries: 'work-orders',
  material_checklist_defective_parts: 'work-orders',
  material_checklist_notes: 'work-orders',
  material_checklist_parts: 'work-orders',
  material_checklist_returning_custom_enteries: 'work-orders',
  material_checklist_returning_parts: 'work-orders',
  undispatched_workorders: 'work-orders',
  // 7 — quotes
  customer_quote_payterms: 'quotes',
  customer_qo_packing_soparts: 'quotes',
  calcquote_hours: 'quotes',
  calcquote_hours_incurred: 'quotes',
  calcquote_incurred: 'quotes',
  calcquote_parts: 'quotes',
  calcquote_parts_incurred: 'quotes',
  calcquote_report: 'quotes',
  calcquote_soparts: 'quotes',
  calcquote_soparts_incurred: 'quotes',
  quote_hours: 'quotes',
  quote_hours_incurred: 'quotes',
  quote_parts: 'quotes',
  quote_parts_incurred: 'quotes',
  quote_report: 'quotes',
  quote_soparts: 'quotes',
  quote_soparts_incurred: 'quotes',
  // 8 — purchasing
  po_quote_request_status: 'purchasing',
  po_quote_submitted_status: 'purchasing',
  po_quote_suppliers: 'purchasing',
  po_quote_requested_parts_detail: 'purchasing',
  po_supplier_quote: 'purchasing',
  po_supplier_quote_parts: 'purchasing',
  po_invoice_soparts: 'purchasing',
  po_preorder_suppliers: 'purchasing',
  po_submission_after_approval: 'purchasing',
  // 10 — invoicing and RGA
  sc_inv_hours: 'invoicing-rga',
  sc_inv_parts: 'invoicing-rga',
  sc_inv_soparts: 'invoicing-rga',
  sc_inv_tax: 'invoicing-rga',
  // 11 — TJX
  tjx_room: 'tjx',
  tjx_fixture: 'tjx',
  tjx_rooms_template: 'tjx',
  tjx_fixture_per_quote: 'tjx',
  tjx_fixture_parts_per_quote: 'tjx',
  tjx_quote_grid_types: 'tjx',
  tjx_quote_payterms: 'tjx',
  tjx_prices_per_quote: 'tjx',
  tjx_quote_parts: 'tjx',
  tjx_quote_soparts: 'tjx',
  tjx_quote_extra_workorders: 'tjx',
  tjx_quote_lastused_sharedpart: 'tjx',
  tjx_quote_downloads: 'tjx',
  tjx_sub_invoice_fixtures: 'tjx',
  tjx_sub_invoice_revisions: 'tjx',
  tjx_wo_parts: 'tjx',
  tjx_wo_soparts: 'tjx',
  // 12 — messaging and history
  message_setup: 'messaging-history',
  email_messages_to_sub: 'messaging-history',
  sub_stock_messages: 'messaging-history',
  sub_stock_notification: 'messaging-history',
  // The Bell tables came with the 2026-11 dump and have a group of their own.
  bell_room: 'bell',
  bell_fixture: 'bell',
  bell_fixture_parts: 'bell',
  bell_rooms_template: 'bell',
  bell_quote: 'bell',
  bell_fixture_per_quote: 'bell',
  bell_fixture_parts_per_quote: 'bell',
  bell_quote_fixtures: 'bell',
  bell_prices_per_quote: 'bell',
  bell_quote_parts: 'bell',
  bell_quote_soparts: 'bell',
  bell_quote_revisions: 'bell',
  bell_quote_downloads: 'bell',
  bell_foot_candle_readings: 'bell',
  bell_quote_extra_workorders: 'bell',
}

describe('manifest coverage', () => {
  it('classifies every legacy table, and none as unknown', () => {
    const unknown = LEGACY_TABLES.filter((table) => dispositionFor(table).kind === 'unknown')
    expect(unknown).toEqual([])
    // 175 tables in the original contract plus the 20 bell_* tables of the 2026-11 dump.
    expect(LEGACY_TABLES.length).toBe(195)
  })

  it('gives every legacy table exactly one disposition', () => {
    const loaded = new Set(ALL_TABLES.map((entry) => entry.table))
    const skipped = new Set<string>(SKIPPED_DATED_DUPLICATES)
    const outOfScope = new Set(OUT_OF_SCOPE_TABLES.map((entry) => entry.table))

    const overlaps = [
      ...loaded,
      ...skipped,
      ...outOfScope,
    ].filter(
      (table, index, all) => all.indexOf(table) !== index,
    )
    expect(overlaps).toEqual([])

    for (const table of LEGACY_TABLES) {
      const kinds = [
        loaded.has(table) ? 'group' : null,
        skipped.has(table) ? 'dated_duplicate' : null,
        outOfScope.has(table) ? 'out_of_scope' : null,
      ].filter((kind): kind is string => kind !== null)
      expect(kinds, table).toHaveLength(1)
    }
  })

  it('keeps the thirteen groups in dependency order under their plan names', () => {
    expect(GROUPS.map((group) => group.name)).toEqual([...GROUP_NAMES])
    expect(GROUPS.map((group) => group.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
  })

  it('reports a dated duplicate as skipped, never as loaded or excluded', () => {
    for (const table of SKIPPED_DATED_DUPLICATES) {
      expect(dispositionFor(table), table).toEqual({ kind: 'dated_duplicate' })
    }
  })

  it('reports an out-of-scope table with its reason', () => {
    for (const entry of OUT_OF_SCOPE_TABLES) {
      const disposition = dispositionFor(entry.table)
      expect(disposition.kind, entry.table).toBe('out_of_scope')
      expect(disposition).toMatchObject({ kind: 'out_of_scope', reason: entry.reason })
    }
  })

  it('agrees with groupForTable for every loaded table', () => {
    for (const entry of ALL_TABLES) {
      expect(dispositionFor(entry.table)).toEqual({
        kind: 'group',
        group: groupForTable(entry.table)!.name,
      })
    }
  })
})

describe('newly classified tables', () => {
  it('pins every table this pass classified to its group', () => {
    for (const [table, group] of Object.entries(NEWLY_CLASSIFIED)) {
      expect(dispositionFor(table), table).toEqual({ kind: 'group', group })
    }
  })

  it('loads them with no fixture rows, because the fixture does not carry them', () => {
    for (const table of Object.keys(NEWLY_CLASSIFIED)) {
      const entry = ALL_TABLES.find((candidate) => candidate.table === table)
      expect(entry, table).toBeDefined()
      expect(entry!.fixtureRows, table).toBe(0)
    }
  })

  it('places the purchasing wildcards in the purchasing group', () => {
    // plan/CUTOVER-AND-MIGRATION.md §2.5 step 8: `po_quote*`, `po_supplier_quote*`.
    expect(dispositionFor('po_supplier_quote')).toEqual({ kind: 'group', group: 'purchasing' })
    expect(dispositionFor('po_supplier_quote_parts')).toEqual({ kind: 'group', group: 'purchasing' })
    expect(dispositionFor('po_quote_suppliers')).toEqual({ kind: 'group', group: 'purchasing' })
    // plan step 7: `quote_*`, `calcquote_*`.
    expect(dispositionFor('calcquote_report')).toEqual({ kind: 'group', group: 'quotes' })
    expect(dispositionFor('quote_soparts_incurred')).toEqual({ kind: 'group', group: 'quotes' })
    // plan step 10: ServiceChannel invoice tables.
    expect(dispositionFor('sc_inv_tax')).toEqual({ kind: 'group', group: 'invoicing-rga' })
    // plan step 12: `sub_stock_*`, `email_messages_to_sub`.
    expect(dispositionFor('sub_stock_notification')).toEqual({
      kind: 'group',
      group: 'messaging-history',
    })
  })

  it('leaves every group name one of the thirteen', () => {
    for (const entry of ALL_TABLES) {
      const group = groupForTable(entry.table)
      expect(group, entry.table).toBeDefined()
      expect(GROUP_NAMES).toContain(group!.name)
    }
  })
})

describe('out-of-scope decisions', () => {
  it('states a specific reason, not a placeholder', () => {
    for (const entry of OUT_OF_SCOPE_TABLES) {
      expect(entry.reason.length, entry.table).toBeGreaterThanOrEqual(20)
    }
  })

  it('never lists a loaded table', () => {
    const loaded = new Set(ALL_TABLES.map((entry) => entry.table))
    for (const entry of OUT_OF_SCOPE_TABLES) {
      expect(loaded.has(entry.table), entry.table).toBe(false)
    }
  })

  it('explains a settings-like table as curated, not copied', () => {
    const settings = OUT_OF_SCOPE_TABLES.find((entry) => entry.table === 'settings')
    expect(settings?.reason).toContain('curated')
  })
})

describe('manifest version', () => {
  it('is dated, so a run report names the classification it used', () => {
    expect(MANIFEST_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/)
  })
})
