/**
 * Work Orders module types.
 *
 * CLIENT SAFE. Nothing here imports a database driver or server module, so
 * components and `.functions.ts` wrappers can share the contract.
 */
import type { Status } from '@cls/core'

/** The 12 legacy `wo_status` codes, stored verbatim (BUSINESS-RULES C5). */
export type WorkOrderStatusCode = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12

export type WorkOrderSeries = 1 | 2

export type TriageFlag = 'red' | 'green' | 'critical'

export type SavedViewKey =
  | 'open'
  | 'overdue'
  | 'awaiting_approval'
  | 'scheduled'
  | 'completed'
  | 'invoiced'
  | 'cancelled'
  | 'undispatched'
  | 'missing_wsib'
  | 'all'

export type WorkOrderSort = 'newest' | 'oldest' | 'expected' | 'number'

export type WorkOrderPortal = 'office' | 'subcontractor' | 'technician'

export interface StatusProjection {
  code: WorkOrderStatusCode
  legacyLabel: string
  display: Status
  displayLabel: string
  flags: string[]
}

export interface WorkOrderListRow {
  id: number
  series: WorkOrderSeries
  status: WorkOrderStatusCode
  statusLabel: string
  displayStatus: Status
  displayLabel: string
  statusFlags: string[]
  siteId: number
  siteName: string | null
  siteCity: string | null
  siteProvince: string | null
  customerId: number | null
  customerName: string | null
  serviceTypeId: number
  serviceTypeName: string | null
  priorityId: number
  priorityName: string | null
  categoryId: number | null
  categoryName: string | null
  subcontractorId: number | null
  subcontractorName: string | null
  techName: string | null
  dateTaken: string
  expectedCompletion: string | null
  customerPo: string | null
  isLocal: boolean
  isProject: boolean
  isTjxQuote: boolean
  isPmaOrder: boolean
  triage: TriageFlag[]
  /** Last computed/working total, or null when no calculator has run. */
  totalAmount: string | null
  version: number
}

export type WorkOrderViewCounts = Record<SavedViewKey, number>

export interface WorkOrderListResult {
  rows: WorkOrderListRow[]
  view: SavedViewKey
  pageSize: number
  /** Cursor for the next page; null when the page is the last one. */
  nextCursor: string | null
  /** Count for the current filter set. Bounded by the view's status filter. */
  total: number
}

export interface WorkOrderListFilters {
  view: SavedViewKey
  search?: string
  series?: WorkOrderSeries
  status?: WorkOrderStatusCode
  priorityId?: number
  subcontractorId?: number
  siteId?: number
  sort: WorkOrderSort
  pageSize: number
  cursor?: string
}

export interface WorkOrderHourLine {
  id: number
  lineDate: string
  hours: string
  rateCode: number
  hourlyRate: string
  techUserId: string | null
  note: string | null
}

export interface WorkOrderPartLine {
  id: number
  partNo: string
  description: string | null
  qty: string
  price: string
}

export interface WorkOrderSpecialPartLine {
  id: number
  name: string
  qty: string
  price: string
  isEmergencyLighting: boolean
}

export interface LocalWorkOrderHourLine {
  id: number
  lineDate: string
  timeIn: string | null
  timeOut: string | null
  hours: string
  headcount: number
  techUserId: string | null
}

export interface LocalWorkOrderSignature {
  id: string
  signerName: string
  storageKey: string
  note: string | null
  capturedAt: string
}

export interface WorkOrderDocumentView {
  id: string
  kind: 'photo' | 'document' | 'signature' | 'service_report' | 'other'
  filename: string
  contentType: string | null
  sizeBytes: number | null
  caption: string | null
  uploadedAt: string
  /** Signed URL when the driver supports it; otherwise the module download URL. */
  url: string | null
}

export interface WorkOrderRevisionSummary {
  revisionId: number
  createdAt: string
  revisionType: string
  revisedByUserId: string | null
  isLastRevision: boolean
}

export interface WorkOrderRevisionDetail extends WorkOrderRevisionSummary {
  dataWorkorder: Record<string, JsonValue> | null
  dataWoHours: JsonValue[] | null
  dataWoLocalHours: JsonValue[] | null
  dataWoParts: JsonValue[] | null
  dataWoSoparts: JsonValue[] | null
  dataWoReport: Record<string, JsonValue> | null
  dataWoTax: Record<string, JsonValue> | null
  dataWoNotes: JsonValue[] | null
}

