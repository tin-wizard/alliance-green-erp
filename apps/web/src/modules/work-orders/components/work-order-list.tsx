import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Download, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { PageHeader } from '../../../shell/page-header'
import { StatusChip } from '../../../shell/status-chip'
import { getWorkOrderViewCountsFn, listWorkOrdersFn, bulkUpdateFn } from '../server/work-orders.functions'
import { listLookupsFn } from '../server/work-orders.functions'
import type {
  BulkUpdateInput,
  SavedViewKey,
  WorkOrderListFilters,
  WorkOrderListRow,
  WorkOrderStatusCode,
  WorkOrderViewCounts,
} from '../types'
import { VIEW_LABELS, WORK_ORDER_STATUSES } from '../lib/status'
import type { WorkOrderListSearch } from '../lib/list-search'
import { businessToday } from '../lib/rules'
import { Button, ErrorPanel, Input, Select, Tag, TriageMarks, formatDate, formatMoney, EmptyState } from './ui'

type ListPath =
  | '/work-orders'
  | '/maintenance/work-orders'
  | '/portal/sub/work-orders'
  | '/portal/tech'

type DetailPath =
  | '/work-orders/$id'
  | '/maintenance/work-orders/$id'
  | '/portal/sub/work-orders/$id'
  | '/portal/tech/$id'

const TABS: SavedViewKey[] = [
  'all',
  'open',
  'overdue',
  'awaiting_approval',
  'scheduled',
  'completed',
  'invoiced',
  'cancelled',
  'undispatched',
  'missing_wsib',
]

