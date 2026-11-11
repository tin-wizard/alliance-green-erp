/**
 * Sales-invoice lifecycle (BUSINESS-RULES B1-B3).
 *
 * Pure decisions only. The server applies them inside its transaction. An
 * invoice is immutable once a stock posting is recorded or Sage has accepted /
 * may have accepted the document; a customer rejection of an unposted invoice
 * returns it to draft for a new snapshot.
 */
export const SALES_INVOICE_STATUSES = [
  'draft',
  'issued',
  'rejected',
  'partially_paid',
  'paid',
  'cancelled',
] as const

export type SalesInvoiceStatus = (typeof SALES_INVOICE_STATUSES)[number]

export const INVOICE_STATUS_LABELS: Record<SalesInvoiceStatus, string> = {
  draft: 'Draft',
  issued: 'Issued',
  rejected: 'Rejected',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  cancelled: 'Cancelled',
}

export interface ImmutabilityInput {
  /** Work Orders legacy flags: sage sales, stock or portal stock posted. */
  workOrderFlags: {
    sageSalesDone: boolean
    stockUpdated: boolean
    onlyPortalStockUpdated: boolean
  }
  /** A stock posting record exists with status `posted`. */
  stockPosted: boolean
  /** Sage posting status from `sage_postings`; null when no row exists. */
  sageStatus: string | null
}

export interface ImmutabilityResult {
  immutable: boolean
  reason: string | null
}

export function invoiceImmutability(input: ImmutabilityInput): ImmutabilityResult {
  if (input.stockPosted) {
    return { immutable: true, reason: 'Stock has been posted for this invoice.' }
  }
  if (input.sageStatus === 'sent' || input.sageStatus === 'unknown') {
    return { immutable: true, reason: 'Sage has accepted (or may have accepted) this invoice.' }
  }
  if (input.workOrderFlags.sageSalesDone) {
    return { immutable: true, reason: 'The work order is marked Sage-posted.' }
  }
  if (input.workOrderFlags.stockUpdated || input.workOrderFlags.onlyPortalStockUpdated) {
    return { immutable: true, reason: 'The work order is marked stock-posted.' }
  }
  return { immutable: false, reason: null }
}

export function canEditInvoice(status: SalesInvoiceStatus, immutable: boolean): boolean {
  if (immutable) return false
  return status === 'draft' || status === 'rejected'
}

export function canIssueInvoice(status: SalesInvoiceStatus, immutable: boolean): boolean {
  return !immutable && status === 'draft'
}

export function canRejectInvoice(status: SalesInvoiceStatus, paidAmount: string): boolean {
  return status === 'issued' && paidAmount === '0.00'
}

export function canRecordPayment(status: SalesInvoiceStatus): boolean {
  return status === 'issued' || status === 'partially_paid'
}

export function paymentStatus(total: string, paid: string): SalesInvoiceStatus {
  const totalValue = Number(total)
  const paidValue = Number(paid)
  if (!Number.isFinite(totalValue) || !Number.isFinite(paidValue)) return 'issued'
  if (paidValue <= 0) return 'issued'
  if (paidValue + 0.005 >= totalValue) return 'paid'
  return 'partially_paid'
}

export const SUBCONTRACTOR_INVOICE_STATUSES = [
  'submitted',
  'approved',
  'rejected',
  'partially_paid',
  'paid',
  'cancelled',
] as const

export type SubcontractorInvoiceStatus = (typeof SUBCONTRACTOR_INVOICE_STATUSES)[number]

export const SUB_INVOICE_STATUS_LABELS: Record<SubcontractorInvoiceStatus, string> = {
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  cancelled: 'Cancelled',
}
