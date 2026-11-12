/**
 * Group 1 — lookups (plan §2.5 step 1).
 *
 * Eleven vocabulary tables, and no forward table of their own. That is a
 * decision, not an omission:
 *
 *  - the twelve work-order status labels are code (`modules/work-orders/lib/
 *    status.ts`), because the transition table and the display vocabulary must
 *    move together and a lookup row cannot carry either;
 *  - the other ten are read from the read-only legacy mirror (`public.wo_servtype`,
 *    `public.po_status`, `public.rga_status`, ...) by the module adapters, so
 *    copying them into `app` would create two sources for one label.
 *
 * So this group is a proof, not a copy. Every staged row must be usable by the
 * code that will read it — a code the app knows, a label it can render — the
 * crosswalk records that the mirror row is where the vocabulary now lives, and a
 * row that cannot be used is an exception now instead of a blank dropdown after
 * cutover.
 */
import type { GroupTransformer, ParityAnchor } from '../types'

const GROUP = 'lookups'

/**
 * The work-order status codes the app projects (`WORK_ORDER_STATUSES` in
 * `modules/work-orders/lib/status.ts`). A 13th code would render as "Active",
 * which is why it is an exception rather than a stored row.
 */
const WORK_ORDER_STATUS_CODES: ReadonlySet<number> = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
])

interface LookupDefinition {
  /** The manifest entity, used for row_map and exception rows. */
  entity: string
  /**
   * True when the module adapter reads `name` from the mirror row. `wo_status`
   * is false: its label is projected from code, so a legacy label cannot change
   * what a user sees.
   */
  labelIsRead: boolean
  /** Codes the app knows, when the vocabulary is code-owned. */
  codes?: ReadonlySet<number>
}

const LOOKUP_TABLES: Record<string, LookupDefinition> = {
  wo_status: { entity: 'wo_status', labelIsRead: false, codes: WORK_ORDER_STATUS_CODES },
  wo_priority: { entity: 'wo_priority', labelIsRead: true },
  wo_servtype: { entity: 'wo_servtype', labelIsRead: true },
  wo_categories: { entity: 'wo_categories', labelIsRead: true },
  po_status: { entity: 'po_status', labelIsRead: true },
  po_priority: { entity: 'po_priority', labelIsRead: true },
  po_preorder_status: { entity: 'po_preorder_status', labelIsRead: true },
  customer_quote_status: { entity: 'customer_quote_status', labelIsRead: true },
  standalone_quote_status: { entity: 'standalone_quote_status', labelIsRead: true },
  tjx_quote_status: { entity: 'tjx_quote_status', labelIsRead: true },
  rga_status: { entity: 'rga_status', labelIsRead: true },
}

const TABLE_NAMES = Object.keys(LOOKUP_TABLES)

function definitionFor(table: string): LookupDefinition {
  const found = LOOKUP_TABLES[table]
  if (!found) throw new Error(`${GROUP}: no mapping for table ${table}`)
  return found
}

export const transformer: GroupTransformer = {
  group: GROUP,

  async transform(context) {
    const { helpers, sourceKey } = context
    const definition = definitionFor(context.table)

    const id = helpers.int('id')
    if (id === null) {
      // The id is the primary key in the dump; a non-numeric one is a loader
      // defect, not a data-quality decision, so it fails the row loudly.
      throw new Error(`${context.table}.id is not an integer: ${JSON.stringify(context.row.id)}`)
    }

    const label = helpers.text('name')
    const knownCode = definition.codes === undefined || definition.codes.has(id)
    const missingLabel = definition.labelIsRead && label === null

    if (!knownCode || missingLabel) {
      await helpers.exception({
        exceptionClass: 'unknown_enum',
        entity: definition.entity,
        sourceKey,
        action: 'not projected: the vocabulary row is unusable by the code that reads it',
        notes: [
          `${context.table}.id = ${id}`,
          knownCode ? null : 'code is not in the app vocabulary',
          missingLabel ? 'label is blank and the adapter renders it' : null,
        ]
          .filter((part): part is string => part !== null)
          .join('; '),
      })
      return
    }

    // The mirror row is the surviving record: `targetTable` names it explicitly so
    // the crosswalk never implies an `app` table exists.
    await helpers.remember({
      entity: definition.entity,
      sourceTable: context.table,
      sourceKey,
      targetTable: `public.${context.table}`,
      targetKey: String(id),
    })
  },

  unmapped: {
    'wo_status.name':
      'display labels are projected from code (`WORK_ORDER_STATUSES`), so the legacy label is kept only in the mirror',
    'po_status.sorting_order':
      'display order only; the forward model sorts lookup lists by id and the mirror keeps the column',
    'rga_status.sorting_order':
      'display order only; the forward model sorts lookup lists by id and the mirror keeps the column',
    'wo_categories.code':
      'short code shown as list detail; read from the mirror, no `app` column exists',
  },

  // The app reads these vocabularies from the mirror, so staging and mirror must
  // agree row for row; a difference is a missing lookup, not a cosmetic one.
  // There is no forward lookup table: the adapters read `public.<table>` and the
  // label lives in code. So there is nothing to compare against; the anchors
  // count what was staged and crosswalked instead of pretending a mirror would
  // be filled by this harness.
  parity: TABLE_NAMES.map<ParityAnchor>((table) => ({
    group: GROUP,
    label: `${table} rows (mirror, not part of this run)`,
    oldSql: `select count(*)::int as value from migration."stg_${table}"`,
    newSql: `select count(*)::int as value from public.${table}`,
    mode: 'oldOnly' as const,
  })),
}
