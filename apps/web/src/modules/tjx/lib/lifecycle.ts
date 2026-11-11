/**
 * TJX quote lifecycle and fixed code sets.
 *
 * The database stores the raw legacy codes. This file is the only projection
 * the UI and server use for labels and transitions. Status 2 (Saved) does not
 * exist for TJX and must never be introduced.
 */
export const TJX_QUOTE_STATUSES = [1, 3, 4, 5] as const
export type TjxQuoteStatus = (typeof TJX_QUOTE_STATUSES)[number]

export const TJX_STATUS_LABELS: Record<TjxQuoteStatus, string> = {
  1: 'In Progress',
  3: 'Waiting for Approval',
  4: 'Approved',
  5: 'Cancelled',
}

export const TJX_TERMINAL_STATUSES: readonly TjxQuoteStatus[] = [5]

export const TJX_GRID_TYPES = [1, 2, 3, 4] as const
export type TjxGridType = (typeof TJX_GRID_TYPES)[number]

export const TJX_GRID_LABELS: Record<TjxGridType, string> = {
  1: 'A',
  2: 'B',
  3: 'C',
  4: 'Highbay',
}

/** Code 2 is unused in the legacy lookup and is not a valid new choice. */
export const TJX_PAYMENT_TERMS = [1, 3, 4, 5] as const
export type TjxPaymentTerms = (typeof TJX_PAYMENT_TERMS)[number]

export const TJX_PAYMENT_TERM_LABELS: Record<TjxPaymentTerms, string> = {
  1: 'Due Upon Receipt',
  3: '15 Days',
  4: '30 Days',
  5: 'NET45',
}

export const TJX_QUOTE_TYPES = ['Gen 1', 'Gen 2'] as const
export type TjxQuoteType = (typeof TJX_QUOTE_TYPES)[number]

export function isTjxQuoteStatus(value: number): value is TjxQuoteStatus {
  return (TJX_QUOTE_STATUSES as readonly number[]).includes(value)
}

export function isTjxGridType(value: number): value is TjxGridType {
  return (TJX_GRID_TYPES as readonly number[]).includes(value)
}

export function isTjxPaymentTerms(value: number): value is TjxPaymentTerms {
  return (TJX_PAYMENT_TERMS as readonly number[]).includes(value)
}

export function statusLabel(status: number): string {
  return isTjxQuoteStatus(status) ? TJX_STATUS_LABELS[status] : `Unknown (${status})`
}

export function gridLabel(value: number | null | undefined): string | null {
  return value !== null && value !== undefined && isTjxGridType(value)
    ? TJX_GRID_LABELS[value]
    : null
}

export function paymentTermsLabel(value: number | null | undefined): string | null {
  return value !== null && value !== undefined && isTjxPaymentTerms(value)
    ? TJX_PAYMENT_TERM_LABELS[value]
    : null
}

export function allowedNextStatuses(status: TjxQuoteStatus): TjxQuoteStatus[] {
  switch (status) {
    case 1:
      return [3, 5]
    case 3:
      return [1, 4, 5]
    case 4:
      return [5]
    case 5:
      return []
  }
}

export function canEditQuote(status: number): boolean {
  return status === 1 || status === 3
}

export function canApproveQuote(status: number): boolean {
  return status === 3
}

export function canCancelQuote(status: number): boolean {
  return status === 1 || status === 3 || status === 4
}

export function isTerminalStatus(status: number): boolean {
  return isTjxQuoteStatus(status) && TJX_TERMINAL_STATUSES.includes(status)
}

export function quoteLabel(id: number): string {
  return `TJX-${id}`
}
