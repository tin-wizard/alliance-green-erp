import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  approveTjxSubInvoiceFn,
  rejectTjxSubInvoiceFn,
  saveTjxSubInvoiceFn,
  setTjxSubInvoiceGateFn,
  submitTjxSubInvoiceFn,
} from '../server/subinvoices.functions'
import { uploadDocumentFn } from '../../work-orders/server/work-orders.functions'
import { Button, Card, Field, Input, Textarea, formatDate, formatMoney } from '../../work-orders/components/ui'
import { ErrorNote } from './master-ui'
import type { TjxGateKind, TjxSubInvoiceDetail } from '../types'

const GATES: { kind: TjxGateKind; label: string; flag: keyof Pick<TjxSubInvoiceDetail, 'chkProjectReading' | 'chkProjectPhotos' | 'chkProjectSignoff'> }[] = [
  { kind: 'post_project_fc_reading', label: 'Post-project foot-candle readings', flag: 'chkProjectReading' },
  { kind: 'post_project_photos', label: 'Post-project photos', flag: 'chkProjectPhotos' },
  { kind: 'signed_work_order', label: 'Signed work order', flag: 'chkProjectSignoff' },
]

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('The file could not be read.'))
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(file)
  })
}

function GateRow({ invoice, gate }: { invoice: TjxSubInvoiceDetail; gate: (typeof GATES)[number] }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const checked = invoice[gate.flag]
  const documents = invoice.documents.filter((document) => document.kind === gate.kind)

  const setGate = useMutation({
    mutationFn: (input: { checked: boolean; documentId: string | null }) =>
      setTjxSubInvoiceGateFn({
        data: {
          workOrderId: invoice.workOrderId,
          version: invoice.version,
          kind: gate.kind,
          checked: input.checked,
          documentId: input.documentId,
        },
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['tjx', 'sub-invoice', invoice.workOrderId], saved)
      void queryClient.invalidateQueries({ queryKey: ['tjx', 'sub-invoices'] })
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'The gate could not be saved.'),
  })

  const uploadAndCheck = async (file: File) => {
    setError(null)
    setBusy(true)
    try {
      const dataBase64 = await fileBase64(file)
      const uploaded = await uploadDocumentFn({
        data: {
          workOrderId: invoice.workOrderId,
          kind: 'document',
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          caption: gate.label,
          dataBase64,
        },
      })
      setGate.mutate({ checked: true, documentId: uploaded.id })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The upload failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-[4px] border border-hair px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[12.5px] font-medium text-fg">{gate.label}</p>
          <p className="text-[11.5px] text-fg-muted">
            {checked ? 'Evidence on file.' : 'Requires an uploaded document.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {checked ? (
            <Button size="sm" variant="ghost" disabled={busy || setGate.isPending} onClick={() => setGate.mutate({ checked: false, documentId: null })}>
              Clear
            </Button>
          ) : (
            <label className="inline-flex h-8 cursor-pointer items-center rounded-[4px] border border-hair px-3 text-[12px] font-medium text-fg-secondary hover:border-brand hover:text-brand">
              {busy ? 'Uploading…' : 'Upload'}
              <input
                type="file"
                className="sr-only"
                disabled={busy || setGate.isPending}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) void uploadAndCheck(file)
                }}
              />
            </label>
          )}
        </div>
      </div>
      {documents.length ? (
        <ul className="mt-2 space-y-1">
          {documents.map((document) => (
            <li key={document.documentId} className="text-[11.5px] text-fg-muted">
              {document.filename} · {formatDate(document.createdAt)}
            </li>
          ))}
        </ul>
      ) : null}
      <ErrorNote message={error ?? (setGate.error instanceof Error ? setGate.error.message : null)} />
    </div>
  )
}

