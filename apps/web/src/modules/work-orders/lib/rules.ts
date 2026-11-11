/**
 * Pure work-order business rules (MODULE-CONTRACT §1.7).
 *
 * Components and server functions orchestrate; the rules live here and are
 * unit-tested. No database, no React.
 */
import type {
  CalcType,
  SavedViewKey,
  TriageFlag,
  WorkOrderStatusCode,
} from '../types'
import { OPEN_STATUSES, VIEW_STATUSES, isTerminal } from './status'

export function isOpen(code: WorkOrderStatusCode): boolean {
  return OPEN_STATUSES.includes(code)
}

export function isOverdue(
  code: WorkOrderStatusCode,
  expectedCompletion: string | null | undefined,
  today: string,
): boolean {
  if (!isOpen(code) || !expectedCompletion) return false
  return expectedCompletion.slice(0, 10) < today.slice(0, 10)
}

export function isScheduled(
  code: WorkOrderStatusCode,
  expectedCompletion: string | null | undefined,
): boolean {
  return isOpen(code) && Boolean(expectedCompletion)
}

export function matchesView(
  view: SavedViewKey,
  workOrder: {
    status: WorkOrderStatusCode
    expectedCompletion: string | null
    subcontractorId: number | null
    wsibValid: boolean
  },
  today: string,
): boolean {
  const statuses = VIEW_STATUSES[view]
  if (statuses && !statuses.includes(workOrder.status)) return false
  switch (view) {
    case 'overdue':
      return isOverdue(workOrder.status, workOrder.expectedCompletion, today)
    case 'awaiting_approval':
      return workOrder.status === 3
    case 'scheduled':
      return isScheduled(workOrder.status, workOrder.expectedCompletion)
    case 'undispatched':
      return workOrder.status === 1
    case 'missing_wsib':
      return workOrder.subcontractorId !== null && !workOrder.wsibValid
    default:
      return true
  }
}

/** Triage flags are independent of status (brief §4). */
export function triageFromColumns(row: {
  isMarkedRed: boolean
  isMarkedGreen: boolean
  isMarkedCritical: boolean
}): TriageFlag[] {
  const flags: TriageFlag[] = []
  if (row.isMarkedRed) flags.push('red')
  if (row.isMarkedGreen) flags.push('green')
  if (row.isMarkedCritical) flags.push('critical')
  return flags
}

export function triageColumns(flags: readonly TriageFlag[]): {
  isMarkedRed: boolean
  isMarkedGreen: boolean
  isMarkedCritical: boolean
} {
  return {
    isMarkedRed: flags.includes('red'),
    isMarkedGreen: flags.includes('green'),
    isMarkedCritical: flags.includes('critical'),
  }
}

export const TRIAGE_LABELS: Record<TriageFlag, string> = {
  red: 'Red',
  green: 'Green',
  critical: 'Critical',
}

/* ------------------------------------------------------------------ *
 * WSIB / insurance gate (BUSINESS-RULES G6)                           *
 * ------------------------------------------------------------------ */

export interface WsibDocument {
  documentType: string | null
  expirationDate: string | null
  /** Legacy `tinyint`; 1 means expired, 0/NULL means not flagged. */
  isExpired: number | null
}

/**
 * A document is valid when it is not flagged expired and its expiry date is
 * today or later. No document means no valid coverage.
 */
export function validWsibDocument(
  documents: readonly WsibDocument[],
  today: string,
): WsibDocument | null {
  const day = today.slice(0, 10)
  for (const document of documents) {
    if (document.isExpired === 1) continue
    const expiry = (document.expirationDate ?? '').slice(0, 10)
    if (!expiry) continue
    if (expiry >= day) return document
  }
  return null
}

export interface WsibGateInput {
  subcontractorId: number | null | undefined
  wsibValid: boolean
  overrideRequested: boolean
  hasOverridePermission: boolean
}

export interface WsibGateResult {
  allowed: boolean
  overrideUsed: boolean
  reason: string | null
}

export function evaluateWsibGate(input: WsibGateInput): WsibGateResult {
  if (!input.subcontractorId) return { allowed: true, overrideUsed: false, reason: null }
  if (input.wsibValid) return { allowed: true, overrideUsed: false, reason: null }
  if (input.overrideRequested && input.hasOverridePermission) {
    return { allowed: true, overrideUsed: true, reason: null }
  }
  return {
    allowed: false,
    overrideUsed: false,
    reason:
      'This subcontractor has no valid WSIB or insurance document. Attach a current document or use the WSIB override permission.',
  }
}

/* ------------------------------------------------------------------ *
 * Transitions and completion                                          *
 * ------------------------------------------------------------------ */

export function requiresSubcontractor(to: WorkOrderStatusCode): boolean {
  return to === 7
}

export function requiresLabourBeforeComplete(
  status: WorkOrderStatusCode,
  labourLineCount: number,
): boolean {
  return status === 2 && labourLineCount === 0
}

export function terminal(code: WorkOrderStatusCode): boolean {
  return isTerminal(code)
}

/* ------------------------------------------------------------------ *
 * Invoice flavour                                                     *
 * ------------------------------------------------------------------ */

export function calcTypeFor(input: { isLocal: boolean; isProject: boolean }): CalcType {
  if (input.isLocal) return input.isProject ? 'local_project' : 'local'
  return input.isProject ? 'sub_project' : 'sub'
}

/**
 * Snapshot immutability (B3): once Sage sales or stock posting has happened the
 * invoice figures must not be recalculated. Work Orders only reports it.
 */
export function invoiceImmutable(flags: {
  sageSalesDone: boolean
  stockUpdated: boolean
  onlyPortalStockUpdated: boolean
}): boolean {
  return flags.sageSalesDone || flags.stockUpdated || flags.onlyPortalStockUpdated
}

/** Today in the business timezone, as `YYYY-MM-DD`. */
export function businessToday(now = new Date()): string {
  // The company operates in Ontario; Asia/Toronto is stable across DST for a
  // date-only value and avoids a UTC off-by-one at 20:00-00:00 local.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}
