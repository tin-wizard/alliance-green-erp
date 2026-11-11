import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileText, Pencil, Plus } from 'lucide-react'
import { StatusChip } from '../../../shell/status-chip'
import { Button, Card, EmptyState, ErrorPanel, Field, Input, Textarea, formatDate, formatMoney } from '../../work-orders/components/ui'
import {
  convertQuoteFn,
  createPackingSlipFn,
  deleteQuoteFn,
  getQuoteFn,
  listQuoteDocumentsFn,
  regenerateQuotePdfFn,
  rejectQuoteFn,
  renderQuotePdfFn,
  resubmitQuoteFn,
  reviseQuoteFn,
  transitionQuoteFn,
} from '../server/quotes.functions'
import type { QuoteDetail, QuoteStatusCode } from '../types'

function chipStatus(status: QuoteStatusCode) {
  if (status === 1) return 'progress' as const
  if (status === 2) return 'draft' as const
  if (status === 3) return 'pending' as const
  if (status === 4) return 'approved' as const
  return 'cancelled' as const
}

type Tab = 'lines' | 'revisions' | 'rejections' | 'packing' | 'pdfs'

export function QuoteDetailScreen({ id }: { id: number }) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('lines')
  const [notice, setNotice] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [showReject, setShowReject] = useState(false)

  const quote = useQuery({
    queryKey: ['quote', id],
    queryFn: () => getQuoteFn({ data: { id } }),
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['quote', id] })
    void queryClient.invalidateQueries({ queryKey: ['quotes'] })
  }

  const transition = useMutation({
    mutationFn: (to: QuoteStatusCode) =>
      transitionQuoteFn({
        data: { id, version: quote.data!.version, to },
      }),
    onSuccess: (result) => {
      setNotice(`Quote status updated to ${result.status}.`)
      refresh()
    },
    onError: (error: Error) => setNotice(error.message),
  })

  const reject = useMutation({
    mutationFn: () =>
      rejectQuoteFn({ data: { id, version: quote.data!.version, reason: rejectReason } }),
    onSuccess: () => {
      setNotice('Quote rejected and recorded.')
      setShowReject(false)
      setRejectReason('')
      refresh()
    },
    onError: (error: Error) => setNotice(error.message),
  })

  const revise = useMutation({
    mutationFn: () => reviseQuoteFn({ data: { id } }),
    onSuccess: (result) => {
      setNotice(`Revision ${result.revisionId} created.`)
      refresh()
    },
    onError: (error: Error) => setNotice(error.message),
  })

  const resubmit = useMutation({
    mutationFn: () => resubmitQuoteFn({ data: { id } }),
    onSuccess: (result) => {
      setNotice(`Revision ${result.revisionId} submitted for approval.`)
      refresh()
    },
    onError: (error: Error) => setNotice(error.message),
  })

  const remove = useMutation({
    mutationFn: () => deleteQuoteFn({ data: { id } }),
    onSuccess: () => setNotice('Standalone quote deleted.'),
    onError: (error: Error) => setNotice(error.message),
  })

  const convert = useMutation({
    mutationFn: () => convertQuoteFn({ data: { id } }),
    onSuccess: (result) => {
      setNotice(`Created work order ${result.workOrderId}.`)
      refresh()
    },
    onError: (error: Error) => setNotice(error.message),
  })

  const pdf = useMutation({
    mutationFn: () => renderQuotePdfFn({ data: { id } }),
    onSuccess: (result) => {
      setNotice(`PDF generated (${result.byteSize} bytes, ${result.pageCount ?? '?'} pages).`)
      if (result.url) window.open(result.url, '_blank', 'noopener,noreferrer')
      void queryClient.invalidateQueries({ queryKey: ['quote-documents', id] })
    },
    onError: (error: Error) => setNotice(error.message),
  })

  if (quote.isPending) return <div className="h-[360px] animate-pulse rounded-[6px] bg-subtle" />
  if (quote.isError) return <ErrorPanel message={(quote.error as Error).message} retry={() => void quote.refetch()} />
  const data = quote.data

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'lines', label: 'Lines' },
    { key: 'revisions', label: `Revisions (${data.revisions.length})` },
    { key: 'rejections', label: `Rejections (${data.rejections.length})` },
    { key: 'packing', label: `Packing (${data.packingSlips.length})` },
    { key: 'pdfs', label: 'PDFs' },
  ]

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12px] text-fg-muted">
        <Link to="/quotes" search={{ kind: 'all', status: null, q: '', size: 25, cursor: null }} className="hover:text-fg">
          Quotes
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-fg">#{data.numberLabel}</span>
      </nav>

      <div className="border-b border-hair pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={chipStatus(data.status)} />
          <span className="text-[11px] uppercase tracking-[0.12em] text-fg-muted">{data.kind}</span>
          {data.isRevision ? (
            <span className="text-[11px] text-fg-muted">
              Revision {data.revisionId} of #{data.rootQuoteId ?? data.id}
            </span>
          ) : null}
          {data.convertedWorkOrderId ? (
            <Link
              to="/work-orders/$id"
              params={{ id: String(data.convertedWorkOrderId) }}
              className="text-[12px] font-medium text-brand hover:underline"
            >
              Work order {data.convertedWorkOrderId}
            </Link>
          ) : null}
        </div>
        <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-serif text-[26px] leading-tight text-fg">
              Quote #{data.numberLabel}
              <span className="text-fg-muted"> — {data.siteName ?? `Site ${data.siteId}`}</span>
            </h1>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-fg-muted">
              <span>{data.customerName ?? 'No billing customer'}</span>
              <span>
                {[data.shipCity, data.shipProvince, data.shipPostalCode].filter(Boolean).join(', ')}
              </span>
              <span>Due {data.isDueDateTbd ? 'TBD' : data.dueDate ? formatDate(data.dueDate) : '—'}</span>
              <span>Created {formatDate(data.dateCreated)}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {notice ? (
              <p role="status" className="max-w-[380px] text-[12px] text-fg-secondary">
                {notice}
              </p>
            ) : null}
            {data.capabilities.canEdit ? (
              <Link
                to="/quotes/$id/edit"
                params={{ id: String(data.id) }}
                className="inline-flex h-9 items-center gap-1.5 rounded-[4px] border border-[var(--border-strong)] px-3 text-[13px] text-fg hover:bg-subtle"
              >
                <Pencil size={14} aria-hidden="true" /> Edit
              </Link>
            ) : null}
            {data.capabilities.canSubmit ? (
              <Button onClick={() => transition.mutate(3)} disabled={transition.isPending}>
                Submit for approval
              </Button>
            ) : null}
            {data.capabilities.canApprove ? (
              <Button variant="primary" onClick={() => transition.mutate(4)} disabled={transition.isPending}>
                Approve
              </Button>
            ) : null}
            {data.capabilities.canApprove ? (
              <Button variant="danger" onClick={() => setShowReject((value) => !value)}>
                Reject
              </Button>
            ) : null}
            {data.capabilities.canConvert ? (
              <Button variant="primary" onClick={() => convert.mutate()} disabled={convert.isPending}>
                Convert to work order
              </Button>
            ) : null}
            {data.capabilities.canRevise ? (
              <Button onClick={() => revise.mutate()} disabled={revise.isPending}>
                New revision
              </Button>
            ) : null}
            {data.status === 5 && data.isLastRevision ? (
              <Button onClick={() => resubmit.mutate()} disabled={resubmit.isPending}>
                Resubmit
              </Button>
            ) : null}
            {data.capabilities.canDelete ? (
              <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
                Delete
              </Button>
            ) : null}
            <Button onClick={() => pdf.mutate()} disabled={pdf.isPending}>
              <FileText size={14} aria-hidden="true" /> {pdf.isPending ? 'Rendering…' : 'Quote PDF'}
            </Button>
          </div>
        </div>
        {showReject ? (
          <div className="mt-4 rounded-[4px] border border-hair bg-subtle p-3">
            <Field label="Rejection reason">
              <Textarea rows={2} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} />
            </Field>
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setShowReject(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={reject.isPending || rejectReason.trim().length < 3}
                onClick={() => reject.mutate()}
              >
                Record rejection
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-1 overflow-x-auto border-b border-hair" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => setTab(item.key)}
            className={
              tab === item.key
                ? 'border-b-2 border-brand px-3 py-2 text-[12.5px] font-medium text-fg'
                : 'border-b-2 border-transparent px-3 py-2 text-[12.5px] text-fg-muted hover:text-fg'
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'lines' ? <LinesTab data={data} /> : null}
      {tab === 'revisions' ? <RevisionsTab data={data} /> : null}
      {tab === 'rejections' ? <RejectionsTab data={data} /> : null}
      {tab === 'packing' ? <PackingTab data={data} /> : null}
      {tab === 'pdfs' ? <PdfsTab id={id} /> : null}
    </div>
  )
}

