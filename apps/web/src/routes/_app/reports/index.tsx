import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import {
  Button,
  EmptyState,
  ErrorPanel,
  Field,
  Input,
  Select,
  formatDate,
} from '../../../modules/work-orders/components/ui'
import { getSessionFn } from '../../../server/auth.functions'
import { exportReportFn, runReportFn } from '../../../modules/reports/server/reports.functions'
import {
  CLIENT_PRESETS,
  REPORT_KEYS,
  REPORT_PAGE_SIZE_DEFAULT,
  REPORT_TITLES,
  type ClientPresetKey,
  type ReportColumn,
  type ReportKey,
  type ReportRequest,
  type ServiceScope,
  type StockScope,
} from '../../../modules/reports/types'

export const Route = createFileRoute('/_app/reports/')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/reports' } })
    return { session }
  },
  component: ReportsPage,
})

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function firstOfMonth(): string {
  return `${today().slice(0, 7)}-01`
}

function initialRequest(): ReportRequest {
  return {
    key: 'client-invoices',
    client: 'bell',
    startDate: firstOfMonth(),
    endDate: today(),
    serviceScope: 'work',
    province: '',
    category: 'all',
    search: '',
    stockScope: 'all',
    page: 1,
    pageSize: REPORT_PAGE_SIZE_DEFAULT,
  }
}

