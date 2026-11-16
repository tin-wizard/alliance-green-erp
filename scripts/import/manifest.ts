/**
 * The migration manifest: what is loaded, in what order, and where it goes.
 *
 * This is data, not prose. The staging DDL, the loader's allow-list, the fixture
 * generator, the runner's iteration order and the report's group table all read
 * this file. Adding a table is one line here plus a column map in its group's
 * transformer.
 *
 * Sources: `plan/CUTOVER-AND-MIGRATION.md` §2.5 (order), `green-system/schema.sql`
 * (columns), `green-system/DATA-DICTIONARY.md` (dated-duplicate classes).
 */
import legacy from './legacy-schema.json' with { type: 'json' }

export interface ManifestTable {
  /** Legacy table name, exactly. */
  table: string
  /** Entity name used in `migration.row_map` and `migration.errors`. */
  entity: string
  /** Primary key columns in the dump; first non-empty one is the source key. */
  primaryKey: string[]
  /**
   * Fixture row count. The fixture is a case matrix, not a volume: these are the
   * rows the rehearsal stages, and the numbers the expected-versus-actual report
   * prints.
   */
  fixtureRows: number
}

export interface ManifestGroup {
  /** Dependency order, 1-12. */
  order: number
  name: string
  /** Transformer module under `scripts/import/groups/`, or null for skip-only. */
  transformer: string | null
  tables: ManifestTable[]
  /**
   * Slices of a batch to run at once. Only for groups whose rows do not read
   * one another's results within an entity; the default is one at a time.
   */
  concurrency?: number
}

function table(tableName: string, entity: string, fixtureRows: number): ManifestTable {
  const definition = (legacy.tables as Record<string, { primaryKey: string[] }>)[tableName]
  if (!definition) throw new Error(`manifest references unknown legacy table ${tableName}`)
  return { table: tableName, entity, primaryKey: definition.primaryKey, fixtureRows }
}