function LinesTab({ data }: { data: QuoteDetail }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card title="Subtotal">
          <p className="text-[22px] font-semibold tabular-nums">{formatMoney(data.totals.subtotal)}</p>
        </Card>
        <Card title={`Tax (${data.totals.taxProvince})`}>
          <p className="text-[22px] font-semibold tabular-nums">{formatMoney(data.totals.tax)}</p>
        </Card>
        <Card title="Total">
          <p className="text-[22px] font-semibold tabular-nums">{formatMoney(data.totals.total)}</p>
        </Card>
        <Card title={`Margin (${data.totals.marginPercent}%)`}>
          <p className="text-[22px] font-semibold tabular-nums">{formatMoney(data.totals.margin)}</p>
          <p className="text-[11.5px] text-fg-muted">
            Incurred {formatMoney(data.totals.incurredSubtotal)}
          </p>
        </Card>
      </div>

      <LineTable title="Labour" lines={data.hours.map((line) => [
        line.lineDate ? formatDate(line.lineDate) : '—',
        `${line.hours} h × ${line.numTechs}`,
        formatMoney(line.rate),
        formatMoney(line.incurredRate ?? '0'),
        line.note ?? '—',
      ])} headers={['Date', 'Hours × techs', 'Rate', 'Incurred rate', 'Note']} />

      <LineTable title="Parts" lines={data.parts.map((line) => [
        line.partNo,
        line.description ?? '—',
        String(line.qty),
        formatMoney(line.price),
        formatMoney(line.costPrice ?? '0'),
      ])} headers={['Part', 'Description', 'Qty', 'Price', 'Incurred price']} />

      <LineTable title="Special-order parts" lines={data.specialParts.map((line) => [
        line.name,
        String(line.qty),
        formatMoney(line.price),
        formatMoney(line.costPrice ?? '0'),
      ])} headers={['Description', 'Qty', 'Price', 'Incurred price']} />

      <Card title="Notes">
        <p className="whitespace-pre-wrap text-[12.5px] text-fg-secondary">
          {data.report || data.notes || 'No notes.'}
        </p>
      </Card>
    </div>
  )
}

