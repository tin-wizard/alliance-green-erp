/**
 * Work-order status vocabulary and transitions.
 *
 * The database stores the 12 legacy `wo_status` codes verbatim (BUSINESS-RULES
 * C5). Display uses the eleven shared statuses from `@cls/core` plus the flags
 * defined in the design system's `status-vocabulary.json`. This file is the
 * single projection used by the list, detail, filters and snapshot.
 */
import { STATUS_LABELS, type Status } from '@cls/core'
import type { SavedViewKey, StatusProjection, WorkOrderStatusCode } from '../types'

export interface StatusDefinition {
  code: WorkOrderStatusCode
  legacyLabel: string
  display: Status
  flags: string[]
}

export const WORK_ORDER_STATUSES: readonly StatusDefinition[] = [
  { code: 1, legacyLabel: 'Active', display: 'progress', flags: [] },
  { code: 2, legacyLabel: 'Complete', display: 'complete', flags: [] },
  { code: 3, legacyLabel: 'Pending Approval', display: 'pending', flags: [] },
  { code: 4, legacyLabel: 'Pending Invoice', display: 'complete', flags: ['awaiting_invoice'] },
  { code: 5, legacyLabel: 'Parts on Order', display: 'ordered', flags: [] },
  { code: 6, legacyLabel: 'Cancelled', display: 'cancelled', flags: [] },
  { code: 7, legacyLabel: 'Dispatched', display: 'approved', flags: ['dispatched'] },
  { code: 8, legacyLabel: 'Reschedule', display: 'progress', flags: ['reschedule'] },
  { code: 9, legacyLabel: 'Issues', display: 'progress', flags: ['issue'] },
  { code: 10, legacyLabel: 'Declined', display: 'rejected', flags: [] },
  { code: 11, legacyLabel: 'Invoiced', display: 'invoiced', flags: [] },
  { code: 12, legacyLabel: 'Waiting for Quote', display: 'draft', flags: ['awaiting_quote'] },
] as const

const BY_CODE = new Map<number, StatusDefinition>(
  WORK_ORDER_STATUSES.map((status) => [status.code, status]),
)

export function isWorkOrderStatus(value: number): value is WorkOrderStatusCode {
  return BY_CODE.has(value)
}

export function statusDefinition(code: WorkOrderStatusCode): StatusDefinition {
  return BY_CODE.get(code) ?? WORK_ORDER_STATUSES[0]!
}

export function statusProjection(code: WorkOrderStatusCode): StatusProjection {
  const definition = statusDefinition(code)
  return {
    code,
    legacyLabel: definition.legacyLabel,
    display: definition.display,
    displayLabel: STATUS_LABELS[definition.display],
    flags: definition.flags,
  }
}

export function statusLabel(code: WorkOrderStatusCode): string {
  return statusDefinition(code).legacyLabel
}

/** Reverse map: display status → raw codes, for filters and reporting. */
export const DISPLAY_TO_CODES: Record<Status, WorkOrderStatusCode[]> = (() => {
  const map = {} as Record<Status, WorkOrderStatusCode[]>
  for (const definition of WORK_ORDER_STATUSES) {
    map[definition.display] ??= []
    map[definition.display].push(definition.code)
  }
  return map
})()

/**
 * Allowed transitions, exactly the list in the module brief §4. 11 Invoiced and
 * 6 Cancelled are terminal: they have no outgoing edges.
 */
export const ALLOWED_TRANSITIONS: Record<WorkOrderStatusCode, readonly WorkOrderStatusCode[]> = {
  1: [7, 8, 9, 5, 6],
  2: [4],
  3: [1, 10, 6],
  4: [11],
  5: [1, 7, 6],
  6: [],
  7: [2, 8, 9, 5, 6],
  8: [1, 7, 6],
  9: [1, 7, 6],
  10: [],
  11: [],
  12: [1, 6],
}

export const TERMINAL_STATUSES: readonly WorkOrderStatusCode[] = [6, 10, 11]

export function isTerminal(code: WorkOrderStatusCode): boolean {
  return ALLOWED_TRANSITIONS[code].length === 0
}

export function canTransition(from: WorkOrderStatusCode, to: WorkOrderStatusCode): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

/** Section §4 of the brief, kept here so the rule is not duplicated in SQL. */
export function allowedNextStatuses(from: WorkOrderStatusCode): readonly WorkOrderStatusCode[] {
  return ALLOWED_TRANSITIONS[from] ?? []
}

/** Permission key required to perform a transition. */
export function transitionPermission(
  to: WorkOrderStatusCode,
): 'workorder:write' | 'workorder:dispatch' | 'workorder:approve' {
  if (to === 7) return 'workorder:dispatch'
  if (to === 6 || to === 10) return 'workorder:approve'
  return 'workorder:write'
}

/** Statuses counted as "open" — never includes the invoiced archive. */
export const OPEN_STATUSES: readonly WorkOrderStatusCode[] = [1, 3, 5, 7, 8, 9, 12]

export const VIEW_STATUSES: Record<SavedViewKey, readonly WorkOrderStatusCode[] | null> = {
  open: OPEN_STATUSES,
  overdue: OPEN_STATUSES,
  awaiting_approval: [3],
  scheduled: [1, 5, 7, 8, 9, 12],
  completed: [2, 4],
  invoiced: [11],
  cancelled: [6],
  undispatched: [1],
  missing_wsib: OPEN_STATUSES,
  all: null,
}

export const VIEW_LABELS: Record<SavedViewKey, string> = {
  open: 'Open',
  overdue: 'Overdue',
  awaiting_approval: 'Awaiting approval',
  scheduled: 'Scheduled',
  completed: 'Completed',
  invoiced: 'Invoiced',
  cancelled: 'Cancelled',
  undispatched: 'Undispatched',
  missing_wsib: 'Missing WSIB',
  all: 'All',
}

/** The eight legacy pages that become saved views, plus All. */
export const DEFAULT_VIEW: SavedViewKey = 'open'
