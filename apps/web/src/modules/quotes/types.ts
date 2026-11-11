export type QuoteKind = 'customer' | 'standalone'

/** Legacy `customer_quote_status` / `standalone_quote_status`. */
export type QuoteStatusCode = 1 | 2 | 3 | 4 | 5

export type QuoteStatusView = {
  code: QuoteStatusCode
  label: string
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
}

export type QuoteLineKind = 'labour' | 'part' | 'special'

export interface QuoteHourLine {
  id: number
  lineDate: string | null
  hours: string
  numTechs: number
  rateCode: string | null
  rate: string
  incurredHours: string | null
  incurredRate: string | null
  note: string | null
  sortOrder: number
}

export interface QuotePartLine {
  id: number
  partNo: string
  description: string | null
  qty: number
  price: string
  costPrice: string | null
  isUnderWarranty: boolean
  sortOrder: number
}

export interface QuoteSpecialLine {
  id: number
  name: string
  qty: number
  price: string
  costPrice: string | null
  isEmergencyLighting: boolean
  sortOrder: number
}

export interface QuoteTotalsView {
  labour: string
  material: string
  subtotal: string
  tax: string
  total: string
  taxProvince: string
  taxRate: string
  appliedManualTax: boolean
  incurredLabour: string
  incurredMaterial: string
  incurredSubtotal: string
  margin: string
  marginPercent: string
}

export interface QuoteListRow {
  id: number
  kind: QuoteKind
  numberLabel: string
  workOrderNumber: number | null
  status: QuoteStatusCode
  statusLabel: string
  siteId: number
  siteName: string | null
  customerName: string | null
  province: string | null
  revisionId: string
  isRevision: boolean
  isLastRevision: boolean
  isDeleted: boolean
  dueDate: string | null
  isDueDateTbd: boolean
  dateApproved: string | null
  createdAt: string
  total: string | null
}

export interface QuoteListResult {
  rows: QuoteListRow[]
  nextCursor: string | null
  total: number
}

export interface QuoteListFilters {
  kind?: QuoteKind | 'all'
  status?: QuoteStatusCode
  search?: string
  cursor?: string | null
  size?: number
}

export interface QuoteDetail {
  id: number
  kind: QuoteKind
  numberLabel: string
  workOrderNumber: number | null
  status: QuoteStatusCode
  statusView: QuoteStatusView
  siteId: number
  siteName: string | null
  customerId: number | null
  customerName: string | null
  shipContact: string | null
  shipStreet1: string | null
  shipStreet2: string | null
  shipCity: string | null
  shipProvince: string | null
  shipPostalCode: string | null
  isAddressUpdated: boolean
  report: string
  notes: string
  pdfNotes: string | null
  paymentTermsId: number | null
  taxCode: string
  appliedTaxRate: string | null
  manualTaxAmount: string | null
  dueDate: string | null
  isDueDateTbd: boolean
  dateApproved: string | null
  dateCreated: string
  isRevision: boolean
  revisionQuoteId: number | null
  rootQuoteId: number | null
  revisionId: string
  isLastRevision: boolean
  isDeleted: boolean
  createdFromLocal: boolean
  referenceWoNumber: string | null
  convertedWorkOrderId: number | null
  version: number
  createdAt: string
  updatedAt: string
  hours: QuoteHourLine[]
  parts: QuotePartLine[]
  specialParts: QuoteSpecialLine[]
  totals: QuoteTotalsView
  rejections: QuoteRejectionView[]
  packingSlips: QuotePackingSlipView[]
  revisions: QuoteRevisionLink[]
  capabilities: QuoteCapabilities
}

export interface QuoteRejectionView {
  id: number
  reason: string | null
  rejectedByDetail: string | null
  rejectedAt: string
}

export interface QuoteRevisionLink {
  id: number
  revisionId: string
  isRevision: boolean
  isLastRevision: boolean
  status: QuoteStatusCode
  createdAt: string
}

export interface QuotePackingSlipView {
  id: number
  dateCreated: string
  shipDate: string | null
  packingSlipLevel: number
  notes: string | null
}

export interface QuoteCapabilities {
  canEdit: boolean
  canSubmit: boolean
  canApprove: boolean
  canRevise: boolean
  canConvert: boolean
  canDelete: boolean
  canRender: boolean
}

export interface QuoteLineInput {
  hours?: string
  numTechs?: number
  rate?: string
  incurredHours?: string | null
  incurredRate?: string | null
  note?: string | null
  lineDate?: string | null
  rateCode?: string | null
}

export interface QuotePartInput {
  partNo: string
  description?: string | null
  qty: number
  price: string
  costPrice?: string | null
  isUnderWarranty?: boolean
}

export interface QuoteSpecialInput {
  name: string
  qty: number
  price: string
  costPrice?: string | null
  isEmergencyLighting?: boolean
}

export interface QuoteCreateInput {
  kind: QuoteKind
  siteId: number
  workOrderNumber?: number | null
  shipContact?: string | null
  shipStreet1?: string | null
  shipStreet2?: string | null
  shipCity?: string | null
  shipProvince?: string | null
  shipPostalCode?: string | null
  report?: string
  notes?: string
  pdfNotes?: string | null
  paymentTermsId?: number | null
  taxCode?: string | null
  appliedTaxRate?: string | null
  manualTaxAmount?: string | null
  dueDate?: string | null
  isDueDateTbd?: boolean
  referenceWoNumber?: string | null
  createdFromLocal?: boolean
  saveAsSaved?: boolean
  hours: QuoteLineInput[]
  parts: QuotePartInput[]
  specialParts: QuoteSpecialInput[]
}

export interface QuoteUpdateInput extends Omit<QuoteCreateInput, 'kind'> {
  id: number
  version: number
}

export interface QuoteTransitionInput {
  id: number
  version: number
  to: QuoteStatusCode
  note?: string | null
}

export interface QuoteRejectInput {
  id: number
  version: number
  reason: string
  rejectedByDetail?: string | null
}

export interface QuoteReviseInput {
  id: number
  reason?: string | null
}

export interface QuotePackingInput {
  quoteId: number
  shipDate?: string | null
  notes?: string | null
  parts: Array<{ quotePartId?: number; partNo: string; actualQty: number; shippedQty: number; backorderQty: number }>
  specialParts: Array<{ quoteSpecialPartId?: number; name: string; actualQty: number; shippedQty: number; backorderQty: number }>
}

export interface QuotePdfResult {
  documentId: string
  url: string | null
  sha256: string
  byteSize: number
  pageCount: number | null
}

export interface GeneratedDocumentView {
  id: string
  kind: string
  schemaVersion: number
  sha256: string
  byteSize: number
  pageCount: number | null
  createdAt: string
  url: string | null
}