export const GROUPS: ManifestGroup[] = [
  {
    order: 1,
    name: 'lookups',
    transformer: 'lookups',
    tables: [
      table('wo_status', 'wo_status', 5),
      table('wo_priority', 'wo_priority', 3),
      table('wo_servtype', 'wo_servtype', 4),
      table('wo_categories', 'wo_categories', 4),
      table('po_status', 'po_status', 6),
      table('po_priority', 'po_priority', 3),
      table('po_preorder_status', 'po_preorder_status', 3),
      table('customer_quote_status', 'customer_quote_status', 4),
      table('standalone_quote_status', 'standalone_quote_status', 4),
      table('tjx_quote_status', 'tjx_quote_status', 4),
      table('rga_status', 'rga_status', 4),
    ],
  },
  {
    order: 2,
    name: 'parties',
    transformer: 'parties',
    // Explicit legacy ids with upserts: rows never read each other's results.
    concurrency: 24,
    tables: [
      table('customer', 'customer', 6),
      table('sites', 'site', 8),
      table('subcontractor', 'subcontractor', 5),
      table('subcontractor_contact_info', 'subcontractor_contact', 5),
      table('suppliers', 'supplier', 4),
      table('customer_emails', 'customer_email', 4),
      table('site_address_change_log', 'site_address_change', 3),
    ],
  },
  {
    order: 3,
    name: 'identity',
    transformer: 'identity',
    tables: [
      table('users', 'user', 12),
      table('user_permissions', 'user_permission', 6),
      table('user_permissions_price_management', 'user_permission_price', 2),
      // Read by `admin/site_permission._for_user.php` to render the grant list.
      table('permission_type', 'permission_type', 0),
    ],
  },
  {
    order: 4,
    name: 'parts',
    transformer: 'parts',
    // Rates and history read parts; only `parts` itself is serial.
    concurrency: 24,
    tables: [
      table('parts', 'part', 10),
      table('parts_group', 'part_group', 3),
      table('parts_selling_rates', 'part_selling_rate', 4),
      table('parts_selling_rates_list', 'part_selling_rate_list', 2),
      table('parts_supplier_rates', 'part_supplier_rate', 3),
      table('parts_supplier_rates_list', 'part_supplier_rate_list', 2),
      table('parts_price_history', 'part_price_history', 4),
      table('shared_parts_list', 'shared_part', 3),
      table('prf', 'prf', 2),
      table('wo_next_pid', 'wo_next_pid', 1),
      // Sub-supplier list under a supplier, read on the PO and preorder screens.
      table('parts_sub_suppliers', 'part_sub_supplier', 0),
      // Per-supplier, per-model price, read by the PO editor's cost lookup.
      table('parts_supplier_model_rates', 'part_supplier_model_rate', 0),
    ],
  },
  {
    order: 5,
    name: 'compliance',
    transformer: 'compliance',
    // Document and warranty rows: each reads earlier entities and writes only itself.
    concurrency: 24,
    tables: [
      table('subcontractor_wsib_insurance_documents', 'subcontractor_wsib_document', 3),
      table('subcontractor_additional_documents', 'subcontractor_document', 3),
      table('material_warranty', 'material_warranty', 3),
      table('site_warranty', 'site_warranty', 3),
      table('signoff_cron', 'signoff_cron', 2),
    ],
  },
  {
    order: 6,
    name: 'work-orders',
    transformer: 'work-orders',
    // Child rows read the work order; only `workorder` itself (parent links) is serial.
    concurrency: 24,
    tables: [
      table('workorder', 'work_order', 14),
      table('wo_hours', 'work_order_hour', 6),
      table('localwo_hours', 'local_work_order_hour', 3),
      table('localwo_techs', 'local_work_order_tech', 3),
      table('wo_soparts', 'work_order_special_part', 4),
      table('wo_parts', 'work_order_part', 8),
      table('wo_tax', 'work_order_tax', 4),
      table('wo_report', 'work_order_report', 3),
      table('wo_notes', 'work_order_note', 4),
      table('wo_revisions', 'work_order_revision', 2),
      table('wo_invoiceno', 'work_order_invoice_number', 2),
      table('wo_images_cropped', 'work_order_image', 2),
      // The `localwo_*` family the field techs write against a local work order.
      table('localwo_cusprofile', 'local_work_order_customer_profile', 0),
      table('localwo_hours_change_histroy', 'local_work_order_hour_history', 0),
      table('localwo_quotes', 'local_work_order_quote', 0),
      table('localwo_sigs', 'local_work_order_signature', 0),
      // The subcontractor material checklist, opened from `subcontractor/workorder.php`.
      table('material_checklist', 'material_checklist', 0),
      table('material_checklist_custom_entries', 'material_checklist_custom_entry', 0),
      table('material_checklist_defective_parts', 'material_checklist_defective_part', 0),
      table('material_checklist_notes', 'material_checklist_note', 0),
      table('material_checklist_parts', 'material_checklist_part', 0),
      table(
        'material_checklist_returning_custom_enteries',
        'material_checklist_returning_custom_entry',
        0,
      ),
      table('material_checklist_returning_parts', 'material_checklist_returning_part', 0),
      // Bulk-imported, not yet dispatched work orders; the inbox `menu.php` links to.
      table('undispatched_workorders', 'undispatched_work_order', 0),
    ],
  },
  {
    order: 7,
    name: 'quotes',
    transformer: 'quotes',
    tables: [
      table('customer_quote', 'customer_quote', 5),
      table('customer_quote_hours', 'customer_quote_hour', 3),
      table('customer_quote_parts', 'customer_quote_part', 4),
      table('customer_quote_soparts', 'customer_quote_special_part', 3),
      table('customer_qo_packing_slip', 'quote_packing_slip', 2),
      table('customer_qo_packing_parts', 'quote_packing_part', 3),
      table('standalone_quote', 'standalone_quote', 3),
      table('standalone_quote_hours', 'standalone_quote_hour', 2),
      table('standalone_quote_parts', 'standalone_quote_part', 3),
      table('standalone_quote_soparts', 'standalone_quote_special_part', 2),
      table('rejected_quotes', 'rejected_quote', 2),
      // Payment-term vocabulary the customer-quote screens render.
      table('customer_quote_payterms', 'customer_quote_payterm', 0),
      table('customer_qo_packing_soparts', 'quote_packing_special_part', 0),
      // `quote_*` — the subcontractor's quote worksheet (plan §2.5 step 7).
      table('quote_hours', 'quote_hour', 0),
      table('quote_hours_incurred', 'quote_hour_incurred', 0),
      table('quote_parts', 'quote_part', 0),
      table('quote_parts_incurred', 'quote_part_incurred', 0),
      table('quote_report', 'quote_report', 0),
      table('quote_soparts', 'quote_special_part', 0),
      table('quote_soparts_incurred', 'quote_special_part_incurred', 0),
      // `calcquote_*` — the calculated customer quote (plan §2.5 step 7).
      table('calcquote_hours', 'calcquote_hour', 0),
      table('calcquote_hours_incurred', 'calcquote_hour_incurred', 0),
      table('calcquote_incurred', 'calcquote_incurred', 0),
      table('calcquote_parts', 'calcquote_part', 0),
      table('calcquote_parts_incurred', 'calcquote_part_incurred', 0),
      table('calcquote_report', 'calcquote_report', 0),
      table('calcquote_soparts', 'calcquote_special_part', 0),
      table('calcquote_soparts_incurred', 'calcquote_special_part_incurred', 0),
    ],
  },
  {
    order: 8,
    name: 'purchasing',
    transformer: 'purchasing',
    tables: [
      table('purchaseorder', 'purchase_order', 8),
      table('po_parts', 'purchase_order_part', 10),
      table('po_soparts', 'purchase_order_special_part', 4),
      table('po_preorder', 'purchase_order_preorder', 2),
      table('po_preorder_parts', 'purchase_order_preorder_part', 3),
      table('po_preorder_soparts', 'purchase_order_preorder_special_part', 2),
      table('po_invoice', 'purchase_order_invoice', 4),
      table('po_invoice_parts', 'purchase_order_invoice_part', 4),
      table('po_quote', 'purchase_order_rfq', 2),
      table('po_quote_requested_parts', 'purchase_order_rfq_line', 3),
      table('rejected_invoices', 'rejected_invoice', 2),
      // `po_quote*` — the RFQ request/submission screens (plan §2.5 step 8).
      table('po_quote_request_status', 'purchase_order_rfq_request_status', 0),
      table('po_quote_submitted_status', 'purchase_order_rfq_submitted_status', 0),
      table('po_quote_suppliers', 'purchase_order_rfq_supplier', 0),
      table('po_quote_requested_parts_detail', 'purchase_order_rfq_requested_part', 0),
      // `po_supplier_quote*` — the quotes that come back against an RFQ.
      table('po_supplier_quote', 'purchase_order_supplier_quote', 0),
      table('po_supplier_quote_parts', 'purchase_order_supplier_quote_line', 0),
      table('po_invoice_soparts', 'purchase_order_invoice_special_part', 0),
      table('po_preorder_suppliers', 'purchase_order_preorder_supplier', 0),
      table('po_submission_after_approval', 'purchase_order_approval_submission', 0),
    ],
  },
  {
    order: 9,
    name: 'inventory',
    transformer: 'inventory',
    // Movement and adjustment rows are independent inserts.
    concurrency: 24,
    tables: [
      table('parts_inventory', 'part_inventory', 4),
      table('parts_inventory_adjustment', 'part_inventory_adjustment', 4),
      table('parts_purchased_inventory', 'part_purchased_inventory', 3),
      table('parts_purchasing_log', 'part_purchasing_log', 3),
      table('parts_salepurchase_log', 'part_salepurchase_log', 3),
      table('parts_selling_log', 'part_selling_log', 3),
      table('parts_price_lock', 'part_price_lock', 2),
    ],
  },
  {
    order: 10,
    name: 'invoicing-rga',
    transformer: 'invoicing-rga',
    // Lines create their invoice header with ON CONFLICT DO NOTHING, so a race is safe.
    concurrency: 16,
    tables: [
      table('inv_project', 'invoice_project', 5),
      table('inv_hours', 'invoice_hour', 4),
      table('inv_parts', 'invoice_part', 5),
      table('inv_soparts', 'invoice_special_part', 3),
      table('inv_tax', 'invoice_tax', 6),
      table('rga', 'rga', 4),
      table('rga_parts', 'rga_part', 4),
      table('rga_soparts', 'rga_special_part', 2),
      // ServiceChannel invoice drafts (plan §2.5 step 10).
      table('sc_inv_hours', 'sc_invoice_hour', 0),
      table('sc_inv_parts', 'sc_invoice_part', 0),
      table('sc_inv_soparts', 'sc_invoice_special_part', 0),
      table('sc_inv_tax', 'sc_invoice_tax', 0),
    ],
  },
  {
    order: 11,
    name: 'tjx',
    transformer: 'tjx',
    tables: [
      table('tjx_quote', 'tjx_quote', 3),
      table('tjx_quote_fixtures', 'tjx_quote_fixture', 3),
      table('tjx_fixture_parts', 'tjx_fixture_part', 3),
      table('tjx_quote_revisions', 'tjx_quote_revision', 2),
      table('tjx_sub_invoice', 'tjx_sub_invoice', 2),
      table('tjx_subcontractor_rates', 'tjx_subcontractor_rate', 2),
      // Rooms and fixtures are the TJX catalogue; `*_per_quote` is its per-quote copy.
      table('tjx_room', 'tjx_room', 0),
      table('tjx_fixture', 'tjx_fixture', 0),
      table('tjx_rooms_template', 'tjx_room_template', 0),
      table('tjx_fixture_per_quote', 'tjx_fixture_per_quote', 0),
      table('tjx_fixture_parts_per_quote', 'tjx_fixture_part_per_quote', 0),
      table('tjx_quote_grid_types', 'tjx_quote_grid_type', 0),
      table('tjx_quote_payterms', 'tjx_quote_payterm', 0),
      table('tjx_prices_per_quote', 'tjx_quote_price', 0),
      table('tjx_quote_parts', 'tjx_quote_part', 0),
      table('tjx_quote_soparts', 'tjx_quote_special_part', 0),
      table('tjx_quote_extra_workorders', 'tjx_quote_extra_work_order', 0),
      table('tjx_quote_lastused_sharedpart', 'tjx_quote_last_used_shared_part', 0),
      table('tjx_quote_downloads', 'tjx_quote_download', 0),
      table('tjx_sub_invoice_fixtures', 'tjx_sub_invoice_fixture', 0),
      table('tjx_sub_invoice_revisions', 'tjx_sub_invoice_revision', 0),
      table('tjx_wo_parts', 'tjx_work_order_part', 0),
      table('tjx_wo_soparts', 'tjx_work_order_special_part', 0),
    ],
  },
  {
    order: 12,
    name: 'messaging-history',
    transformer: 'messaging',
    // Only `messages` (thread creation) is serial.
    concurrency: 24,
    tables: [
      table('messages', 'message', 5),
      table('messages_links', 'message_link', 4),
      table('messages_links_po', 'message_link_po', 2),
      table('po_notification', 'po_notification', 3),
      table('rga_notification', 'rga_notification', 3),
      table('cron_run_history', 'cron_run_history', 3),
      table('site_activity_logs', 'site_activity_log', 3),
      // Who receives the check-in and quote notifications (routing, not history).
      table('message_setup', 'message_setup', 0),
      table('email_messages_to_sub', 'email_message_to_sub', 0),
      table('sub_stock_messages', 'sub_stock_message', 0),
      table('sub_stock_notification', 'sub_stock_notification', 0),
    ],
  },
]