function ReportsPage() {
  const [draft, setDraft] = useState<ReportRequest>(initialRequest)
  const [applied, setApplied] = useState<ReportRequest>(initialRequest)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null)

  const query = useQuery({
    queryKey: ['report', applied],
    queryFn: () => runReportFn({ data: applied }),
  })

  function update(patch: Partial<ReportRequest>) {
    setDraft((current) => ({ ...current, ...patch, page: 1 }))
  }

  function apply() {
    setApplied({ ...draft, page: 1 })
  }

  function selectPreset(key: ReportKey, client?: ClientPresetKey) {
    const next: ReportRequest = {
      ...draft,
      key,
      client: client ?? draft.client,
      page: 1,
      serviceScope: key === 'client-invoices' ? draft.serviceScope : 'all',
    }
    setDraft(next)
    setApplied(next)
  }

  async function download(format: 'pdf' | 'xlsx') {
    setExporting(format)
    setExportError(null)
    try {
      const result = await exportReportFn({ data: { ...applied, format } })
      const bytes = Uint8Array.from(atob(result.base64), (char) => char.charCodeAt(0))
      const blob = new Blob([bytes], { type: result.contentType })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = result.fileName
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed')
    } finally {
      setExporting(null)
    }
  }

  const result = query.data

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hair pb-5 pt-2">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">
            Reporting
          </p>
          <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">
            Reports
          </h1>
          <p className="mt-1 max-w-[75ch] text-[13.5px] text-fg-secondary">
            One parameterised report per family. The legacy client pages are saved views here, and
            every export is generated from the same query the screen shows.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={exporting !== null}
            onClick={() => void download('pdf')}
          >
            <Download size={14} aria-hidden="true" /> PDF
          </Button>
          <Button
            variant="secondary"
            disabled={exporting !== null}
            onClick={() => void download('xlsx')}
          >
            <Download size={14} aria-hidden="true" /> XLSX
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {REPORT_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => selectPreset(key)}
            className={`h-8 rounded-[4px] border px-3 text-[12.5px] font-medium transition ${
              draft.key === key
                ? 'border-[var(--action-primary-bg)] bg-[var(--action-primary-bg)] text-[var(--action-primary-fg)]'
                : 'border-hair bg-surface text-fg hover:bg-surface-2'
            }`}
          >
            {REPORT_TITLES[key]}
          </button>
        ))}
      </div>

      <form
        className="grid gap-3 rounded-[5px] border border-hair bg-surface p-4 md:grid-cols-3 lg:grid-cols-6"
        onSubmit={(event) => {
          event.preventDefault()
          apply()
        }}
      >
        <Field label="Client">
          <Select
            aria-label="Client"
            value={draft.client}
            onChange={(event) => update({ client: event.target.value as ClientPresetKey })}
          >
            {CLIENT_PRESETS.map((preset) => (
              <option key={preset.key} value={preset.key}>
                {preset.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From">
          <Input
            type="date"
            aria-label="From"
            value={draft.startDate}
            onChange={(event) => update({ startDate: event.target.value })}
          />
        </Field>
        <Field label="To">
          <Input
            type="date"
            aria-label="To"
            value={draft.endDate}
            onChange={(event) => update({ endDate: event.target.value })}
          />
        </Field>
        <Field label="Service">
          <Select
            aria-label="Service"
            value={draft.serviceScope}
            onChange={(event) => update({ serviceScope: event.target.value as ServiceScope })}
          >
            <option value="all">All</option>
            <option value="work">Interior / exterior</option>
            <option value="maintenance">Maintenance</option>
          </Select>
        </Field>
        <Field label="Province">
          <Input
            aria-label="Province"
            maxLength={2}
            placeholder="ON"
            value={draft.province}
            onChange={(event) => update({ province: event.target.value.toUpperCase() })}
          />
        </Field>
        <Field label="Category">
          <Select
            aria-label="Category"
            value={draft.category}
            onChange={(event) =>
              update({ category: event.target.value as ReportRequest['category'] })
            }
          >
            <option value="all">All</option>
            <option value="local">Local</option>
            <option value="project">Project</option>
          </Select>
        </Field>
        <Field label="Search">
          <Input
            aria-label="Search"
            placeholder={
              draft.key === 'parts-stock' ? 'Part number or name' : 'Store, city or PO'
            }
            value={draft.search}
            onChange={(event) => update({ search: event.target.value })}
          />
        </Field>
        {draft.key === 'parts-stock' ? (
          <Field label="Stock">
            <Select
              aria-label="Stock"
              value={draft.stockScope}
              onChange={(event) => update({ stockScope: event.target.value as StockScope })}
            >
              <option value="all">All</option>
              <option value="in-stock">In stock</option>
              <option value="low">Below 10</option>
              <option value="out">Out of stock</option>
            </Select>
          </Field>
        ) : null}
        <Field label="Rows per page">
          <Select
            aria-label="Rows per page"
            value={draft.pageSize}
            onChange={(event) => update({ pageSize: Number(event.target.value) })}
          >
            {[50, REPORT_PAGE_SIZE_DEFAULT, 250, 500].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end gap-2">
          <Button type="submit">Run report</Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              const reset = initialRequest()
              setDraft(reset)
              setApplied(reset)
            }}
          >
            <RefreshCw size={14} aria-hidden="true" /> Reset
          </Button>
        </div>
      </form>

      {exportError ? <ErrorPanel message={exportError} /> : null}
      {query.isPending ? <p className="text-[13px] text-fg-muted">Running report…</p> : null}
      {query.error ? <ErrorPanel message={query.error.message} /> : null}

      {result ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-fg-muted">
            <div>
              <span className="font-medium text-fg">{result.title}</span> · {result.subtitle} ·{' '}
              {result.totalRows} row{result.totalRows === 1 ? '' : 's'}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                disabled={result.page <= 1}
                onClick={() => setApplied({ ...applied, page: result.page - 1 })}
              >
                Previous
              </Button>
              <span>
                Page {result.page} of {Math.max(1, Math.ceil(result.totalRows / result.pageSize))}
              </span>
              <Button
                variant="ghost"
                disabled={result.page >= Math.ceil(result.totalRows / result.pageSize)}
                onClick={() => setApplied({ ...applied, page: result.page + 1 })}
              >
                Next
              </Button>
            </div>
          </div>

          {result.rows.length === 0 ? (
            <EmptyState
              title="No rows"
              description="Widen the dates or clear a filter. Nothing was invented to fill the table."
            />
          ) : (
            <div className="overflow-x-auto rounded-[5px] border border-hair bg-surface">
              <table className="w-full text-left text-[12.5px]" data-testid="report-table">
                <thead className="bg-surface-2 text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
                  <tr>
                    {result.columns.map((column) => (
                      <th
                        key={column.key}
                        className={`whitespace-nowrap px-3 py-2 ${
                          column.align === 'right' ? 'text-right' : ''
                        }`}
                      >
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, index) => (
                    <tr key={index} className="border-t border-hair align-top">
                      {result.columns.map((column) => (
                        <td
                          key={column.key}
                          className={`px-3 py-2 ${
                            column.align === 'right' ? 'text-right tabular-nums' : ''
                          }`}
                        >
                          {displayCell(row[column.key], column)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {result.totals ? (
                  <tfoot className="border-t-2 border-fg bg-surface-2 font-medium">
                    <tr>
                      {result.columns.map((column) => (
                        <td
                          key={column.key}
                          className={`px-3 py-2 ${
                            column.align === 'right' ? 'text-right tabular-nums' : ''
                          }`}
                        >
                          {displayCell(result.totals?.[column.key], column)}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          )}

          <p className="text-[12px] text-fg-muted">
            {result.filters.join(' · ')} · PDF and XLSX cover every matching row (up to 5,000).
            Page size is a view setting and does not change the export.
          </p>
        </>
      ) : null}
    </div>
  )
}

function displayCell(value: string | undefined, column: ReportColumn): string {
  if (!value) return ''
  if (column.format === 'date') return formatDate(value)
  return value
}
