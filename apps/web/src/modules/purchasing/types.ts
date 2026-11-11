/** Purchasing view and input types shared by server functions and components. */

export const PO_STATUSES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const
export type PurchaseOrderStatus = (typeof PO_STATUSES)[number]

export const PO_INVOICE_STATUSES = ['draft', 'pending_receipt', 'matched', 'posted', 'void'] as const
export type PurchaseOrderInvoiceStatus = (typeof PO_INVOICE_STATUSES)[number]

export interface PurchaseOrderLineView {
  id: number
  partNo: string
  description: string | null
  qty: string
  qtyReceived: string
  price: string
  lineTotal: string
  itemPurchaseType: string | null
  itemPurchaseTypeNumber: string | null
}

export interface PurchaseOrderSpecialLineView {
  id: number
  name: string
  qty: string
  qtyReceived: string
  price: string
  lineTotal: string
  itemPurchaseType: string | null
  itemPurchaseTypeNumber: string | null
}

export interface PurchaseOrderReceiptView {
  id: number
  receivedOn: string
  receivedBy: string | null
  notes: string | null
  stockPostedAt: string | null
  lines: Array<{
    id: number
    partNo: string | null
    name: string | null
    qty: string
    overReceivedQty: string
  }>
}

export interface PurchaseOrderInvoiceView {
  id: number
  supplierInvoiceNumber: string
  invoiceDate: string
  subtotal: string
  tax: string
  freight: string
  total: string
  status: PurchaseOrderInvoiceStatus
  variance: string
  varianceDetail: string | null
  acceptedVarianceReason: string | null
  postedAt: string | null
  sageReference: string | null
}

export interface PurchaseOrderStatusEvent {
  id: number
  fromStatus: number | null
  toStatus: number
  action: string
  actorLabel: string | null
  poVersion: number
  selfApproved: boolean
  note: string | null
  createdAt: string
}

export interface PurchaseOrderListRow {
  id: number
  displayNumber: string | null
  status: PurchaseOrderStatus
  supplierName: string
  expectedDelivery: string | null
  total: string
  createdAt: string
  isTransfer: boolean
  approvalRequestBy: string | null
}

export interface PurchaseOrderListResult {
  rows: PurchaseOrderListRow[]
  total: number
  nextCursor: string | null
}

export interface PurchaseOrderDetail {
  id: number
  displayNumber: string
  status: PurchaseOrderStatus
  supplierId: number
  supplierName: string
  subSupplierId: number | null
  priorityId: number | null
  shipmentType: string
  shipContact: string | null
  shipCompany: string | null
  shipStreet1: string | null
  shipStreet2: string | null
  shipCity: string | null
  shipProvince: string | null
  shipPostalCode: string | null
  shipPhone: string | null
  expectedDelivery: string | null
  supplierNotes: string | null
  notes: string | null
  fob: string | null
  payTerms: string | null
  shipVia: string | null
  trackingId: string | null
  taxCode: string | null
  appliedTaxRate: string | null
  subtotal: string
  tax: string
  total: string
  isApproved: boolean
  approvalRequestBy: string | null
  approvedBy: string | null
  approvedAt: string | null
  approvalRevision: number | null
  selfApproved: boolean
  poSubmittedBy: string | null
  submittedAt: string | null
  cancelledAt: string | null
  cancelledReason: string | null
  closedShort: boolean
  shortCloseReason: string | null
  stockPostedAt: string | null
  isTransfer: boolean
  transferFromPoId: number | null
  version: number
  createdAt: string
  updatedAt: string
  lines: PurchaseOrderLineView[]
  specialLines: PurchaseOrderSpecialLineView[]
  receipts: PurchaseOrderReceiptView[]
  invoices: PurchaseOrderInvoiceView[]
  statusHistory: PurchaseOrderStatusEvent[]
  capabilities: PurchaseOrderCapabilities
}