/** Tables classified as dated/duplicate copies: never loaded, always recorded. */
export const SKIPPED_DATED_DUPLICATES = [
  'inv_parts_july_20_2025',
  'inv_parts_july_21_2025',
  'parts_backup_17dec25',
  'parts_bkup_2026jan8',
  'po_status_v2',
  'workorder_backup_2025',
] as const

export interface OutOfScopeTable {
  /** Legacy table name, exactly. */
  table: string
  /**
   * Why the table is not migrated. One sentence, and specific: the evidence is a
   * file that writes it with nothing that reads it, or a plan rule that says the
   * rows are entered by hand.
   */
  reason: string
}

/**
 * Legacy tables that stay behind on purpose.
 *
 * Three kinds, and all of them are decisions a reader can check against the
 * legacy source: dead tables no PHP file mentions, write-only transient queues,
 * and settings-like tables whose values are curated by hand after cutover
 * (`plan/CUTOVER-AND-MIGRATION.md` §2.5 step 1 — configuration is not bulk-copied
 * and secrets never travel through the migration).
 *
 * A table here is still *classified*: `dispositionFor` answers for it, the run
 * report names it, and `manifest.test.ts` fails if any legacy table is neither
 * loaded, skipped as a dated duplicate, nor listed here.
 */
export const OUT_OF_SCOPE_TABLES: OutOfScopeTable[] = [
  {
    table: 'settings',
    reason:
      'Settings-like key/value sheet curated row by row in admin/settings.php (AllowPrevFiscalYear, allowed_sub_login_names); plan §2.5 step 1 says configuration is entered by hand and never bulk-copied.',
  },
  {
    table: 'servchannel_api_setting',
    reason:
      'Settings-like key/value sheet for ServiceChannel credentials with zero reads and zero writes in the legacy app; the values are entered by hand after cutover (plan §2.5 step 1), never copied.',
  },
  {
    table: 'wo_ajax_submit',
    reason:
      'Write-only form buffer: wo_report_issue_submit.php inserts the posted payload and no file ever selects it, so the row has no meaning after cutover.',
  },
  {
    table: 'undispatched_batch_upload',
    reason:
      'Transient batch bookkeeping: import_workorders.php inserts a timestamp and nothing reads it; the rows it describes survive in undispatched_workorders.',
  },
  {
    table: 'api_sc_callback_url_response',
    reason:
      'Write-only timing log: sc_api_1.php inserts one row per callback and no file selects it, so it is a diagnostic, not data.',
  },
  {
    table: 'api_sc_status_webhook',
    reason:
      'Write-only webhook payload log: sc_api_hook_wo_status.php inserts the raw hook body and nothing reads it back.',
  },
  {
    table: 'api_sc_webhook',
    reason:
      'Write-only webhook payload log: sc_api_hook_checkin.php inserts the raw hook body and nothing reads it back.',
  },
  {
    table: 'errors_log_info',
    reason:
      'Write-only breadcrumb: config/functions.php inserts on a quote revision failure and no page or report reads it.',
  },
  {
    table: 'rga_invoice',
    reason:
      'No reference anywhere in the legacy PHP app; RGA supplier credits live in rga, rga_parts and rga_soparts, so this table is dead.',
  },
  {
    table: 'rga_invoice_parts',
    reason:
      'No reference anywhere in the legacy PHP app; RGA credit lines live in rga_parts, so this table is dead.',
  },
  {
    table: 'rga_invoice_soparts',
    reason:
      'No reference anywhere in the legacy PHP app; RGA special-part lines live in rga_soparts, so this table is dead.',
  },
]