function EditorForm({ invoice, office }: { invoice: TjxSubInvoiceDetail; office: boolean }) {
  const queryClient = useQueryClient()
  const [invoiceNumber, setInvoiceNumber] = useState(invoice.invoiceNumber)
  const [invoiceDate, setInvoiceDate] = useState(invoice.invoiceDate)
  const [taxProvince, setTaxProvince] = useState(invoice.taxProvince)
  const [notes, setNotes] = useState(invoice.notes ?? '')
  const [subNotes, setSubNotes] = useState(invoice.subNotes ?? '')
  const [installed, setInstalled] = useState<Record<number, string>>(
    Object.fromEntries(invoice.fixtures.map((fixture) => [fixture.sortOrder, fixture.installedQuantity])),
  )
  const [discrepancies, setDiscrepancies] = useState<Record<number, string>>(
    Object.fromEntries(invoice.fixtures.map((fixture) => [fixture.sortOrder, fixture.discrepancyNotes ?? ''])),
  )
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const locked = invoice.isSubmitted || invoice.status === 'approved'
  const readOnly = office || locked

  const save = useMutation({
    mutationFn: () =>
      saveTjxSubInvoiceFn({
        data: {
          workOrderId: invoice.workOrderId,
          version: invoice.version,
          invoiceNumber,
          invoiceDate,
          taxProvince,
          notes: notes || null,
          subNotes: subNotes || null,
          fixtures: invoice.fixtures.map((fixture) => ({
            quoteFixtureId: fixture.quoteFixtureId,
            roomName: fixture.roomName,
            fixtureName: fixture.fixtureName,
            quotedQuantity: fixture.quotedQuantity,
            installedQuantity: installed[fixture.sortOrder] ?? '0',
            discrepancyNotes: discrepancies[fixture.sortOrder] || null,
            sortOrder: fixture.sortOrder,
          })),
        },
      }),
    onSuccess: (saved) => {
      setError(null)
      setMessage('Draft saved. Parts and totals were recalculated by the server.')
      queryClient.setQueryData(['tjx', 'sub-invoice', invoice.workOrderId], saved)
      void queryClient.invalidateQueries({ queryKey: ['tjx', 'sub-invoices'] })
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'The draft could not be saved.'),
  })

  const submit = useMutation({
    mutationFn: async () => {
      const saved = await saveTjxSubInvoiceFn({
        data: {
          workOrderId: invoice.workOrderId,
          version: invoice.version,
          invoiceNumber,
          invoiceDate,
          taxProvince,
          notes: notes || null,
          subNotes: subNotes || null,
          fixtures: invoice.fixtures.map((fixture) => ({
            quoteFixtureId: fixture.quoteFixtureId,
            roomName: fixture.roomName,
            fixtureName: fixture.fixtureName,
            quotedQuantity: fixture.quotedQuantity,
            installedQuantity: installed[fixture.sortOrder] ?? '0',
            discrepancyNotes: discrepancies[fixture.sortOrder] || null,
            sortOrder: fixture.sortOrder,
          })),
        },
      })
      queryClient.setQueryData(['tjx', 'sub-invoice', invoice.workOrderId], saved)
      return submitTjxSubInvoiceFn({
        data: { workOrderId: saved.workOrderId, version: saved.version },
      })
    },
    onSuccess: (saved) => {
      setError(null)
      setMessage('Submitted. The office now reviews the standard invoice.')
      queryClient.setQueryData(['tjx', 'sub-invoice', invoice.workOrderId], saved)
      void queryClient.invalidateQueries({ queryKey: ['tjx', 'sub-invoices'] })
      void queryClient.invalidateQueries({ queryKey: ['tjx', 'assigned-work-orders'] })
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'The invoice could not be submitted.'),
  })

  const approve = useMutation({
    mutationFn: () =>
      approveTjxSubInvoiceFn({
        data: { workOrderId: invoice.workOrderId, version: invoice.version },
      }),
    onSuccess: (saved) => {
      setError(null)
      setMessage('Approved. Sage posting queued; the work order is Pending Invoice.')
      queryClient.setQueryData(['tjx', 'sub-invoice', invoice.workOrderId], saved)
      void queryClient.invalidateQueries({ queryKey: ['tjx', 'sub-invoices'] })
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'The invoice could not be approved.'),
  })

  const reject = useMutation({
    mutationFn: () =>
      rejectTjxSubInvoiceFn({
        data: { workOrderId: invoice.workOrderId, version: invoice.version, reason },
      }),
    onSuccess: (saved) => {
      setError(null)
      setMessage('Rejected. The subcontractor can correct and resubmit.')
      setReason('')
      queryClient.setQueryData(['tjx', 'sub-invoice', invoice.workOrderId], saved)
      void queryClient.invalidateQueries({ queryKey: ['tjx', 'sub-invoices'] })
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'The invoice could not be rejected.'),
  })

  const busy = save.isPending || submit.isPending || approve.isPending || reject.isPending

  return (
    <div className="space-y-5">
      <Card title={`TJX invoice for work order ${invoice.workOrderId}`}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-[12px] text-fg-secondary">
            <span>Quote {invoice.quoteNumber}</span>
            <span>Status: {invoice.status}</span>
            {invoice.rejectedCount > 0 ? <span>Rejected {invoice.rejectedCount}×</span> : null}
            {invoice.subcontractorInvoiceId ? (
              <span>Standard invoice {invoice.subcontractorInvoiceId}</span>
            ) : null}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Your invoice number" required>
              <Input
                value={invoiceNumber}
                disabled={readOnly}
                onChange={(event) => setInvoiceNumber(event.target.value)}
              />
            </Field>
            <Field label="Invoice date" required>
              <Input
                type="date"
                value={invoiceDate}
                disabled={readOnly}
                onChange={(event) => setInvoiceDate(event.target.value)}
              />
            </Field>
            <Field label="Tax province" required>
              <Input
                value={taxProvince}
                disabled={readOnly}
                onChange={(event) => setTaxProvince(event.target.value.toUpperCase())}
              />
            </Field>
            <Field label="Notes" className="md:col-span-3">
              <Textarea value={notes} disabled={readOnly} onChange={(event) => setNotes(event.target.value)} />
            </Field>
            {office ? (
              <Field label="Internal note" className="md:col-span-3">
                <Textarea value={subNotes} disabled={readOnly} onChange={(event) => setSubNotes(event.target.value)} />
              </Field>
            ) : null}
          </div>
        </div>
      </Card>

      <Card title="Installed fixtures">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-hair text-left text-[10px] uppercase tracking-[0.08em] text-fg-muted">
                <th className="py-2 pr-2">Room</th>
                <th className="py-2 pr-2">Fixture</th>
                <th className="py-2 pr-2">Quoted</th>
                <th className="py-2 pr-2">Installed</th>
                <th className="py-2 pr-2">Discrepancy</th>
              </tr>
            </thead>
            <tbody>
              {invoice.fixtures.map((fixture) => (
                <tr key={fixture.id} className="border-b border-hair">
                  <td className="py-2 pr-2">{fixture.roomName}</td>
                  <td className="py-2 pr-2">{fixture.fixtureName}</td>
                  <td className="py-2 pr-2 tabular-nums">{fixture.quotedQuantity}</td>
                  <td className="py-2 pr-2">
                    <Input
                      value={installed[fixture.sortOrder] ?? ''}
                      disabled={readOnly}
                      inputMode="decimal"
                      className="w-[100px]"
                      onChange={(event) =>
                        setInstalled({ ...installed, [fixture.sortOrder]: event.target.value })
                      }
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <Input
                      value={discrepancies[fixture.sortOrder] ?? ''}
                      disabled={readOnly}
                      onChange={(event) =>
                        setDiscrepancies({ ...discrepancies, [fixture.sortOrder]: event.target.value })
                      }
                    />
                  </td>
                </tr>
              ))}
              {invoice.fixtures.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-3 text-[12.5px] text-fg-muted">
                    This quote has no fixtures. Add fixtures to the quote and save the draft again.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {!readOnly ? (
          <div className="mt-3">
            <Button disabled={busy} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : 'Save draft'}
            </Button>
          </div>
        ) : null}
      </Card>

      <Card title="Parts and rates">
        {invoice.missingRates.length ? (
          <ErrorNote message={`No install rate for: ${invoice.missingRates.join(', ')}. Ask the office to add the rates.`} />
        ) : null}
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-hair text-left text-[10px] uppercase tracking-[0.08em] text-fg-muted">
              <th className="py-2 pr-2">Part</th>
              <th className="py-2 pr-2">Quantity</th>
              <th className="py-2 pr-2">Rate</th>
              <th className="py-2 pr-2">Source</th>
              <th className="py-2 text-right">Line</th>
            </tr>
          </thead>
          <tbody>
            {invoice.parts.map((part) => (
              <tr key={part.partNo} className="border-b border-hair">
                <td className="py-2 pr-2">
                  {part.partNo}
                  {part.description ? <span className="ml-1 text-fg-muted">{part.description}</span> : null}
                </td>
                <td className="py-2 pr-2 tabular-nums">{part.quantity}</td>
                <td className="py-2 pr-2 tabular-nums">{formatMoney(part.unitRate)}</td>
                <td className="py-2 pr-2 text-fg-muted">{part.rateSource.replace('_', ' ')}</td>
                <td className="py-2 text-right tabular-nums">{formatMoney(part.lineSubtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="mt-3 grid gap-1 text-[12.5px] sm:grid-cols-2">
          <div className="flex justify-between gap-4"><dt>Subtotal</dt><dd>{formatMoney(invoice.subtotal)}</dd></div>
          <div className="flex justify-between gap-4"><dt>Tax</dt><dd>{formatMoney(invoice.tax)}</dd></div>
          <div className="flex justify-between gap-4 font-medium"><dt>Total</dt><dd>{formatMoney(invoice.total)}</dd></div>
        </dl>
      </Card>

      <Card title="Three gates">
        <div className="space-y-2">
          {GATES.map((gate) => (
            <GateRow key={`${gate.kind}-${invoice.version}`} invoice={invoice} gate={gate} />
          ))}
        </div>
        {!readOnly ? (
          <div className="mt-3">
            <Button variant="primary" disabled={busy} onClick={() => submit.mutate()}>
              {submit.isPending ? 'Submitting…' : 'Submit invoice'}
            </Button>
          </div>
        ) : null}
      </Card>

      {office && invoice.isSubmitted ? (
        <Card title="Office review">
          <div className="space-y-3">
            <Button variant="primary" disabled={busy} onClick={() => approve.mutate()}>
              {approve.isPending ? 'Approving…' : 'Approve invoice'}
            </Button>
            <Field label="Rejection reason">
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
            </Field>
            <Button disabled={busy || !reason.trim()} onClick={() => reject.mutate()}>
              {reject.isPending ? 'Rejecting…' : 'Reject invoice'}
            </Button>
          </div>
        </Card>
      ) : null}

      {office ? null : (
        <p className="text-[11.5px] text-fg-muted">
          Rates come from the office rate table. The server recalculates every part, tax line and total
          when you save.
        </p>
      )}

      <ErrorNote message={error} />
      {message ? (
        <p className="rounded-[4px] border border-brand/30 bg-brand/5 px-3 py-2 text-[12.5px] text-fg-secondary" role="status">
          {message}
        </p>
      ) : null}
    </div>
  )
}

export function TjxSubInvoiceScreen({ invoice, office = false }: { invoice: TjxSubInvoiceDetail; office?: boolean }) {
  return <EditorForm key={`${invoice.id}-${invoice.version}`} invoice={invoice} office={office} />
}