export interface WorkOrderNoteView {
  id: number
  title: string | null
  notes: string | null
  notesType: string
  previousStatus: number | null
  statusId: number | null
  isPublic: boolean
  createdAt: string
  actorLabel: string | null
}

/** JSON-safe values for anything that crosses a server-function boundary. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export interface WorkOrderActivityView {
  id: number
  action: string
  summary: string | null
  actorLabel: string | null
  actorRole: string | null
  createdAt: string
  before: JsonValue | null
  after: JsonValue | null
}

export interface WorkOrderAssignmentView {
  id: number
  techUserId: string | null
  techName: string | null
  subcontractorId: number | null
  subcontractorName: string | null
  role: string
  assignedAt: string
}

export interface WsibState {
  /** True when a valid (unexpired) WSIB/insurance document exists. */
  valid: boolean
  documentType: string | null
  expirationDate: string | null
  /** True when the actor holds `workorder:override_wsib_hold` for this vendor. */
  canOverride: boolean
  /** True when the actor used a scoped override on the last assignment. */
  overrideUsed: boolean
}

export interface WorkOrderCapabilities {
  canEdit: boolean
  canCapture: boolean
  canDispatch: boolean
  canApprove: boolean
  canManageRevisions: boolean
  /** `invoice.calculate`, checked on the server, never inferred from the UI. */
  canCalculateInvoice: boolean
  /** `workorder:override_wsib_hold` scoped to this subcontractor. */
  canOverrideWsib: boolean
}

export interface WorkOrderDetail {
  id: number
  series: WorkOrderSeries
  status: WorkOrderStatusCode
  statusProjection: StatusProjection
  siteId: number
  site: {
    id: number
    name: string
    street: string
    city: string
    province: string
    postalCode: string | null
    contactName: string | null
    contactNumber: string | null
    customerId: number | null
    customerName: string | null
  } | null
  subcontractor: { id: number; name: string } | null
  serviceTypeId: number
  serviceTypeName: string | null
  priorityId: number
  priorityName: string | null
  categoryId: number | null
  categoryName: string | null
  dateTaken: string
  expectedCompletion: string | null
  serviceRequired: string
  notes: string | null
  customerPo: string | null
  isLocal: boolean
  isProject: boolean
  isTjxQuote: boolean
  isPmaOrder: boolean
  triage: TriageFlag[]
  completedAt: string | null
  completionNote: string | null
  invoicedAt: string | null
  cancelledAt: string | null
  version: number
  createdAt: string
  updatedAt: string
  createdByLabel: string | null
  updatedByLabel: string | null
  tax: {
    taxProvince: string
    appliedTaxRate: string | null
    appliedTaxRatePst: string | null
    manualTaxAmount: string | null
    manualSubtotalAmount: string | null
    subtotalAmount: string | null
    taxTotal: string | null
    totalAmount: string | null
    computedAt: string | null
  }
  report: string
  hours: WorkOrderHourLine[]
  parts: WorkOrderPartLine[]
  specialParts: WorkOrderSpecialPartLine[]
  localHours: LocalWorkOrderHourLine[]
  signatures: LocalWorkOrderSignature[]
  documents: WorkOrderDocumentView[]
  revisions: WorkOrderRevisionSummary[]
  /** Status/notes history. The header's free-text `notes` field is separate. */
  noteHistory: WorkOrderNoteView[]
  activity: WorkOrderActivityView[]
  assignments: WorkOrderAssignmentView[]
  wsib: WsibState
  capabilities: WorkOrderCapabilities
}

export interface WorkOrderCreateInput {
  series?: WorkOrderSeries
  siteId: number
  serviceTypeId: number
  priorityId: number
  categoryId?: number | null
  expectedCompletion?: string | null
  serviceRequired: string
  notes?: string | null
  subcontractorId?: number | null
  securityCode?: string | null
  customerPo?: string | null
  isLocal?: boolean
  isProject?: boolean
  isTjxQuote?: boolean
  isPmaOrder?: boolean
  dateTaken?: string | null
  /** Required when assigning a subcontractor without valid WSIB. */
  wsibOverride?: boolean
}

export interface WorkOrderUpdateInput {
  id: number
  version: number
  siteId?: number
  serviceTypeId?: number
  priorityId?: number
  categoryId?: number | null
  expectedCompletion?: string | null
  serviceRequired?: string
  notes?: string | null
  subcontractorId?: number | null
  securityCode?: string | null
  customerPo?: string | null
  isLocal?: boolean
  isProject?: boolean
  isTjxQuote?: boolean
  isPmaOrder?: boolean
  dateTaken?: string
  wsibOverride?: boolean
}

