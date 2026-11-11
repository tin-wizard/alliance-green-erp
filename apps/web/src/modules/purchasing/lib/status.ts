import type { PermissionKey } from '@cls/core'
import type {
  PurchaseOrderCapabilities,
  PurchaseOrderStatus,
} from '../types'

export const PO_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  1: 'Active',
  2: 'Submitted',
  3: 'Saved',
  4: 'Received',
  5: 'Partial delivery',
  6: 'In transit',
  7: 'Pending approval',
  8: 'Approved',
  9: 'Challenged',
  10: 'Cancelled',
  11: 'Invoiced',
}

export const TERMINAL_PO_STATUSES: readonly PurchaseOrderStatus[] = [10, 11]

export function isPurchaseOrderStatus(value: number): value is PurchaseOrderStatus {
  return value >= 1 && value <= 11 && Number.isInteger(value)
}

export function poStatusChip(status: PurchaseOrderStatus) {
  if (status === 3) return 'draft' as const
  if (status === 7) return 'pending' as const
  if (status === 8) return 'approved' as const
  if (status === 4 || status === 11) return 'complete' as const
  if (status === 5) return 'progress' as const
  if (status === 6) return 'transit' as const
  if (status === 10) return 'cancelled' as const
  return 'progress' as const
}

/**
 * Legal status edges. Receipt and invoice transitions are produced by their
 * services, not by a general status editor, but they are listed here so the
 * server can reject anything else.
 */
export const PO_TRANSITIONS: Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]> = {
  1: [3, 7, 8, 2, 10],
  2: [3, 5, 4, 6, 10],
  3: [7, 8, 2, 10],
  4: [11, 10],
  5: [5, 4, 10],
  6: [2, 5, 4, 10],
  7: [8, 9, 3, 10],
  8: [2, 3, 7, 10],
  9: [3, 7, 10],
  10: [],
  11: [],
}

export function canTransitionPurchaseOrder(
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus,
): boolean {
  return PO_TRANSITIONS[from].includes(to)
}

export function transitionPermission(
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus,
): PermissionKey {
  if (to === 8 || to === 9) return 'po.approve'
  if (to === 2) return 'po.issue'
  if (to === 11) return 'invoice:issue'
  if (from === 5 && to === 4) return 'po.approve'
  if (to === 10) {
    return from === 7 || from === 8 || from === 5 || from === 4 ? 'po.approve' : 'purchasing:write'
  }
  if (from === 2 && to === 3) return 'po.approve'
  return 'purchasing:write'
}

export function illegalTransitionMessage(from: PurchaseOrderStatus, to: PurchaseOrderStatus): string {
  const allowed = PO_TRANSITIONS[from]
  return `Illegal purchase-order status change: ${PO_STATUS_LABELS[from]} → ${
    PO_STATUS_LABELS[to] ?? String(to)
  }. Allowed next: ${
    allowed.length === 0 ? 'none — this status is terminal' : allowed.map((s) => PO_STATUS_LABELS[s]).join(', ')
  }.`
}

export interface PurchaseOrderCapabilityInput {
  status: number
  isTransfer: boolean
}

export function purchaseOrderCapabilities(
  po: PurchaseOrderCapabilityInput,
  grants: ReadonlySet<string>,
): PurchaseOrderCapabilities {
  const has = (key: string) => grants.has(key)
  const status = po.status as PurchaseOrderStatus
  // Editing an approved/issued/in-transit PO is legal and drops it to Saved.
  const editable = status === 1 || status === 3 || status === 8 || status === 2 || status === 6
  return {
    canEdit: editable && has('purchasing:write'),
    canRequestApproval: (status === 1 || status === 3 || status === 9) && has('purchasing:write'),
    canApprove: status === 7 && has('po.approve'),
    canChallenge: status === 7 && has('po.approve'),
    canIssue: (status === 3 || status === 8) && has('po.issue'),
    canReceive: (status === 2 || status === 5 || status === 6) && has('purchasing:write') && has('inventory:adjust'),
    canShortClose: status === 5 && has('po.approve'),
    canCancel:
      status !== 10 &&
      status !== 11 &&
      (status === 5 || status === 4 || status === 7 || status === 8
        ? has('po.approve')
        : has('purchasing:write')),
    canInvoice: (status === 2 || status === 5 || status === 4 || status === 6) && has('invoice:write'),
    canCloseInvoice: status === 4 && has('invoice:issue'),
  }
}