/** Every table the legacy schema declares, in schema order. */
export const LEGACY_TABLES: readonly string[] = Object.keys(
  (legacy as { tables: Record<string, unknown> }).tables,
)

export type Disposition =
  | { kind: 'group'; group: string }
  | { kind: 'dated_duplicate' }
  | { kind: 'out_of_scope'; reason: string }
  | { kind: 'unknown'; table: string }

/**
 * What happens to one legacy table. Never guesses: an unclassified table is
 * `unknown`, and `manifest.test.ts` fails on it rather than letting a load
 * silently ignore it.
 */
export function dispositionFor(tableName: string): Disposition {
  const group = groupForTable(tableName)
  if (group) return { kind: 'group', group: group.name }
  if ((SKIPPED_DATED_DUPLICATES as readonly string[]).includes(tableName)) {
    return { kind: 'dated_duplicate' }
  }
  const outOfScope = OUT_OF_SCOPE_TABLES.find((entry) => entry.table === tableName)
  if (outOfScope) return { kind: 'out_of_scope', reason: outOfScope.reason }
  return { kind: 'unknown', table: tableName }
}

/**
 * Tables whose transformer reads or creates a row that another row of the SAME
 * table may also create (a message thread, a part found by its code). They run
 * one row at a time even inside a parallel group, so the first row in dump order
 * wins exactly as it always did. `workorder` is not here: it looks up sites and
 * subcontractors and upserts by its own id, and never reads another work order.
 */
