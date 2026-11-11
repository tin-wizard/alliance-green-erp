import { useEffect, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { PageHeader } from '../../../shell/page-header'
import { Button, EmptyState, ErrorPanel, Input } from './ui'

export interface MasterColumn<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  className?: string
}

/**
 * Shared list shell: search, one optional filter, rows and pagination.
 * Row links point at detail routes; the module has no inline editing.
 */
export function MasterList<T>({
  eyebrow,
  title,
  description,
  search,
  searchPlaceholder,
  onSearch,
  filter,
  rows,
  columns,
  total,
  page,
  pageSize,
  loading,
  error,
  onRetry,
  onPage,
  rowKey,
  rowHref,
  emptyTitle,
  emptyDescription,
}: {
  eyebrow: string
  title: string
  description: string
  search: string
  searchPlaceholder: string
  onSearch: (value: string) => void
  filter?: ReactNode
  rows: readonly T[] | undefined
  columns: readonly MasterColumn<T>[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  error: unknown
  onRetry: () => void
  onPage: (page: number) => void
  rowKey: (row: T) => string | number
  rowHref: (row: T) => string
  emptyTitle: string
  emptyDescription: string
}) {
  const [draft, setDraft] = useState(search)
  const [lastSearch, setLastSearch] = useState(search)
  if (lastSearch !== search) {
    // URL changed (back/forward or a cleared filter): mirror it without an effect.
    setLastSearch(search)
    setDraft(search)
  }

  useEffect(() => {
    if (draft === search) return
    const timer = window.setTimeout(() => onSearch(draft), 250)
    return () => window.clearTimeout(timer)
  }, [draft, search, onSearch])

  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="w-full sm:max-w-[360px]">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
        </div>
        {filter ? <div className="w-full sm:w-[220px]">{filter}</div> : null}
        <div className="text-[12px] text-fg-muted sm:ml-auto">
          {loading ? 'Loading…' : `${total.toLocaleString('en-CA')} records`}
        </div>
      </div>

      {error ? (
        <ErrorPanel
          message={error instanceof Error ? error.message : String(error)}
          retry={onRetry}
        />
      ) : (
        <div className="overflow-hidden rounded-[6px] border border-hair bg-canvas">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-hair bg-[var(--surface-subtle)]">
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      className={`whitespace-nowrap px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted ${column.className ?? ''}`}
                    >
                      {column.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((row) => (
                  <tr key={rowKey(row)} className="border-b border-hair last:border-0">
                    {columns.map((column, index) => (
                      <td
                        key={column.key}
                        className={`px-4 py-2.5 align-top text-fg-secondary ${column.className ?? ''}`}
                      >
                        {index === 0 ? (
                          <Link
                            to={rowHref(row)}
                            className="font-medium text-fg underline-offset-2 hover:text-brand hover:underline"
                          >
                            {column.render(row)}
                          </Link>
                        ) : (
                          column.render(row)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && (rows?.length ?? 0) === 0 ? (
            <EmptyState title={emptyTitle} description={emptyDescription} />
          ) : null}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 text-[12px] text-fg-muted">
        <span>
          Page {page} of {pageCount}
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>
            Previous
          </Button>
          <Button
            size="sm"
            disabled={page >= pageCount || loading}
            onClick={() => onPage(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}

export function DetailHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return <PageHeader eyebrow={eyebrow} title={title} description={description} actions={actions} />
}

export function NotFound({ what }: { what: string }) {
  return (
    <EmptyState
      title={`${what} not found`}
      description="The record may not have been imported yet. Master Data never renumbers ids, so a missing id stays missing."
      action={
        <Link to=".." className="text-[13px] text-brand hover:underline">
          Back to the list
        </Link>
      }
    />
  )
}
