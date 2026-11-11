import type { QuoteKind, QuoteStatusView, QuoteStatusCode } from '../types'

/**
 * Legacy quote lifecycle (BUSINESS-RULES H1).
 *
 * 1 In progress, 2 Saved (standalone only), 3 Waiting for approval,
 * 4 Approved, 5 Cancelled. Approval is the only transition that stamps
 * `date_approved`; 4 and 5 are terminal for the row — a revision creates a new
 * row instead of moving an issued quote.
 */
export const QUOTE_STATUS_LABELS: Record<QuoteStatusCode, string> = {
  1: 'In Progress',
  2: 'Saved',
  3: 'Waiting for approval',
  4: 'Approved',
  5: 'Cancelled',
}

const TONES: Record<QuoteStatusCode, QuoteStatusView['tone']> = {
  1: 'neutral',
  2: 'neutral',
  3: 'warning',
  4: 'success',
  5: 'danger',
}

export function quoteStatusView(code: QuoteStatusCode): QuoteStatusView {
  return { code, label: QUOTE_STATUS_LABELS[code], tone: TONES[code] }
}

export function isQuoteStatusCode(value: number): value is QuoteStatusCode {
  return Number.isInteger(value) && value >= 1 && value <= 5
}

export const ALLOWED_TRANSITIONS: Record<QuoteStatusCode, readonly QuoteStatusCode[]> = {
  1: [2, 3, 5],
  2: [1, 3, 5],
  3: [4, 5],
  4: [],
  5: [],
}

export const TERMINAL_QUOTE_STATUSES: readonly QuoteStatusCode[] = [4, 5]

export function isTerminalQuoteStatus(code: QuoteStatusCode): boolean {
  return TERMINAL_QUOTE_STATUSES.includes(code)
}

export function allowedNextQuoteStatuses(
  from: QuoteStatusCode,
  kind: QuoteKind,
): readonly QuoteStatusCode[] {
  return (ALLOWED_TRANSITIONS[from] ?? []).filter(
    (to) => to !== 2 || kind === 'standalone',
  )
}

export function canTransitionQuote(
  from: QuoteStatusCode,
  to: QuoteStatusCode,
  kind: QuoteKind,
): boolean {
  return allowedNextQuoteStatuses(from, kind).includes(to)
}

/** Permission key required for a target status. */
export function quoteTransitionPermission(
  to: QuoteStatusCode,
): 'quote:write' | 'quote:approve' {
  return to === 4 ? 'quote:approve' : 'quote:write'
}

export function illegalQuoteTransitionMessage(
  from: QuoteStatusCode,
  to: QuoteStatusCode,
  kind: QuoteKind,
): string {
  const allowed = allowedNextQuoteStatuses(from, kind)
  const next = allowed.length
    ? allowed.map((code) => QUOTE_STATUS_LABELS[code]).join(', ')
    : 'none — issue a revision to change an issued quote'
  return `Illegal quote status change: ${QUOTE_STATUS_LABELS[from]} → ${QUOTE_STATUS_LABELS[to]}. Allowed next: ${next}.`
}

export function quoteNumberLabel(
  kind: QuoteKind,
  id: number,
  workOrderNumber: number | null,
): string {
  if (kind === 'customer' && workOrderNumber) return String(workOrderNumber)
  return String(id)
}
