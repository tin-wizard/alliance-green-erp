import type { PurchaseOrderStatus } from '../types'

export interface PurchaseOrderListSearch {
  status: PurchaseOrderStatus | null
  q: string
  cursor: string | null
  size: number
}

export function parsePurchaseOrderSearch(input: Record<string, unknown>): PurchaseOrderListSearch {
  const status = Number(input.status)
  return {
    status: Number.isInteger(status) && status >= 1 && status <= 11 ? (status as PurchaseOrderStatus) : null,
    q: typeof input.q === 'string' ? input.q.slice(0, 100) : '',
    cursor: typeof input.cursor === 'string' ? input.cursor : null,
    size: 25,
  }
}
