import type { QuoteKind, QuoteStatusCode } from '../types'

export interface QuoteCursor {
  createdAt: string
  id: number
}

export function encodeQuoteCursor(cursor: QuoteCursor): string {
  return globalThis
    .btoa(JSON.stringify({ c: cursor.createdAt, i: cursor.id }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export function decodeQuoteCursor(raw: string | null | undefined): QuoteCursor | null {
  if (!raw) return null
  try {
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/')
    const parsed = JSON.parse(
      globalThis.atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '=')),
    ) as { c?: unknown; i?: unknown }
    if (typeof parsed.c !== 'string' || typeof parsed.i !== 'number') return null
    return { createdAt: parsed.c, id: parsed.i }
  } catch {
    return null
  }
}

export interface QuoteListSearch {
  kind: QuoteKind | 'all'
  status: QuoteStatusCode | null
  q: string
  size: number
  cursor: string | null
}

export function parseQuoteSearch(search: Record<string, unknown>): QuoteListSearch {
  const kind =
    search.kind === 'customer' || search.kind === 'standalone' ? search.kind : 'all'
  const rawStatus = Number(search.status)
  const status = Number.isInteger(rawStatus) && rawStatus >= 1 && rawStatus <= 5
    ? (rawStatus as QuoteStatusCode)
    : null
  const sizeRaw = Number(search.size)
  const size = Number.isFinite(sizeRaw) && sizeRaw >= 10 && sizeRaw <= 100 ? sizeRaw : 25
  return {
    kind,
    status,
    q: typeof search.q === 'string' ? search.q.slice(0, 200) : '',
    size,
    cursor: typeof search.cursor === 'string' ? search.cursor : null,
  }
}
