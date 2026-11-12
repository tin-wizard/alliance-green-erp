import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, RotateCcw } from 'lucide-react'
import { Button, Card, Input } from '../../work-orders/components/ui'
import {
  approveTjxQuoteFn,
  cancelTjxQuoteFn,
  listTjxDocumentsFn,
  regenerateTjxDocumentFn,
  renderTjxOrderSheetFn,
  renderTjxQuotePdfFn,
  returnTjxQuoteFn,
  saveTjxRevisionFn,
  submitTjxQuoteFn,
} from '../server/quotes.functions'
import type { TjxQuoteDetail } from '../types'
import { ErrorNote } from './master-ui'

export function TjxQuoteActions({ quote }: { quote: TjxQuoteDetail }) {
  const queryClient = useQueryClient()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revisionNote, setRevisionNote] = useState('')

  const refresh = (saved: TjxQuoteDetail, text: string) => {
    setError(null)
    setMessage(text)
    setRevisionNote('')
    queryClient.setQueryData(['tjx', 'quote', saved.id], saved)
    void queryClient.invalidateQueries({ queryKey: ['tjx', 'quotes'] })
    void queryClient.invalidateQueries({ queryKey: ['tjx', 'documents', saved.id] })
  }

  const transition = useMutation({
    mutationFn: (action: 'submit' | 'return' | 'approve' | 'cancel') => {
      const data = { id: quote.id, version: quote.version }
      if (action === 'submit') return submitTjxQuoteFn({ data })
      if (action === 'return') return returnTjxQuoteFn({ data })
      if (action === 'approve') return approveTjxQuoteFn({ data })
      return cancelTjxQuoteFn({ data })
    },
    onSuccess: (saved) => {
      const label =
        saved.status === 3
          ? 'Submitted for approval.'
          : saved.status === 4
            ? 'Quote approved.'
            : saved.status === 5
              ? 'Quote cancelled.'
              : 'Quote returned to draft.'
      refresh(saved, label)
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'The transition failed.'),
  })

  const revision = useMutation({
    mutationFn: () =>
      saveTjxRevisionFn({
        data: { id: quote.id, version: quote.version, notes: revisionNote.trim() || null },
      }),
    onSuccess: (saved) => refresh(saved, `Saved as revision ${saved.revisionNo}.`),
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'The revision failed.'),
  })

  const quotePdf = useMutation({
    mutationFn: () => renderTjxQuotePdfFn({ data: { id: quote.id } }),
    onSuccess: (pdf) => {
      setError(null)
      setMessage(`Quote PDF generated (${pdf.pageCount ?? 1} page). Download it below.`)
      void queryClient.invalidateQueries({ queryKey: ['tjx', 'documents', quote.id] })
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'The PDF failed.'),
  })

  const orderSheet = useMutation({
    mutationFn: () => renderTjxOrderSheetFn({ data: { id: quote.id } }),
    onSuccess: (pdf) => {
      setError(null)
      setMessage(`Internal order sheet generated (${pdf.pageCount ?? 1} page). Download it below.`)
      void queryClient.invalidateQueries({ queryKey: ['tjx', 'documents', quote.id] })
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'The order sheet failed.'),
  })

  const documents = useQuery({
    queryKey: ['tjx', 'documents', quote.id],
    queryFn: () => listTjxDocumentsFn({ data: { id: quote.id } }),
  })

  const regenerate = useMutation({
    mutationFn: (documentId: string) => regenerateTjxDocumentFn({ data: { documentId } }),
    onSuccess: (pdf) => {
      setError(null)
      setMessage(`Regenerated from the saved snapshot (${pdf.pageCount ?? 1} page).`)
      void queryClient.invalidateQueries({ queryKey: ['tjx', 'documents', quote.id] })
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : 'Regeneration failed.'),
  })

  const busy =
    transition.isPending ||
    revision.isPending ||
    quotePdf.isPending ||
    orderSheet.isPending ||
    regenerate.isPending

  return (
    <Card title="Quote actions">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {quote.status === 1 ? (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => transition.mutate('submit')}
            >
              Submit for approval
            </Button>
          ) : null}
          {quote.status === 3 ? (
            <>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => transition.mutate('approve')}
              >
                Approve
              </Button>
              <Button
                disabled={busy}
                onClick={() => transition.mutate('return')}
              >
                Return to draft
              </Button>
            </>
          ) : null}
          {quote.status !== 5 ? (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Cancel this TJX quote? The record stays, with its revisions.')) {
                  transition.mutate('cancel')
                }
              }}
            >
              Cancel quote
            </Button>
          ) : null}
          <Button disabled={busy} onClick={() => quotePdf.mutate()}>
            <FileText size={13} aria-hidden="true" /> Quote PDF
          </Button>
          <Button disabled={busy} onClick={() => orderSheet.mutate()}>
            <FileText size={13} aria-hidden="true" /> Order sheet
          </Button>
        </div>

        {quote.status === 1 || quote.status === 3 ? (
          <div className="flex flex-wrap items-end gap-2 rounded-[4px] border border-hair p-3">
            <Input
              value={revisionNote}
              onChange={(event) => setRevisionNote(event.target.value)}
              placeholder="Revision note (printed on a reissued quote)"
              className="max-w-[420px]"
            />
            <Button disabled={busy || !revisionNote.trim()} onClick={() => revision.mutate()}>
              <RotateCcw size={13} aria-hidden="true" /> Save as revision
            </Button>
            <span className="text-[11.5px] text-fg-muted">
              Increments the revision number; the live quote keeps its current status.
            </span>
          </div>
        ) : null}

        <ErrorNote message={error} />
        {message ? (
          <p className="rounded-[4px] border border-brand/30 bg-brand/5 px-3 py-2 text-[12.5px] text-fg-secondary" role="status">
            {message}
          </p>
        ) : null}

        <div>
          <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">
            Generated documents
          </p>
          {documents.isPending ? (
            <p className="text-[12px] text-fg-muted">Loading document history…</p>
          ) : documents.isError ? (
            <ErrorNote message={documents.error.message} />
          ) : (documents.data ?? []).length === 0 ? (
            <p className="text-[12px] text-fg-muted">No PDFs generated yet.</p>
          ) : (
            <div className="space-y-1">
              {documents.data?.map((document) => (
                <div
                  key={document.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-hair px-2.5 py-1.5 text-[12px]"
                >
                  <span>
                    <span className="font-medium text-fg">
                      {document.kind === 'tjx-quote' ? 'Customer quote' : 'Internal order sheet'}
                    </span>
                    <span className="ml-2 text-fg-muted">
                      {new Date(document.createdAt).toLocaleString()} ·{' '}
                      {document.pageCount ?? '—'} page · {document.sha256.slice(0, 12)}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {document.url ? (
                      <a
                        href={document.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand hover:underline"
                      >
                        Download
                      </a>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => regenerate.mutate(document.id)}
                    >
                      Regenerate
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