export interface WorkOrderTransitionInput {
  id: number
  version: number
  to: WorkOrderStatusCode
  note?: string | null
  /** Required by dispatch/approval where the brief demands a precondition. */
  subcontractorId?: number | null
  wsibOverride?: boolean
}

export interface CaptureHoursInput {
  workOrderId: number
  lines: Array<{
    lineDate: string
    hours: string
    rateCode?: number
    hourlyRate: string
    techUserId?: string | null
    note?: string | null
  }>
}
export interface CapturePartsInput {
  workOrderId: number
  lines: Array<{
    partNo: string
    description?: string | null
    qty: string
    price: string
  }>
}
export interface CaptureSpecialPartsInput {
  workOrderId: number
  lines: Array<{
    name: string
    qty: string
    price: string
    isEmergencyLighting?: boolean
  }>
}
export interface CaptureReportInput {
  workOrderId: number
  report: string
}
export interface CaptureLocalHoursInput {
  workOrderId: number
  lines: Array<{
    lineDate: string
    timeIn?: string | null
    timeOut?: string | null
    hours: string
    headcount: number
    techUserId?: string | null
  }>
}
export interface SignatureInput {
  workOrderId: number
  signerName: string
  note?: string | null
  /** Base64 payload; the server stores it through `packages/storage`. */
  dataBase64: string
  contentType: string
}
export interface DocumentUploadInput {
  workOrderId: number
  kind: 'photo' | 'document' | 'service_report' | 'other'
  filename: string
  contentType: string
  caption?: string | null
  dataBase64: string
}

export interface TriageInput {
  id: number
  version: number
  flags: TriageFlag[]
}

export interface BulkUpdateInput {
  ids: number[]
  change:
    | { kind: 'priority'; priorityId: number }
    | { kind: 'assign_subcontractor'; subcontractorId: number | null; wsibOverride?: boolean }
    | { kind: 'status'; to: WorkOrderStatusCode; note?: string | null }
}
export interface BulkUpdateResult {
  updated: number[]
  rejected: Array<{ id: number; reason: string }>
}

export interface LookupOption {
  id: number
  label: string
  detail?: string | null
}

export interface SiteLookupOption {
  id: number
  name: string
  street: string
  city: string
  province: string
  postalCode: string | null
  customerId: number
  customerName: string
}

export interface SubcontractorLookupOption {
  id: number
  name: string
  city: string | null
  province: string | null
  email: string | null
  wsibValid: boolean
  wsibExpirationDate: string | null
}

export interface PartLookupOption {
  partNo: string
  description: string
  price: string | null
}

export interface TechnicianLookupOption {
  id: string
  displayName: string
  email: string
}

/* ------------------------------------------------------------------ *
 * Invoice-ready snapshot                                              *
 * ------------------------------------------------------------------ */

export type CalcType = 'sub' | 'sub_project' | 'local' | 'local_project'

export interface InvoiceReadyLabourLine {
  date: string
  hours: string
  rateCode: number
  hourlyRate: string
  amount: string
}

export interface InvoiceReadyPartLine {
  partNo: string
  description: string | null
  qty: string
  price: string
  amount: string
}

export interface InvoiceReadySpecialPartLine {
  name: string
  qty: string
  price: string
  amount: string
}

export interface InvoiceReadyTotals {
  labour: string
  material: string
  subtotal: string
  tax: string
  total: string
}

/**
 * The contract the Invoicing module consumes. Inputs are always present;
 * `totals` is null when the caller lacks `invoice.calculate`, so money is not
 * merely hidden in the UI but withheld by the server.
 */
export interface InvoiceReadySnapshot {
  workOrderId: number
  workOrderNumber: number
  series: WorkOrderSeries
  calcType: CalcType
  customerId: number | null
  siteId: number
  customerPo: string | null
  workOrderDate: string
  completionDate: string | null
  taxProvince: string
  appliedTaxRate: string | null
  appliedTaxRatePst: string | null
  manualTaxAmount: string | null
  manualSubtotalAmount: string | null
  labour: InvoiceReadyLabourLine[]
  parts: InvoiceReadyPartLine[]
  specialParts: InvoiceReadySpecialPartLine[]
  totals: InvoiceReadyTotals | null
  totalsWithheldReason: 'invoice.calculate' | null
  /** Set when the calculator refused (for example, no labour lines yet). */
  calculationError: string | null
  legacyCentCorrectionApplied: boolean
  /** True when Sage sales or stock posting flags lock the invoice (B3). */
  immutable: boolean
  generatedAt: string
}