export const SERIAL_TABLES: ReadonlySet<string> = new Set(['messages', 'parts'])

/**
 * Legacy credentials the migration never uses (users authenticate through Neon
 * Auth). The staging table keeps the column so the schema stays a mirror, but the
 * loader writes NULL: the 2026-11 dump held unsalted MD5 passwords and plaintext
 * mailbox passwords, and staging is a database other people can read. The row
 * hash is still computed from the real value, so parity is unaffected.
 */
export const NEVER_STAGED_COLUMNS: Readonly<Record<string, ReadonlySet<string>>> = {
  users: new Set(['password', 'mailing_password', 'cls_mailing_password']),
}

export const ALL_TABLES: ManifestTable[] = GROUPS.flatMap((group) => group.tables)

/** A table may be loaded, skipped or excluded — never two of them at once. */
function assertClassifiedOnce(): void {
  const legacyTables = new Set(
    Object.keys((legacy as { tables: Record<string, unknown> }).tables),
  )
  const seen = new Set<string>()
  const entries = [
    ...ALL_TABLES.map((entry) => entry.table),
    ...SKIPPED_DATED_DUPLICATES,
    ...OUT_OF_SCOPE_TABLES.map((entry) => entry.table),
  ]
  for (const table of entries) {
    if (seen.has(table)) throw new Error(`manifest classifies ${table} more than once`)
    seen.add(table)
  }
  for (const entry of OUT_OF_SCOPE_TABLES) {
    if (!legacyTables.has(entry.table)) {
      throw new Error(`out-of-scope entry names unknown legacy table ${entry.table}`)
    }
  }
}

assertClassifiedOnce()

export function groupForTable(tableName: string): ManifestGroup | undefined {
  return GROUPS.find((group) => group.tables.some((entry) => entry.table === tableName))
}

export function manifestTable(tableName: string): ManifestTable {
  const found = ALL_TABLES.find((entry) => entry.table === tableName)
  if (!found) throw new Error(`table ${tableName} is not in the manifest`)
  return found
}

/** Staging table name for a legacy table. */
export function stagingTable(tableName: string): string {
  return `stg_${tableName}`
}

/** The manifest's own version: bump when a table or key changes. */
export const MANIFEST_VERSION = '2026-11-12.2'