function LineTable({
  title,
  headers,
  lines,
}: {
  title: string
  headers: string[]
  lines: string[][]
}) {
  return (
    <Card title={title} padded={false}>
      {lines.length === 0 ? (
        <p className="px-4 py-5 text-[12.5px] text-fg-muted">No lines.</p>
      ) : (
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-subtle text-left text-[10px] uppercase tracking-[0.08em] text-fg-muted">
              {headers.map((header) => (
                <th key={header} className="px-4 py-2 font-semibold">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index} className="border-t border-hair">
                {line.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-4 py-2">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

function RevisionsTab({ data }: { data: QuoteDetail }) {
  return (
    <Card title="Revision chain" padded={false}>
      {data.revisions.length === 0 ? (
        <EmptyState title="No revisions" />
      ) : (
        <ul className="divide-y divide-hair">
          {data.revisions.map((revision) => (
            <li key={revision.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[12.5px]">
              <Link to="/quotes/$id" params={{ id: String(revision.id) }} className="font-medium text-brand hover:underline">
                #{revision.id}
              </Link>
              <span className="text-fg-muted">rev {revision.revisionId}</span>
              <span>{revision.isLastRevision ? 'Current' : 'Superseded'}</span>
              <span className="text-fg-muted">{formatDate(revision.createdAt.slice(0, 10))}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function RejectionsTab({ data }: { data: QuoteDetail }) {
  return (
    <Card title="Rejections" padded={false}>
      {data.rejections.length === 0 ? (
        <EmptyState title="No rejections" />
      ) : (
        <ul className="divide-y divide-hair">
          {data.rejections.map((rejection) => (
            <li key={rejection.id} className="px-4 py-3">
              <p className="text-[13px] text-fg">{rejection.reason}</p>
              <p className="mt-1 text-[11.5px] text-fg-muted">
                {rejection.rejectedByDetail ?? 'Customer'} · {formatDate(rejection.rejectedAt.slice(0, 10))}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function PackingTab({ data }: { data: QuoteDetail }) {
  const queryClient = useQueryClient()
  const [shipped, setShipped] = useState<Record<number, number>>(() =>
    Object.fromEntries(data.parts.map((line) => [line.id, line.qty])),
  )
  const [error, setError] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: () =>
      createPackingSlipFn({
        data: {
          quoteId: data.id,
          parts: data.parts.map((line) => ({
            quotePartId: line.id,
            partNo: line.partNo,
            actualQty: line.qty,
            shippedQty: shipped[line.id] ?? line.qty,
            backorderQty: Math.max(0, line.qty - (shipped[line.id] ?? line.qty)),
          })),
          specialParts: data.specialParts.map((line) => ({
            quoteSpecialPartId: line.id,
            name: line.name,
            actualQty: line.qty,
            shippedQty: line.qty,
            backorderQty: 0,
          })),
        },
      }),
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['quote', data.id] })
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  })

  return (
    <div className="space-y-4">
      <Card title="Create packing slip">
        {data.status !== 4 ? (
          <p className="text-[12.5px] text-fg-secondary">Approve the quote before issuing a packing slip.</p>
        ) : (
          <>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-subtle text-left text-[10px] uppercase tracking-[0.08em] text-fg-muted">
                  <th className="px-3 py-2">Part</th>
                  <th className="px-3 py-2">Qty</th>
                  <th className="px-3 py-2">Shipped</th>
                </tr>
              </thead>
              <tbody>
                {data.parts.map((line) => (
                  <tr key={line.id} className="border-t border-hair">
                    <td className="px-3 py-2">{line.partNo}</td>
                    <td className="px-3 py-2 tabular-nums">{line.qty}</td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        min={0}
                        value={shipped[line.id] ?? line.qty}
                        onChange={(event) =>
                          setShipped((current) => ({ ...current, [line.id]: Number(event.target.value) }))
                        }
                        className="h-8 w-24"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {error ? <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p> : null}
            <div className="mt-3 flex justify-end">
              <Button variant="primary" onClick={() => create.mutate()} disabled={create.isPending}>
                <Plus size={14} aria-hidden="true" /> Create packing slip
              </Button>
            </div>
          </>
        )}
      </Card>
      <Card title="Packing slips" padded={false}>
        {data.packingSlips.length === 0 ? (
          <EmptyState title="No packing slips" />
        ) : (
          <ul className="divide-y divide-hair">
            {data.packingSlips.map((slip) => (
              <li key={slip.id} className="flex items-center gap-3 px-4 py-2.5 text-[12.5px]">
                <span className="font-medium">PS-{slip.id}</span>
                <span className="text-fg-muted">Created {formatDate(slip.dateCreated)}</span>
                <span className="text-fg-muted">Ship {slip.shipDate ? formatDate(slip.shipDate) : '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function PdfsTab({ id }: { id: number }) {
  const queryClient = useQueryClient()
  const docs = useQuery({
    queryKey: ['quote-documents', id],
    queryFn: () => listQuoteDocumentsFn({ data: { id } }),
  })
  const regenerate = useMutation({
    mutationFn: (documentId: string) => regenerateQuotePdfFn({ data: { id, documentId } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['quote-documents', id] }),
  })
  if (docs.isPending) return <div className="h-[180px] animate-pulse rounded-[6px] bg-subtle" />
  if (docs.isError) return <ErrorPanel message={(docs.error as Error).message} />
  return (
    <Card title="Generated documents" padded={false}>
      {docs.data.length === 0 ? (
        <EmptyState title="No PDFs yet" description="Use “Quote PDF” to render one." />
      ) : (
        <ul className="divide-y divide-hair">
          {docs.data.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[12.5px]">
              <span className="font-medium">{doc.kind}</span>
              <span className="text-fg-muted">v{doc.schemaVersion}</span>
              <span className="text-fg-muted">{doc.pageCount ?? '?'} pages</span>
              <span className="text-fg-muted">{doc.byteSize} bytes</span>
              <span className="font-mono text-[10.5px] text-fg-faint">{doc.sha256.slice(0, 12)}</span>
              {doc.url ? (
                <a href={doc.url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-brand">
                  <Download size={13} aria-hidden="true" /> Open
                </a>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => regenerate.mutate(doc.id)}>
                Regenerate
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
