import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { StatusChip } from '../../../shell/status-chip'
import { Button, EmptyState, ErrorPanel, Input, Select, formatDate, formatMoney } from '../../work-orders/components/ui'
import { listQuotesFn } from '../server/quotes.functions'
import type { QuoteKind, QuoteStatusCode } from '../types'
import type { QuoteListSearch } from '../lib/list-search'

const STATUS_OPTIONS: Array<{ value: QuoteStatusCode | ''; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 1, label: 'In Progress' },
  { value: 2, label: 'Saved' },
  { value: 3, label: 'Waiting for approval' },
  { value: 4, label: 'Approved' },
  { value: 5, label: 'Cancelled' },
]

const KIND_OPTIONS: Array<{ value: QuoteKind | 'all'; label: string }> = [
  { value: 'all', label: 'All quotes' },
  { value: 'customer', label: 'Customer' },
  { value: 'standalone', label: 'Standalone' },
]

function statusForChip(status: QuoteStatusCode) {
  if (status === 1) return 'progress' as const
  if (status === 2) return 'draft' as const
  if (status === 3) return 'pending' as const
  if (status === 4) return 'approved' as const
  return 'cancelled' as const
}

export function QuoteList({
  search,
  onSearch,
}: {
  search: QuoteListSearch
  onSearch: (next: QuoteListSearch) => void
}) {
  const [term, setTerm] = useState(search.q)
  const [stack, setStack] = useState<Array<string | null>>([])

  const query = useQuery({
    queryKey: ['quotes', search],
    queryFn: () =>
      listQuotesFn({
        data: {
          kind: search.kind,
          ...(search.status ? { status: search.status } : {}),
          search: search.q,
          cursor: search.cursor,
          size: search.size,
        },
      }),
  })

  const apply = (patch: Partial<QuoteListSearch>) => {
    setStack([])
    onSearch({ ...search, ...patch, cursor: null })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Quote kind"
          value={search.kind}
          onChange={(event) => apply({ kind: event.target.value as QuoteKind | 'all' })}
          className="w-[150px]"
        >
          {KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Quote status"
          value={search.status ?? ''}
          onChange={(event) =>
            apply({
              status: event.target.value ? (Number(event.target.value) as QuoteStatusCode) : null,
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
            aria-label="Search quotes"
            placeholder="Search quote, work order, site or customer…"
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
          {query.data ? `${query.data.total} quote${query.data.total === 1 ? '' : 's'}` : null}
        </span>
      </div>

      {query.isPending ? (
        <div className="h-[220px] animate-pulse rounded-[6px] border border-hair bg-subtle" />
      ) : query.isError ? (
        <ErrorPanel message={(query.error as Error).message} retry={() => void query.refetch()} />
      ) : query.data.rows.length === 0 ? (
        <EmptyState title="No quotes match" description="Adjust the filters or create a new quote." />
      ) : (
        <div className="overflow-x-auto rounded-[6px] border border-hair bg-canvas">
          <table className="w-full min-w-[980px] text-[12.5px]">
            <thead>
              <tr className="bg-subtle text-left text-[10px] uppercase tracking-[0.08em] text-fg-muted">
                <th className="px-4 py-2 font-semibold">Quote</th>
                <th className="px-4 py-2 font-semibold">Kind</th>
                <th className="px-4 py-2 font-semibold">Customer / site</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Rev</th>
                <th className="px-4 py-2 font-semibold">Due</th>
                <th className="px-4 py-2 font-semibold">Created</th>
                <th className="px-4 py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {query.data.rows.map((row) => (
                <tr key={row.id} className="border-t border-hair hover:bg-subtle/60">
                  <td className="px-4 py-2">
                    <Link
                      to="/quotes/$id"
                      params={{ id: String(row.id) }}
                      className="font-medium text-brand hover:underline"
                    >
                      #{row.numberLabel}
                    </Link>
                    {row.workOrderNumber && row.kind === 'customer' ? (
                      <span className="ml-2 text-[11px] text-fg-muted">WO-{row.workOrderNumber}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 capitalize">{row.kind}</td>
                  <td className="px-4 py-2">
                    <span className="block font-medium text-fg">{row.customerName ?? 'No customer'}</span>
                    <span className="text-[11.5px] text-fg-muted">{row.siteName ?? `Site ${row.siteId}`}</span>
                  </td>
                  <td className="px-4 py-2">
                    <StatusChip status={statusForChip(row.status)} />
                  </td>
                  <td className="px-4 py-2 tabular-nums">{row.revisionId || '—'}</td>
                  <td className="px-4 py-2">
                    {row.isDueDateTbd ? 'TBD' : row.dueDate ? formatDate(row.dueDate) : '—'}
                  </td>
                  <td className="px-4 py-2">{formatDate(row.createdAt.slice(0, 10))}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(row.total ?? '0')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button
          size="sm"
          disabled={stack.length === 0}
          onClick={() => {
            const next = [...stack]
            const previous = next.pop() ?? null
            setStack(next)
            onSearch({ ...search, cursor: previous })
          }}
        >
          Previous
        </Button>
        <Button
          size="sm"
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
