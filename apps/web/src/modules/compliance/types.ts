/** Compliance screen vocabulary. Validity follows the Work Orders gate. */
export const COMPLIANCE_WINDOWS = [30, 14, 7, 1, 0] as const

export type ComplianceState = 'valid' | 'expiring' | 'expired' | 'missing'

export interface ComplianceDocumentView {
  id: string
  kind: 'wsib' | 'insurance'
  fileName: string | null
  documentType: string | null
  expiresOn: string | null
  daysRemaining: number | null
  state: ComplianceState
  /** Nearest reminder window Master Data will fire, or null when beyond 30 days. */
  window: (typeof COMPLIANCE_WINDOWS)[number] | null
}

export interface SubcontractorComplianceView {
  id: number
  name: string
  province: string | null
  isActive: boolean
  wsib: ComplianceDocumentView | null
  insurance: ComplianceDocumentView | null
  /** The assignment gate accepts a valid WSIB *or* insurance document. */
  gateValid: boolean
  openWorkOrders: number
}

export interface ExpiryRow {
  kind: 'wsib' | 'insurance'
  subcontractorId: number
  subcontractor: string
  fileName: string | null
  expiresOn: string
  daysRemaining: number
  state: ComplianceState
  window: number | null
}

export interface MissingWsibWorkOrder {
  id: number
  site: string
  customer: string
  subcontractorId: number
  subcontractor: string
  status: number
  statusLabel: string
  dateTaken: string
}

export interface OverrideGrant {
  userId: string
  user: string
  email: string
  scopeSubcontractorId: number | null
  scopeSubcontractor: string | null
  note: string | null
  grantedAt: string
  expiresAt: string | null
}

export interface OverrideUse {
  id: number
  action: string
  entityId: string | null
  actor: string
  reason: string
  createdAt: string
}

export interface WarrantyRow {
  id: string
  siteId: number
  site: string
  customer: string
  description: string | null
  expiresOn: string
  daysRemaining: number
  state: ComplianceState
  workOrderId: number | null
}

export interface ComplianceOverview {
  today: string
  totals: {
    activeSubcontractors: number
    gateBlocked: number
    missingWsib: number
    missingInsurance: number
    expiring30: number
    expired: number
    openWorkOrdersBlocked: number
    warrantyExpiring30: number
    warrantyExpired: number
  }
  subcontractors: SubcontractorComplianceView[]
  expiries: ExpiryRow[]
  missingWsibWorkOrders: MissingWsibWorkOrder[]
  overrideGrants: OverrideGrant[]
  overrideUses: OverrideUse[]
  warranties: WarrantyRow[]
}
