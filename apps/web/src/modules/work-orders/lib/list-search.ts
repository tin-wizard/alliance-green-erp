/**
 * URL search parsing for the work-order list. The URL is the state: copying it
 * reproduces the view (APP-SHELL-AND-PATTERNS §3).
 */
import type { SavedViewKey, WorkOrderSort } from '../types'

export interface WorkOrderListSearch {
  view: SavedViewKey
  q?: string
  sort: WorkOrderSort
  size: number
  cursor?: string
  status?: number
  priority?: number
  sub?: number
}

const VIEWS: SavedViewKey[] = [
  'open',
  'overdue',
  'awaiting_approval',
  'scheduled',
  'completed',
  'invoiced',
  'cancelled',
  'undispatched',
  'missing_wsib',
  'all',
]

const SORTS: WorkOrderSort[] = ['newest', 'oldest', 'expected', 'number']

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function integer(value: unknown, min: number, max: number): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return undefined
  return parsed
}

export function parseListSearch(raw: Record<string, unknown>): WorkOrderListSearch {
  const view = VIEWS.includes(raw.view as SavedViewKey)
    ? (raw.view as SavedViewKey)
    : 'open'
  const sort = SORTS.includes(raw.sort as WorkOrderSort)
    ? (raw.sort as WorkOrderSort)
    : 'newest'
  return {
    view,
    ...(text(raw.q) ? { q: text(raw.q) } : {}),
    sort,
    size: integer(raw.size, 1, 100) ?? 25,
    ...(text(raw.cursor) ? { cursor: text(raw.cursor) } : {}),
    ...(integer(raw.status, 1, 12) ? { status: integer(raw.status, 1, 12) } : {}),
    ...(integer(raw.priority, 1, 20) ? { priority: integer(raw.priority, 1, 20) } : {}),
    ...(integer(raw.sub, 1, 2_000_000_000) ? { sub: integer(raw.sub, 1, 2_000_000_000) } : {}),
  }
}
