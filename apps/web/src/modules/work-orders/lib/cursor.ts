/**
 * Opaque keyset cursor for the work-order list.
 *
 * The archive is ~42k rows and 95% invoiced; offset pagination would scan the
 * archive. The cursor encodes the sort key and id of the last row on the page.
 * CLIENT SAFE: the browser only passes the string back.
 */
import type { WorkOrderSort } from '../types'

export interface ListCursor {
  sort: WorkOrderSort
  /** Sort value: dateTaken for newest/oldest, expectedCompletion for expected. */
  value: string | null
  id: number
}

export function encodeCursor(cursor: ListCursor): string {
  const json = JSON.stringify({ s: cursor.sort, v: cursor.value, i: cursor.id })
  return globalThis.btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeCursor(raw: string | null | undefined): ListCursor | null {
  if (!raw) return null
  try {
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/')
    const json = globalThis.atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
    const parsed = JSON.parse(json) as { s?: unknown; v?: unknown; i?: unknown }
    if (
      (parsed.s !== 'newest' &&
        parsed.s !== 'oldest' &&
        parsed.s !== 'expected' &&
        parsed.s !== 'number') ||
      (parsed.v !== null && typeof parsed.v !== 'string') ||
      typeof parsed.i !== 'number'
    ) {
      return null
    }
    return { sort: parsed.s, value: parsed.v, id: parsed.i }
  } catch {
    return null
  }
}
