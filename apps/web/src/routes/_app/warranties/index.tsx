import { useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, ErrorPanel, Field, Input, Select, Tag, formatDate } from '../../../modules/work-orders/components/ui'
import {
  createWarrantyFn,
  listWarrantiesFn,
  warrantySummaryFn,
} from '../../../modules/rga/server/rga.functions'
import { getSessionFn } from '../../../server/auth.functions'

export const Route = createFileRoute('/_app/warranties/')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/warranties' } })
    return { session }
  },
  component: WarrantiesPage,
})

function WarrantiesPage() {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<'all' | 'expiring' | 'expired' | 'active'>('all')
  const [search, setSearch] = useState('')
  const [siteId, setSiteId] = useState('')
  const [description, setDescription] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [workOrderId, setWorkOrderId] = useState('')

  const list = useQuery({
    queryKey: ['warranties', filter, search],
    queryFn: () => listWarrantiesFn({ data: { filter, search: search.trim() || undefined } }),
  })
  const summary = useQuery({
    queryKey: ['warranty-summary'],
    queryFn: () => warrantySummaryFn(),
  })

  const create = useMutation({
    mutationFn: () =>
      createWarrantyFn({
        data: {
          siteId: Number(siteId),
          description: description.trim(),
          expiresOn,
          workOrderId: workOrderId ? Number(workOrderId) : null,
        },
      }),
    onSuccess: () => {
      setSiteId('')
      setDescription('')
      setExpiresOn('')
      setWorkOrderId('')
      void queryClient.invalidateQueries({ queryKey: ['warranties'] })
      void queryClient.invalidateQueries({ queryKey: ['warranty-summary'] })
    },
  })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hair pb-5 pt-2">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">Supply</p>
          <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">
            Site warranties
          </h1>
          <p className="mt-1 max-w-[68ch] text-[13.5px] text-fg-secondary">
            Warranty coverage per site, linked to the work order that created it. Expiring means
            inside 30 days; expired rows stay visible.
          </p>
        </div>
        <Link to="/rgas" className="text-[13px] text-brand underline">
          Back to RGAs
        </Link>
      </div>

      {summary.data ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card title="All warranties"><p className="text-[24px] font-serif">{summary.data.total}</p></Card>
          <Card title="Expiring in 30 days"><p className="text-[24px] font-serif">{summary.data.expiring}</p></Card>
          <Card title="Expired"><p className="text-[24px] font-serif">{summary.data.expired}</p></Card>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card title="Coverage">
          <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
            <Input
              aria-label="Search warranties"
              placeholder="Site name"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Select
              aria-label="Warranty filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value as typeof filter)}
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="expiring">Expiring</option>
              <option value="expired">Expired</option>
            </Select>
          </div>
          {list.isError ? (
            <ErrorPanel
              message={list.error instanceof Error ? list.error.message : 'Could not load warranties.'}
              retry={() => void list.refetch()}
            />
          ) : list.isLoading ? (
            <p className="text-[13px] text-fg-muted">Loading warranties…</p>
          ) : (list.data?.length ?? 0) === 0 ? (
            <p className="text-[13px] text-fg-muted">No warranty records match.</p>
          ) : (
            <table className="w-full text-left text-[12.5px]">
              <thead className="border-b border-hair text-[10.5px] uppercase tracking-[0.12em] text-fg-muted">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Site</th>
                  <th className="py-2 pr-3 font-semibold">Description</th>
                  <th className="py-2 pr-3 font-semibold">Expires</th>
                  <th className="py-2 pr-3 font-semibold">Work order</th>
                  <th className="py-2 pr-3 font-semibold">State</th>
                </tr>
              </thead>
              <tbody>
                {list.data?.map((row) => (
                  <tr key={row.id} className="border-b border-hair/60 last:border-0">
                    <td className="py-2.5 pr-3">
                      {row.siteName}
                      <span className="ml-1 text-[11px] text-fg-muted">
                        {[row.siteCity, row.siteProvince].filter(Boolean).join(', ')}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">{row.description}</td>
                    <td className="py-2.5 pr-3">{formatDate(row.expiresOn)}</td>
                    <td className="py-2.5 pr-3">{row.workOrderNumber ?? '—'}</td>
                    <td className="py-2.5 pr-3">
                      <Tag tone={row.state === 'expired' ? 'danger' : row.state === 'expiring' ? 'warning' : 'info'}>
                        {row.state}
                        {row.daysRemaining !== null ? ` (${row.daysRemaining}d)` : ''}
                      </Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Record a warranty">
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              create.mutate()
            }}
          >
            {create.isError ? (
              <ErrorPanel
                message={create.error instanceof Error ? create.error.message : 'Could not record the warranty.'}
              />
            ) : null}
            <Field label="Site id">
              <Input
                aria-label="Site id"
                required
                inputMode="numeric"
                value={siteId}
                onChange={(event) => setSiteId(event.target.value)}
              />
            </Field>
            <Field label="Work order id (optional)">
              <Input
                aria-label="Work order id"
                inputMode="numeric"
                value={workOrderId}
                onChange={(event) => setWorkOrderId(event.target.value)}
              />
            </Field>
            <Field label="Description">
              <Input
                aria-label="Warranty description"
                required
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <Field label="Expires on">
              <Input
                aria-label="Warranty expiry"
                required
                type="date"
                value={expiresOn}
                onChange={(event) => setExpiresOn(event.target.value)}
              />
            </Field>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Recording…' : 'Record warranty'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  )
}
