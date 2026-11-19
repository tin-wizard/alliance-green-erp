import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import {
  Button,
  EmptyState,
  ErrorPanel,
  Input,
  formatQuantity,
} from '../../../modules/work-orders/components/ui'
import { listStockFn } from '../../../modules/inventory/server/inventory.functions'
import { getSessionFn } from '../../../server/auth.functions'

export const Route = createFileRoute('/_app/inventory/')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/inventory' } })
    return { session }
  },
  component: InventoryPage,
})

const PAGE_SIZE = 100

function InventoryPage() {
  const [term, setTerm] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ['inventory-stock', search, page],
    queryFn: () => listStockFn({ data: { search, page, pageSize: PAGE_SIZE } }),
    placeholderData: keepPreviousData,
  })

  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / PAGE_SIZE)) : 1
  const differences = query.data?.rows.filter((row) => row.difference !== '0.00') ?? []

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hair pb-5 pt-2">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">
            Operations
          </p>
          <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">
            Inventory
          </h1>
          <p className="mt-1 max-w-[70ch] text-[13.5px] text-fg-secondary">
            The parts counter is authoritative. The ledger total sits beside it; a difference is
            shown, never silently corrected.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/inventory/adjustments"
            className="inline-flex h-9 items-center gap-1.5 rounded-[4px] border border-[var(--action-primary-bg)] bg-[var(--action-primary-bg)] px-3.5 text-[13px] font-medium text-[var(--action-primary-fg)]"
          >
            <Plus size={14} aria-hidden="true" /> Adjust stock
          </Link>
          <Link
            to="/inventory/movements"
            className="inline-flex h-9 items-center rounded-[4px] border border-hair px-3.5 text-[13px] font-medium text-fg"
          >
            Movements &amp; reports
          </Link>
        </div>
      </div>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          setPage(1)
          setSearch(term.trim())
        }}
      >
        <Input
          aria-label="Search parts"
          placeholder="Search part number or description…"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          className="max-w-[420px]"
        />
        <Button type="submit">Search</Button>
        {search ? (
          <Button
            variant="ghost"
            onClick={() => {
              setTerm('')
              setPage(1)
              setSearch('')
            }}
          >
            Clear
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => void query.refetch()} aria-label="Refresh stock">
          <RefreshCw size={14} aria-hidden="true" />
        </Button>
        <span className="ml-auto text-[12px] text-fg-muted">
          {query.data ? `${query.data.total} part${query.data.total === 1 ? '' : 's'}` : ''}
        </span>
      </form>

      {differences.length > 0 ? (
        <div
          data-testid="counter-difference-note"
          className="rounded-[4px] border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900"
        >
          {differences.length} part{differences.length === 1 ? '' : 's'} on this page have a
          counter/ledger difference. The counter remains the stock figure.
        </div>
      ) : null}

      {query.isPending ? <p className="text-[13px] text-fg-muted">Loading stock…</p> : null}
      {query.error ? <ErrorPanel message={query.error.message} /> : null}

      {query.data && query.data.rows.length === 0 ? (
        <EmptyState
          title="No parts"
          description="Master Data creates part identity; an adjustment or a receipt creates stock."
        />
      ) : null}

      {query.data && query.data.rows.length > 0 ? (
        <div className="overflow-hidden rounded-[5px] border border-hair bg-surface">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-surface-2 text-[11px] uppercase tracking-[0.08em] text-fg-muted">
              <tr>
                <th className="px-3 py-2">Part</th>
                <th className="px-3 py-2 text-right">Current</th>
                <th className="px-3 py-2 text-right">Purchased</th>
                <th className="px-3 py-2 text-right">Sold</th>
                <th className="px-3 py-2 text-right">Ledger</th>
                <th className="px-3 py-2 text-right">Difference</th>
                <th className="px-3 py-2">Sub portal</th>
              </tr>
            </thead>
            <tbody>
              {query.data.rows.map((row) => (
                <tr key={row.id} className="border-t border-hair">
                  <td className="px-3 py-2">
                    <span className="font-mono text-[12.5px] font-medium text-fg">
                      {row.partNumber}
                    </span>
                    {row.name && row.name !== row.partNumber ? (
                      <span className="ml-2 text-[12px] text-fg-muted">{row.name}</span>
                    ) : null}
                  </td>
                  <td
                    data-testid={`stock-current-${row.partNumber}`}
                    className="px-3 py-2 text-right font-medium tabular-nums"
                  >
                    {formatQuantity(row.currentQuantity)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatQuantity(row.purchasedQuantity)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatQuantity(row.soldQuantity)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                    {formatQuantity(row.ledgerQuantity)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      row.difference === '0.00' ? 'text-fg-muted' : 'font-medium text-amber-700'
                    }`}
                  >
                    {formatQuantity(row.difference)}
                  </td>
                  <td className="px-3 py-2 text-[12px] text-fg-muted">
                    {row.subignore ? 'hidden' : 'visible'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-hair px-3 py-2 text-[12.5px] text-fg-muted">
            <span>
              Page {page} of {totalPages} · showing {(page - 1) * PAGE_SIZE + 1}–
              {Math.min(page * PAGE_SIZE, query.data.total)} of {query.data.total}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                disabled={page <= 1 || query.isFetching}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                aria-label="Previous page"
              >
                Previous
              </Button>
              <Button
                variant="ghost"
                disabled={page >= totalPages || query.isFetching}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                aria-label="Next page"
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <p className="text-[12px] text-fg-muted">
        Price changes happen in the{' '}
        <Link to="/inventory/prices" className="text-brand underline">
          price editor
        </Link>
        . Master Data shows rate cards read-only.
      </p>
    </div>
  )
}
