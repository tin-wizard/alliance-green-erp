/** Pure RGA lifecycle rules. Raw codes are stored; labels are projections. */

export const RGA_TYPES = ['rga', 'credit', 'replacement'] as const
export type RgaType = (typeof RGA_TYPES)[number]

export const RGA_REPLACEMENT_TYPES = [
  'supplier',
  'subcontractor',
  'customer',
  'subcredit',
] as const
export type RgaReplacementType = (typeof RGA_REPLACEMENT_TYPES)[number]

export const RGA_STATUSES = [2, 3, 4, 6, 7, 10, 11] as const
export type RgaStatus = (typeof RGA_STATUSES)[number]

export const RGA_STATUS_LABELS: Record<RgaStatus, string> = {
  2: 'Active',
  3: 'Saved',
  4: 'Completed',
  6: 'Received',
  7: 'In Transit',
  10: 'Cancelled',
  11: 'Invoiced',
}

export const RGA_TYPE_LABELS: Record<RgaType, string> = {
  rga: 'Return goods authorization',
  credit: 'Credit request',
  replacement: 'Material replacement request',
}

export const TERMINAL_RGA_STATUSES: readonly RgaStatus[] = [4, 10, 11]

export function isRgaStatus(value: number): value is RgaStatus {
  return (RGA_STATUSES as readonly number[]).includes(value)
}

export function statusLabel(status: number): string {
  return isRgaStatus(status) ? RGA_STATUS_LABELS[status] : `Status ${status}`
}

export function isTerminal(status: number): boolean {
  return (TERMINAL_RGA_STATUSES as readonly number[]).includes(status)
}

/**
 * Legacy flow: 2 Active → 3 Saved → 7 In Transit → 6 Received → 4 Completed,
 * with 10 Cancelled from any non-terminal state. 11 Invoiced is reached only by
 * recording the credit, not by a manual transition.
 */
export function allowedNextStatuses(status: number): RgaStatus[] {
  if (isTerminal(status)) return []
  switch (status) {
    case 2:
      return [3, 10]
    case 3:
      return [7, 10]
    case 7:
      return [6, 10]
    case 6:
      return [4, 10]
    default:
      return []
  }
}

export function canApprove(status: number): boolean {
  return status === 2
}

export function canEdit(status: number): boolean {
  return status === 2 || status === 3
}

export function canRecordCredit(status: number, type: string): boolean {
  return type === 'credit' && (status === 3 || status === 6 || status === 4)
}

export function canCancel(status: number): boolean {
  return status === 2 || status === 3 || status === 7 || status === 6
}

export function isOpen(status: number): boolean {
  return status === 2 || status === 3 || status === 7 || status === 6
}

/** Display number. Legacy used `R-<id>`; nothing renumbers it. */
export function rgaNumber(id: number): string {
  return `R-${id}`
}

export function replacementTypeLabel(value: string | null): string | null {
  if (!value) return null
  const labels: Record<string, string> = {
    supplier: 'Return to supplier',
    subcontractor: 'Subcontractor replacement',
    customer: 'Customer replacement',
    subcredit: 'Subcontractor credit',
  }
  return labels[value] ?? value
}
