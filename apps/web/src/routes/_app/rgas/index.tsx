import { useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Card, ErrorPanel, Input, Select, Tag, formatDate } from '../../../modules/work-orders/components/ui'
import { listRgasFn } from '../../../modules/rga/server/rga.functions'
import { getSessionFn } from '../../../server/auth.functions'

export const Route = createFileRoute('/_app/rgas/')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/rgas' } })
    return { session }
  },
  component: RgaListPage,
})

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: '2', label: 'Active' },
  { value: '3', label: 'Saved' },
  { value: '7', label: 'In Transit' },
  { value: '6', label: 'Received' },
  { value: '4', label: 'Completed' },
  { value: '11', label: 'Invoiced' },
  { value: '10', label: 'Cancelled' },
]

const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'rga', label: 'Return' },
  { value: 'credit', label: 'Credit' },
  { value: 'replacement', label: 'Replacement' },
]

function toneFor(status: number): 'neutral' | 'warning' | 'danger' | 'info' {
  if (status === 4 || status === 11) return 'info'
  if (status === 10) return 'danger'
  if (status === 2) return 'warning'
  return 'neutral'
}

function RgaListPage() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')

  const query = useQuery({
    queryKey: ['rgas', { search, status, type }],
    queryFn: () =>
      listRgasFn({
        data: {
          search: search.trim() || undefined,
          status: status ? Number(status) : undefined,
          type: (type || undefined) as 'rga' | 'credit' | 'replacement' | undefined,
          limit: 100,
        },
      }),
  })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hair pb-5 pt-2">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">
            Supply
          </p>
          <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">
            RGAs & warranties
          </h1>
          <p className="mt-1 max-w-[68ch] text-[13.5px] text-fg-secondary">
            Returns against a work order or purchase order, the supplier credit that settles them,
            and the site warranties that decide who pays.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/warranties" className="text-[13px] text-brand underline">
            Site warranties
          </Link>
          <Link
            to="/rgas/new"
            className="inline-flex h-9 items-center gap-1.5 rounded-[4px] border border-[var(--action-primary-bg)] bg-[var(--action-primary-bg)] px-3.5 text-[13px] font-medium text-[var(--action-primary-fg)]"
          >
            <Plus size={14} aria-hidden="true" /> Raise RGA
          </Link>
        </div>
      </div>

      <Card title="Returns">
        <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_180px]">
          <Input
            aria-label="Search RGAs"
            placeholder="Supplier, RGA number, PO, work order"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by type"
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        {query.isError ? (
          <ErrorPanel
            message={query.error instanceof Error ? query.error.message : 'Could not load RGAs.'}
            retry={() => void query.refetch()}
          />
        ) : query.isLoading ? (
          <p className="text-[13px] text-fg-muted">Loading RGAs…</p>
        ) : (query.data?.length ?? 0) === 0 ? (
          <p className="text-[13px] text-fg-muted">No RGAs match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-[12.5px]">
              <thead className="border-b border-hair text-[10.5px] uppercase tracking-[0.12em] text-fg-muted">
                <tr>
                  <th className="py-2 pr-3 font-semibold">RGA</th>
                  <th className="py-2 pr-3 font-semibold">Supplier</th>
                  <th className="py-2 pr-3 font-semibold">Work order</th>
                  <th className="py-2 pr-3 font-semibold">Purchase order</th>
                  <th className="py-2 pr-3 font-semibold">Requested</th>
                  <th className="py-2 pr-3 font-semibold">Return qty</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {query.data?.map((row) => (
                  <tr key={row.id} className="border-b border-hair/60 last:border-0">
                    <td className="py-2.5 pr-3 font-medium text-fg">
                      <Link to="/rgas/$id" params={{ id: String(row.id) }} className="underline">
                        {row.number}
                      </Link>
                      <span className="ml-2 text-[11px] text-fg-muted">{row.rgaType}</span>
                    </td>
                    <td className="py-2.5 pr-3">{row.supplierName ?? '—'}</td>
                    <td className="py-2.5 pr-3">{row.workOrderNumber ?? '—'}</td>
                    <td className="py-2.5 pr-3">{row.purchaseOrderNumber ?? '—'}</td>
                    <td className="py-2.5 pr-3">{formatDate(row.requestDate)}</td>
                    <td className="py-2.5 pr-3">{row.totalReturnQty}</td>
                    <td className="py-2.5 pr-3">
                      <Tag tone={toneFor(row.status)}>{row.statusLabel}</Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