export interface PurchaseOrderCapabilities {
  canEdit: boolean
  canRequestApproval: boolean
  canApprove: boolean
  canChallenge: boolean
  canIssue: boolean
  canReceive: boolean
  canShortClose: boolean
  canCancel: boolean
  canInvoice: boolean
  canCloseInvoice: boolean
}

export interface PurchaseOrderLineInput {
  partNo: string
  description?: string | null
  qty: string
  price: string
  itemPurchaseType?: string | null
  itemPurchaseTypeNumber?: string | null
}

export interface PurchaseOrderSpecialLineInput {
  name: string
  qty: string
  price: string
  itemPurchaseType?: string | null
  itemPurchaseTypeNumber?: string | null
}

export interface PurchaseOrderCreateInput {
  supplierId: number
  subSupplierId?: number | null
  priorityId?: number | null
  shipmentType: string
  shipContact?: string | null
  shipCompany?: string | null
  shipStreet1?: string | null
  shipStreet2?: string | null
  shipCity?: string | null
  shipProvince?: string | null
  shipPostalCode?: string | null
  shipPhone?: string | null
  expectedDelivery?: string | null
  supplierNotes?: string | null
  notes?: string | null
  fob?: string | null
  payTerms?: string | null
  shipVia?: string | null
  taxCode?: string | null
  appliedTaxRate?: string | null
  isTransfer?: boolean
  transferFromPoId?: number | null
  preorderId?: number | null
  rfqId?: number | null
  supplierQuoteId?: number | null
  parts: PurchaseOrderLineInput[]
  specialParts: PurchaseOrderSpecialLineInput[]
}

export interface PurchaseOrderUpdateInput extends PurchaseOrderCreateInput {
  id: number
  version: number
}

export interface PurchaseOrderTransitionInput {
  id: number
  version: number
  to: PurchaseOrderStatus
  reason?: string | null
}

export interface PurchaseOrderReceiptLineInput {
  partLineId?: number | null
  specialPartLineId?: number | null
  qty: string
  note?: string | null
}

export interface PurchaseOrderReceiptInput {
  id: number
  version: number
  idempotencyKey: string
  receivedOn?: string | null
  carrier?: string | null
  trackingId?: string | null
  notes?: string | null
  allowOverReceipt?: boolean
  allowOverReceiptReason?: string | null
  lines: PurchaseOrderReceiptLineInput[]
}

export interface PurchaseOrderInvoiceLineInput {
  partLineId?: number | null
  specialPartLineId?: number | null
  qty: string
  unitPrice: string
  taxAmount?: string | null
}

export interface PurchaseOrderInvoiceInput {
  id: number
  supplierInvoiceNumber: string
  invoiceDate: string
  taxCode?: string | null
  appliedTaxRate?: string | null
  taxHst?: string | null
  taxGst?: string | null
  taxPst?: string | null
  taxTvp?: string | null
  freight?: string | null
  lines: PurchaseOrderInvoiceLineInput[]
}

export interface PurchaseOrderInvoiceCloseInput {
  id: number
  invoiceId: number
  acceptVarianceReason?: string | null
}

export interface SupplierCreditLineInput {
  description: string
  /** `purchase_order_parts.id`; required when the source is an RGA reference. */
  partId?: number | null
  /** Negative: a credit reduces the invoiced quantity. */
  qty: string
  rate: string
  taxRate: string
}

/**
 * A supplier credit is a supplier-invoice-shaped document with negative
 * quantities. The source names either the corrected PO or the RGA it settles;
 * an RGA-sourced credit derives its PO from the part lines it corrects.
 */
export interface CreateSupplierCreditInput {
  source: { purchaseOrderId: number } | { rgaReference: string }
  supplierId: number
  creditDate: string
  /** No AP ledger exists in purchasing; the id is carried on the audit payload. */
  apAccountId?: string | null
  reference?: string | null
  lines: SupplierCreditLineInput[]
}

export interface SupplierPoRow {
  id: number
  displayNumber: string
  status: PurchaseOrderStatus
  total: string
  expectedDelivery: string | null
}
