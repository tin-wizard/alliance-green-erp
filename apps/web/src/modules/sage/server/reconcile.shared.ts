/**
 * Helpers shared by the daily run and cutover mode.
 *
 * Kept in one place so the two runners cannot disagree about what a cent is, how
 * a paged collection is unwrapped, or which API collection holds a document type.
 */
import type { QuotaClass, SageRequest, SageResponse } from '@cls/sage'

/** The sliver of the HTTP client a run needs. Keeps runs testable without a socket. */
export interface ReconcileHttp {
  request(request: SageRequest): Promise<SageResponse>
}

export const COLLECTIONS: Record<string, string> = {
  sales_invoice: 'sales_invoices',
  purchase_invoice: 'purchase_invoices',
  purchase_credit_note: 'purchase_credit_notes',
}

export function cents(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

export function money(centsValue: number | null): string | null {
  return centsValue === null ? null : (centsValue / 100).toFixed(2)
}

export function itemsOf(json: unknown): Record<string, unknown>[] {
  const record = json as Record<string, unknown> | null
  const items = record?.$items ?? record?.items
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : []
}

/**
 * One read, charged to the class the work belongs to. The daily run is
 * `reconcile`; the 30-minute poll is `sync`, because polling is not
 * reconciliation and its volume (six calls an hour) must not spend the run's
 * budget.
 */
export async function getJson(
  http: ReconcileHttp,
  path: string,
  quotaClass: QuotaClass = 'reconcile',
): Promise<unknown> {
  const response = await http.request({ method: 'GET', path, quotaClass })
  return response.json
}
