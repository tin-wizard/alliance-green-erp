/**
 * Shared status vocabulary.
 *
 * The design specification fixes eleven statuses across the ERP. Modules must
 * use these keys instead of inventing their own strings, so table filters,
 * chips and reports agree.
 *
 * Transition rules belong to the owning module; this file only names the set.
 * The mapping from legacy numeric/text statuses is filled in from
 * green-system/BUSINESS-RULES.md by the cartographer.
 */
export const STATUSES = [
  'draft',
  'pending',
  'approved',
  'ordered',
  'transit',
  'received',
  'progress',
  'complete',
  'invoiced',
  'cancelled',
  'rejected',
] as const

export type Status = (typeof STATUSES)[number]

export const STATUS_LABELS: Record<Status, string> = {
  draft: 'Draft',
  pending: 'Pending approval',
  approved: 'Approved',
  ordered: 'Ordered',
  transit: 'In transit',
  received: 'Received',
  progress: 'In progress',
  complete: 'Complete',
  invoiced: 'Invoiced',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
}
