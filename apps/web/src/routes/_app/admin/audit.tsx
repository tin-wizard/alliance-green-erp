import { createFileRoute } from '@tanstack/react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button, Card, ErrorPanel, Field, Input, formatDateTime } from '../../../modules/work-orders/components/ui'
import { PageHeader } from '../../../shell/page-header'
import { listAuditFn } from '../../../modules/admin/server/admin.functions'

export const Route = createFileRoute('/_app/admin/audit')({
  component: AuditPage,
})

interface Draft {
  actor: string
  action: string
  entityType: string
  entityId: string
  from: string
  to: string
}

const EMPTY: Draft = { actor: '', action: '', entityType: '', entityId: '', from: '', to: '' }

function AuditPage() {
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [applied, setApplied] = useState<Draft>(EMPTY)
  const [page, setPage] = useState(1)
  const pageSize = 100

  const query = useQuery({
    queryKey: ['admin', 'audit', applied, page],
    queryFn: () =>
      listAuditFn({
        data: {
          ...(applied.actor ? { actor: applied.actor } : {}),
          ...(applied.action ? { action: applied.action } : {}),
          ...(applied.entityType ? { entityType: applied.entityType } : {}),
          ...(applied.entityId ? { entityId: applied.entityId } : {}),
          ...(applied.from ? { from: applied.from } : {}),
          ...(applied.to ? { to: applied.to } : {}),
          page,
          pageSize,
        },
      }),
    placeholderData: keepPreviousData,
  })

  function apply() {
    setPage(1)
    setApplied(draft)
  }

  const total = query.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Activity log"
        description="Every write records an immutable row in audit_log: actor, action, entity, before and after values, request id, IP and user agent."
      />

      <Card title="Filters">
        <form
          className="grid items-end gap-3 md:grid-cols-3 xl:grid-cols-6"
          onSubmit={(event) => {
            event.preventDefault()
            apply()
          }}
        >
          <Field label="Actor">
            <Input
              placeholder="Name or id"
              value={draft.actor}
              onChange={(event) => setDraft({ ...draft, actor: event.target.value })}
            />
          </Field>
          <Field label="Action">
            <Input
              list="audit-actions"
              placeholder="e.g. invoice.issue"
              value={draft.action}
              onChange={(event) => setDraft({ ...draft, action: event.target.value })}
            />
            <datalist id="audit-actions">
              {(query.data?.actions ?? []).map((action) => (
                <option key={action} value={action} />
              ))}
            </datalist>
          </Field>
          <Field label="Entity type">
            <Input
              placeholder="e.g. sales_invoice"
              value={draft.entityType}
              onChange={(event) => setDraft({ ...draft, entityType: event.target.value })}
            />
          </Field>
          <Field label="Entity id">
            <Input
              value={draft.entityId}
              onChange={(event) => setDraft({ ...draft, entityId: event.target.value })}
            />
          </Field>
          <Field label="From">
            <Input
              type="date"
              value={draft.from}
              onChange={(event) => setDraft({ ...draft, from: event.target.value })}
            />
          </Field>
          <Field label="To">
            <Input
              type="date"
              value={draft.to}
              onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            />
          </Field>
          <div className="flex gap-2 md:col-span-3 xl:col-span-6">
            <Button type="submit" variant="primary">Apply</Button>
            <Button
              onClick={() => {
                setDraft(EMPTY)
                setApplied(EMPTY)
                setPage(1)
              }}
            >
              Clear
            </Button>
            <span className="ml-auto self-center text-[11.5px] text-fg-muted">
              {query.isFetching ? 'Loading…' : `${total} matching rows`}
            </span>
          </div>
        </form>
      </Card>

      <Card padded={false}>
        {query.isError ? (
          <div className="p-4">
            <ErrorPanel message={query.error instanceof Error ? query.error.message : String(query.error)} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]" data-testid="audit-table">
              <thead>
                <tr className="bg-subtle text-left text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
                  <th scope="col" className="px-4 py-2 font-semibold">When</th>
                  <th scope="col" className="px-4 py-2 font-semibold">Actor</th>
                  <th scope="col" className="px-4 py-2 font-semibold">Action</th>
                  <th scope="col" className="px-4 py-2 font-semibold">Entity</th>
                  <th scope="col" className="px-4 py-2 font-semibold">Summary</th>
                </tr>
              </thead>
              <tbody>
                {query.isPending ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-fg-muted">Loading activity…</td>
                  </tr>
                ) : query.data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-fg-muted">
                      No activity matches these filters.
                    </td>
                  </tr>
                ) : (
                  query.data.rows.map((row) => (
                    <tr key={row.id} className="border-t border-hair align-top">
                      <td className="whitespace-nowrap px-4 py-2 text-fg-muted">
                        {formatDateTime(row.createdAt)}
                      </td>
                      <td className="px-4 py-2">
                        <p className="text-fg">{row.actor}</p>
                        {row.actorEmail ? (
                          <p className="text-[11px] text-fg-muted">{row.actorEmail}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 font-mono text-[11px] text-fg-secondary">{row.action}</td>
                      <td className="px-4 py-2 text-fg-muted">
                        {row.entityType ?? '—'}
                        {row.entityId ? (
                          <span className="block font-mono text-[10.5px] text-fg-faint">{row.entityId}</span>
                        ) : null}
                      </td>
                      <td className="max-w-[46ch] px-4 py-2 text-fg-secondary">{row.summary ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-hair px-4 py-3">
          <p className="text-[11.5px] text-fg-muted">
            Page {page} of {pages}
          </p>
          <div className="flex gap-2">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
              Previous
            </Button>
            <Button
              size="sm"
              disabled={page >= pages}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
