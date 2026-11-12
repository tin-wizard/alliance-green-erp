import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import {
  Button,
  Card,
  EmptyState,
  Input,
  Select,
  formatDateTime,
  formatMoney,
} from '../../work-orders/components/ui'
import { listTjxQuotesFn } from '../server/quotes.functions'
import { exportTjxPartsOnApprovalFn } from '../server/exports.functions'
import { TJX_QUOTE_STATUSES, TJX_STATUS_LABELS } from '../lib/lifecycle'
import { ErrorNote } from './master-ui'

export function QuotesList() {
  const [status, setStatus] = useState<number | null>(null)
  const [term, setTerm] = useState('')
  const [search, setSearch] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const exportParts = async () => {
    setExporting(true)
    setExportError(null)
    try {
      const result = await exportTjxPartsOnApprovalFn()
      const link = document.createElement('a')
      link.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${result.base64}`
      link.download = result.filename
      link.click()
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : 'The export failed.')
    } finally {
      setExporting(false)
    }
  }

  const quotes = useQuery({
    queryKey: ['tjx', 'quotes', status, search],
    queryFn: () =>
      listTjxQuotesFn({
        data: {
          ...(status ? { status: status as 1 | 3 | 4 | 5 } : {}),
          ...(search ? { search } : {}),
        },
      }),
  })

  return (
    <Card
      title="TJX quotes"
      action={
        <Link
          to="/tjx/quotes/new"
          className="inline-flex h-8 items-center gap-1 rounded-[4px] border border-[var(--action-primary-bg)] bg-[var(--action-primary-bg)] px-2.5 text-[12px] font-medium text-[var(--action-primary-fg)] hover:bg-[var(--action-primary-bg-hover)]"
        >
          <Plus size={13} aria-hidden="true" /> New quote
        </Link>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Quote status"
            value={status ?? ''}
            onChange={(event) => setStatus(event.target.value ? Number(event.target.value) : null)}
            className="w-[200px]"
          >
            <option value="">All statuses</option>
            {TJX_QUOTE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {TJX_STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
          <form
            className="flex flex-1 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              setSearch(term.trim())
            }}
          >
            <Input
              aria-label="Search TJX quotes"
              placeholder="Search quote, site or customer…"
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
                  setSearch('')
                }}
              >
                Clear
              </Button>
            ) : null}
          </form>
          <Button disabled={exporting} onClick={() => void exportParts()}>
            {exporting ? 'Exporting…' : 'Parts on approval XLSX'}
          </Button>
          <span className="ml-auto text-[12px] text-fg-muted">
            {quotes.data ? `${quotes.data.length} quote${quotes.data.length === 1 ? '' : 's'}` : null}
          </span>
        </div>

        <ErrorNote message={quotes.isError ? quotes.error.message : null} />
        <ErrorNote message={exportError} />

        {quotes.isPending ? (
          <div className="h-[220px] animate-pulse rounded-[6px] border border-hair bg-subtle" />
        ) : quotes.data?.length === 0 ? (
          <EmptyState
            title="No TJX quotes match"
            description="Adjust the filters, or start a quote from the default room template."
          />
        ) : (
          <div className="overflow-x-auto rounded-[6px] border border-hair">
            <table className="w-full min-w-[980px] text-[12.5px]">
              <thead>
                <tr className="bg-subtle text-left text-[10px] uppercase tracking-[0.08em] text-fg-muted">
                  <th className="px-4 py-2 font-semibold">Quote</th>
                  <th className="px-4 py-2 font-semibold">Site / customer</th>
                  <th className="px-4 py-2 font-semibold">Type</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 text-right font-semibold">Rooms</th>
                  <th className="px-4 py-2 text-right font-semibold">Fixtures</th>
                  <th className="px-4 py-2 font-semibold">Updated</th>
                  <th className="px-4 py-2 text-right font-semibold">With markup</th>
                  <th className="px-4 py-2 text-right font-semibold">Without markup</th>
                </tr>
              </thead>
              <tbody>
                {quotes.data?.map((row) => (
                  <tr key={row.id} className="border-t border-hair hover:bg-subtle/60">
                    <td className="px-4 py-2">
                      <Link
                        to="/tjx/quotes/$id"
                        params={{ id: String(row.id) }}
                        className="font-medium text-brand hover:underline"
                      >
                        TJX-{row.id}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <span className="block text-fg">{row.siteName ?? '—'}</span>
                      <span className="block text-[11px] text-fg-muted">
                        {row.customerName ?? 'No billing customer'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-fg-secondary">{row.quoteType}</td>
                    <td className="px-4 py-2">
                      <span className="text-fg-secondary">{row.statusLabel}</span>
                      {row.revisionNo > 0 ? (
                        <span className="ml-2 text-[11px] text-fg-muted">R{row.revisionNo}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-fg-secondary">
                      {row.roomCount}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-fg-secondary">
                      {row.fixtureCount}
                    </td>
                    <td className="px-4 py-2 text-fg-secondary">{formatDateTime(row.updatedAt)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-fg">
                      {formatMoney(row.total)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-fg-secondary">
                      {formatMoney(row.withoutMarkupTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  )
}