export function WorkOrderListScreen({
  search,
  series,
  listPath,
  detailPath,
  newPath,
  eyebrow,
  title,
  description,
  canCreate,
  portal,
}: {
  search: WorkOrderListSearch
  series?: 1 | 2
  listPath: ListPath
  detailPath: DetailPath
  newPath?: '/work-orders/new' | '/maintenance/work-orders/new'
  eyebrow: string
  title: string
  description: string
  canCreate: boolean
  portal: 'office' | 'subcontractor' | 'technician'
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [cursorStack, setCursorStack] = useState<string[]>([])
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable')
  const [searchText, setSearchText] = useState(search.q ?? '')
  const [toast, setToast] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchText.trim()
      if ((search.q ?? '') !== next) {
        updateSearch({ q: next || undefined, cursor: undefined })
      }
    }, 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText])

  const filters: WorkOrderListFilters = {
    view: search.view,
    search: search.q,
    series,
    status: search.status as WorkOrderStatusCode | undefined,
    priorityId: search.priority,
    sort: search.sort,
    pageSize: search.size,
    cursor: search.cursor,
  }

  const counts = useQuery<WorkOrderViewCounts>({
    queryKey: ['work-order-view-counts', series ?? 'all', portal],
    queryFn: () => getWorkOrderViewCountsFn({ data: { ...(series ? { series } : {}) } }),
  })

  const list = useQuery({
    queryKey: ['work-orders', filters, portal],
    queryFn: () => listWorkOrdersFn({ data: filters }),
  })

  const lookups = useQuery({
    queryKey: ['work-order-lookups'],
    queryFn: () => listLookupsFn(),
    staleTime: 120_000,
  })

  const bulk = useMutation({
    mutationFn: (input: BulkUpdateInput) => bulkUpdateFn({ data: input }),
    onSuccess: (result) => {
      setToast({
        tone: result.rejected.length === 0 ? 'ok' : 'error',
        message:
          result.rejected.length === 0
            ? `${result.updated.length} work order(s) updated.`
            : `${result.updated.length} updated, ${result.rejected.length} rejected: ${result.rejected[0]?.reason ?? ''}`,
      })
      setSelected(new Set())
      void queryClient.invalidateQueries({ queryKey: ['work-orders'] })
      void queryClient.invalidateQueries({ queryKey: ['work-order-view-counts'] })
    },
    onError: (error: Error) => setToast({ tone: 'error', message: error.message }),
  })

  function updateSearch(patch: Record<string, unknown>) {
    setSelected(new Set())
    // Paging supplies a cursor and keeps its own back-stack; any other filter
    // change starts a new result set.
    if (!('cursor' in patch)) setCursorStack([])
    void navigate({
      to: listPath,
      search: { ...search, ...patch },
      replace: true,
    })
  }

  const rows = list.data?.rows ?? []
  const total = list.data?.total ?? 0
  const selectedOnPage = rows.filter((row) => selected.has(row.id)).length
  const allOnPageSelected = rows.length > 0 && selectedOnPage === rows.length

  function toggleAll() {
    if (allOnPageSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(rows.map((row) => row.id)))
    }
  }

  function toggle(id: number) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function nextPage() {
    if (!list.data?.nextCursor) return
    setCursorStack((stack) => [...stack, search.cursor ?? ''])
    updateSearch({ cursor: list.data.nextCursor })
  }

  function previousPage() {
    const stack = [...cursorStack]
    const previous = stack.pop() ?? ''
    setCursorStack(stack)
    updateSearch({ cursor: previous || undefined })
  }

  function exportCsv() {
    const header = [
      'WO',
      'Site',
      'Customer',
      'Status',
      'Priority',
      'Scheduled',
      'Subcontractor',
      'Technician',
      'Total',
    ]
    const lines = rows.map((row) =>
      [
        row.id,
        row.siteName ?? '',
        row.customerName ?? '',
        row.statusLabel,
        row.priorityName ?? '',
        row.expectedCompletion ?? '',
        row.subcontractorName ?? '',
        row.techName ?? '',
        row.totalAmount ?? '',
      ]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(','),
    )
    const blob = new Blob([[header.join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `work-orders-${search.view}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const rowHeight = density === 'compact' ? 'h-9' : 'h-11'

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={
          <>
            <Button size="md" onClick={exportCsv} disabled={rows.length === 0}>
              <Download size={14} strokeWidth={1.6} aria-hidden="true" /> Export
            </Button>
            {canCreate && newPath ? (
              <Link
                to={newPath}
                className="inline-flex h-9 items-center gap-1.5 rounded-[4px] border border-[var(--action-primary-bg)] bg-[var(--action-primary-bg)] px-3.5 text-[13px] font-medium text-[var(--action-primary-fg)] hover:bg-[var(--action-primary-bg-hover)]"
              >
                <Plus size={14} strokeWidth={2} aria-hidden="true" /> New work order
              </Link>
            ) : null}
          </>
        }
      />

      {toast ? (
        <div
          role={toast.tone === 'error' ? 'alert' : 'status'}
          className={`rounded-[4px] border px-3 py-2 text-[12.5px] ${
            toast.tone === 'error'
              ? 'border-[var(--status-rejected-bd)] bg-[var(--status-rejected-bg)] text-[var(--status-rejected-fg)]'
              : 'border-[var(--status-complete-bd)] bg-[var(--status-complete-bg)] text-[var(--status-complete-fg)]'
          }`}
        >
          {toast.message}
        </div>
      ) : null}

      <div className="flex items-center gap-3 border-b border-hair">
        <div className="scrollbar-none flex flex-1 items-center gap-1 overflow-x-auto" role="tablist">
          {TABS.map((view) => {
            const active = search.view === view
            return (
              <button
                key={view}
                role="tab"
                aria-selected={active}
                onClick={() => updateSearch({ view, cursor: undefined })}
                className={`relative flex h-10 shrink-0 items-center gap-1.5 px-2.5 text-[13px] font-medium ${
                  active ? 'text-fg' : 'text-fg-muted hover:text-fg'
                }`}
              >
                {VIEW_LABELS[view]}
                <span className="rounded-[2px] bg-subtle px-1.5 text-[10.5px] font-semibold text-fg-muted">
                  {counts.data?.[view] ?? '—'}
                </span>
                {active ? (
                  <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[var(--action-primary-bg)]" />
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-[280px]">
          <Search
            size={14}
            strokeWidth={1.6}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint"
          />
          <Input
            aria-label="Search work orders"
            placeholder="Search WO, site, customer, PO…"
            className="pl-8"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
          />
        </div>

        <Select
          aria-label="Status filter"
          className="w-[170px]"
          value={search.status ?? ''}
          onChange={(event) =>
            updateSearch({
              status: event.target.value ? Number(event.target.value) : undefined,
              cursor: undefined,
            })
          }
        >
          <option value="">All statuses</option>
          {WORK_ORDER_STATUSES.map((status) => (
            <option key={status.code} value={status.code}>
              {status.legacyLabel}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Priority filter"
          className="w-[150px]"
          value={search.priority ?? ''}
          onChange={(event) =>
            updateSearch({
              priority: event.target.value ? Number(event.target.value) : undefined,
              cursor: undefined,
            })
          }
        >
          <option value="">All priorities</option>
          {(lookups.data?.priorities ?? []).map((priority) => (
            <option key={priority.id} value={priority.id}>
              {priority.label}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Sort order"
          className="w-[165px]"
          value={search.sort}
          onChange={(event) =>
            updateSearch({ sort: event.target.value, cursor: undefined })
          }
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="expected">Expected date</option>
          <option value="number">Work-order number</option>
        </Select>

        <div className="ml-auto flex items-center gap-1">
          <span className="mr-1 text-[11.5px] text-fg-muted">
            <SlidersHorizontal size={13} strokeWidth={1.6} className="mr-1 inline" aria-hidden="true" />
            {total} result{total === 1 ? '' : 's'}
          </span>
          <Button
            size="sm"
            variant={density === 'compact' ? 'primary' : 'secondary'}
            aria-pressed={density === 'compact'}
            onClick={() => setDensity('compact')}
          >
            Compact
          </Button>
          <Button
            size="sm"
            variant={density === 'comfortable' ? 'primary' : 'secondary'}
            aria-pressed={density === 'comfortable'}
            onClick={() => setDensity('comfortable')}
          >
            Comfortable
          </Button>
        </div>
      </div>

      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[4px] bg-ink px-3 py-2 text-[12.5px] text-fg-inverse">
          <span className="font-semibold">{selected.size} selected</span>
          <span className="text-fg-inverse-muted">across this page</span>
          <Select
            aria-label="Bulk priority"
            className="h-8 w-[150px] border-ink-hair bg-ink-raised text-fg-inverse"
            defaultValue=""
            onChange={(event) => {
              if (!event.target.value) return
              bulk.mutate({
                ids: [...selected],
                change: { kind: 'priority', priorityId: Number(event.target.value) },
              })
            }}
          >
            <option value="">Change priority…</option>
            {(lookups.data?.priorities ?? []).map((priority) => (
              <option key={priority.id} value={priority.id}>
                {priority.label}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Bulk status"
            className="h-8 w-[170px] border-ink-hair bg-ink-raised text-fg-inverse"
            defaultValue=""
            onChange={(event) => {
              if (!event.target.value) return
              bulk.mutate({
                ids: [...selected],
                change: {
                  kind: 'status',
                  to: Number(event.target.value) as WorkOrderStatusCode,
                  note: 'Bulk status change.',
                },
              })
            }}
          >
            <option value="">Change status…</option>
            <option value={7}>Dispatch</option>
            <option value={2}>Complete</option>
            <option value={5}>Parts on order</option>
            <option value={6}>Cancel</option>
          </Select>
          <Button size="sm" variant="ghost" className="text-fg-inverse" onClick={exportCsv}>
            Export
          </Button>
          <button
            type="button"
            className="ml-auto text-[12px] text-fg-inverse-muted underline-offset-2 hover:underline"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[4px] border border-hair bg-canvas">
        {list.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="h-9 animate-pulse rounded-[2px] bg-subtle" />
            ))}
          </div>
        ) : list.isError ? (
          <div className="p-4">
            <ErrorPanel message={(list.error as Error).message} retry={() => void list.refetch()} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No work orders match these filters"
            description="The default view is open work. Try All to include the invoiced archive, or clear the filters."
            action={
              <Button size="sm" onClick={() => updateSearch({ view: 'open', q: undefined, status: undefined, priority: undefined, cursor: undefined })}>
                Reset filters
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="sticky top-0 bg-subtle text-left text-[10px] uppercase tracking-[0.08em] text-fg-muted">
                  <th scope="col" className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all rows on this page"
                      checked={allOnPageSelected}
                      onChange={toggleAll}
                    />
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">WO</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Customer / site</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Type</th>
                  <th scope="col" className="w-[130px] px-3 py-2 font-semibold">Status</th>
                  <th scope="col" className="w-[110px] px-3 py-2 font-semibold">Priority</th>
                  <th scope="col" className="w-[130px] px-3 py-2 font-semibold">Scheduled</th>
                  <th scope="col" className="w-[160px] px-3 py-2 font-semibold">Technician / sub</th>
                  <th scope="col" className="w-[110px] px-3 py-2 text-right font-semibold">Total</th>
                  <th scope="col" className="w-[60px] px-3 py-2 font-semibold">
                    <span className="sr-only">Triage</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`${rowHeight} border-t border-hair hover:bg-subtle ${
                      selected.has(row.id) ? 'bg-selected' : ''
                    }`}
                  >
                    <td className="px-3">
                      <input
                        type="checkbox"
                        aria-label={`Select work order ${row.id}`}
                        checked={selected.has(row.id)}
                        onChange={() => toggle(row.id)}
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 font-mono text-[12px] text-fg-muted">
                      <Link
                        to={detailPath}
                        params={{ id: String(row.id) }}
                        className="hover:text-fg hover:underline"
                      >
                        {row.series === 2 ? 'M-' : ''}
                        {row.id}
                      </Link>
                    </td>
                    <td className="px-3">
                      <Link to={detailPath} params={{ id: String(row.id) }} className="block min-w-0">
                        <span className="block truncate font-medium text-fg">
                          {row.siteName ?? `Site ${row.siteId}`}
                        </span>
                        <span className="block truncate text-[11.5px] text-fg-muted">
                          {[row.customerName, [row.siteCity, row.siteProvince].filter(Boolean).join(', ')]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3">
                      <div className="flex flex-wrap gap-1">
                        {row.isLocal ? <Tag>Local</Tag> : null}
                        {row.isProject ? <Tag tone="info">Project</Tag> : null}
                        {row.isTjxQuote ? <Tag tone="info">TJX</Tag> : null}
                        {row.isPmaOrder ? <Tag tone="info">PMA</Tag> : null}
                        {!row.isLocal && !row.isProject && !row.isTjxQuote && !row.isPmaOrder ? (
                          <Tag>Sub</Tag>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3">
                      <StatusChip status={row.displayStatus} />
                    </td>
                    <td className="px-3">
                      <span className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-secondary">
                        <PriorityDot priority={row.priorityId} />
                        {row.priorityName ?? '—'}
                      </span>
                    </td>
                    <td className="px-3 text-[12.5px] text-fg-secondary">
                      <ScheduledCell row={row} />
                    </td>
                    <td className="px-3 text-[12.5px] text-fg-secondary">
                      <span className="block truncate">{row.techName ?? row.subcontractorName ?? 'Unassigned'}</span>
                    </td>
                    <td className="px-3 text-right tabular-nums text-fg">
                      {formatMoney(row.totalAmount)}
                    </td>
                    <td className="px-3">
                      <TriageMarks flags={row.triage} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hair px-3 py-2 text-[12px] text-fg-muted">
          <span>
            {rows.length === 0
              ? '0 results'
              : `${cursorStack.length * search.size + 1}–${cursorStack.length * search.size + rows.length} of ${total}`}
          </span>
          <div className="flex items-center gap-2">
            <Select
              aria-label="Rows per page"
              className="h-8 w-[105px]"
              value={search.size}
              onChange={(event) => updateSearch({ size: Number(event.target.value), cursor: undefined })}
            >
              <option value={25}>25 per page</option>
              <option value={50}>50 per page</option>
              <option value={100}>100 per page</option>
            </Select>
            <Button size="sm" onClick={previousPage} disabled={cursorStack.length === 0}>
              <ArrowUp size={13} className="-rotate-90" aria-hidden="true" /> Previous
            </Button>
            <Button size="sm" onClick={nextPage} disabled={!list.data?.nextCursor}>
              Next <ArrowDown size={13} className="-rotate-90" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function PriorityDot({ priority }: { priority: number }) {
  const colour =
    priority <= 1
      ? 'var(--status-rejected-fg)'
      : priority === 2
        ? 'var(--status-pending-fg)'
        : 'var(--text-faint)'
  return <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: colour }} />
}

function ScheduledCell({ row }: { row: WorkOrderListRow }) {
  if (!row.expectedCompletion) {
    return <span className="text-fg-faint">Not scheduled</span>
  }
  const today = businessToday()
  const late =
    ['progress', 'approved', 'pending', 'ordered', 'draft'].includes(row.displayStatus) &&
    row.expectedCompletion < today
  return (
    <span>
      <span className="block">{formatDate(row.expectedCompletion)}</span>
      {late ? (
        <span className="block text-[10.5px] text-[var(--status-rejected-fg)]">Overdue</span>
      ) : null}
    </span>
  )
}
