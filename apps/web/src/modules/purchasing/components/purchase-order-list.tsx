import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { StatusChip } from '../../../shell/status-chip'
import { Button, EmptyState, ErrorPanel, Input, Select, formatDate, formatMoney } from '../../work-orders/components/ui'
import { listPurchaseOrdersFn } from '../server/purchasing.functions'
import { PO_STATUS_LABELS, poStatusChip } from '../lib/status'
import type { PurchaseOrderListSearch } from '../lib/list-search'
import type { PurchaseOrderStatus } from '../types'

const STATUS_OPTIONS: Array<{ value: PurchaseOrderStatus | ''; label: string }> = [
  { value: '', label: 'All statuses' },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((status) => ({
    value: status as PurchaseOrderStatus,
    label: PO_STATUS_LABELS[status as PurchaseOrderStatus],
  })),
]

export function PurchaseOrderList({
  search,
  onSearch,
}: {
  search: PurchaseOrderListSearch
  onSearch: (next: PurchaseOrderListSearch) => void
}) {
  const [term, setTerm] = useState(search.q)
  const [stack, setStack] = useState<Array<string | null>>([])

  const query = useQuery({
    queryKey: ['purchase-orders', search],
    queryFn: () =>
      listPurchaseOrdersFn({
        data: {
          status: search.status,
          search: search.q,
          cursor: search.cursor,
          size: search.size,
        },
      }),
  })

  const apply = (patch: Partial<PurchaseOrderListSearch>) => {
    setStack([])
    onSearch({ ...search, ...patch, cursor: null })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Purchase order status"
          value={search.status ?? ''}
          onChange={(event) =>
            apply({
              status: event.target.value ? (Number(event.target.value) as PurchaseOrderStatus) : null,
            })
          }
          className="w-[190px]"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            apply({ q: term.trim() })
          }}
        >
          <Input
            aria-label="Search purchase orders"
            placeholder="Search PO number, supplier or notes…"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            className="max-w-[420px]"
          />
          <Button type="submit">Search</Button>
          {search.q ? (
            <Button
              variant="ghost"
              onClick={() => {
                setTerm('')
                apply({ q: '' })
              }}
            >
              Clear
            </Button>
          ) : null}
        </form>
        <span className="ml-auto text-[12px] text-fg-muted">
          {query.data ? `${query.data.total} purchase order${query.data.total === 1 ? '' : 's'}` : ''}
        </span>
      </div>

      {query.isPending ? <p className="text-[13px] text-fg-muted">Loading purchase orders…</p> : null}
      {query.error ? <ErrorPanel message={query.error.message} /> : null}

      {query.data && query.data.rows.length === 0 ? (
        <EmptyState
          title="No purchase orders"
          description="Create a purchase order to start the purchasing flow."
        />
      ) : null}

      {query.data && query.data.rows.length > 0 ? (
        <div className="overflow-hidden rounded-[5px] border border-hair bg-surface">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-surface-2 text-[11px] uppercase tracking-[0.08em] text-fg-muted">
              <tr>
                <th className="px-3 py-2">PO</th>
                <th className="px-3 py-2">Supplier</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Expected</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {query.data.rows.map((row) => (
                <tr key={row.id} className="border-t border-hair">
                  <td className="px-3 py-2">
                    <Link to="/purchasing/$id" params={{ id: String(row.id) }} className="font-medium text-brand">
                      {row.displayNumber ?? row.id}
                    </Link>
                    {row.isTransfer ? (
                      <span className="ml-2 text-[11px] text-fg-muted">transfer</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{row.supplierName}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-2"><StatusChip status={poStatusChip(row.status)} /><span className="text-[12px] text-fg-secondary">{PO_STATUS_LABELS[row.status]}</span></span>
                  </td>
                  <td className="px-3 py-2">{row.expectedDelivery ? formatDate(row.expectedDelivery) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          disabled={stack.length === 0}
          onClick={() => {
            const previous = stack[stack.length - 1] ?? null
            setStack(stack.slice(0, -1))
            onSearch({ ...search, cursor: previous })
          }}
        >
          Previous
        </Button>
        <Button
          variant="ghost"
          disabled={!query.data?.nextCursor}
          onClick={() => {
            if (!query.data?.nextCursor) return
            setStack([...stack, search.cursor])
            onSearch({ ...search, cursor: query.data.nextCursor })
          }}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
