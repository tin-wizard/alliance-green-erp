import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  getInvoiceFn,
  issueInvoiceFn,
  previewInvoiceFn,
  recordInvoicePaymentFn,
  regenerateInvoiceDocumentFn,
  rejectInvoiceFn,
  resubmitInvoiceFn,
  saveInvoiceFn,
} from '../server/invoicing.functions'
import type { InvoiceDetail } from '../server/get.server'
import {
  Button,
  Card,
  ErrorPanel,
  Field,
  Input,
  Textarea,
  formatDate,
  formatDateTime,
  formatMoney,
} from '../../work-orders/components/ui'

type LabourRow = {
  date: string
  hours: string
  rateCode: number
  hourlyRate: string
  description: string
}
type PartRow = { partNo: string; description: string; qty: string; price: string; isLocalPart: boolean }
type SpecialRow = {
  name: string
  qty: string
  price: string
  isEmergencyLighting: boolean
  isLocalPart: boolean
  warrantyYears: string
  laborWarrantyYears: string
}
type Totals = { labour: string; material: string; subtotal: string; tax: string; total: string }

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function InvoiceDetailScreen({ id }: { id: number }) {
  const query = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => getInvoiceFn({ data: { invoiceId: id } }),
  })
  if (query.isPending) return <p className="text-[13px] text-fg-muted">Loading invoice…</p>
  if (query.isError) return <ErrorPanel message={query.error.message} />
  return <InvoiceDetailBody key={`${query.data.invoice.version}-${query.data.invoice.status}`} detail={query.data} />
}

function InvoiceDetailBody({ detail }: { detail: InvoiceDetail }) {
  const queryClient = useQueryClient()
  const invoice = detail.invoice
  const [labour, setLabour] = useState<LabourRow[]>(() =>
    detail.labour.length > 0
      ? detail.labour.map((line) => ({
          date: line.lineDate,
          hours: line.hours,
          rateCode: line.rateCode,
          hourlyRate: line.hourlyRate,
          description: line.description ?? '',
        }))
      : [{ date: invoice.invoiceDate || today(), hours: '0', rateCode: 1, hourlyRate: '0', description: '' }],
  )
  const [parts] = useState<PartRow[]>(() =>
    detail.parts.map((line) => ({
      partNo: line.partNo,
      description: line.description ?? '',
      qty: line.qty,
      price: line.price,
      isLocalPart: line.isLocalPart,
    })),
  )
  const [specialParts] = useState<SpecialRow[]>(() =>
    detail.specialParts.map((line) => ({
      name: line.name,
      qty: line.qty,
      price: line.price,
      isEmergencyLighting: line.isEmergencyLighting,
      isLocalPart: line.isLocalPart,
      warrantyYears: line.warrantyYears ?? '',
      laborWarrantyYears: line.laborWarrantyYears ?? '',
    })),
  )
  const [totals, setTotals] = useState<Totals>({
    labour: invoice.labourAmount,
    material: invoice.materialAmount,
    subtotal: invoice.subtotalAmount,
    tax: invoice.taxAmount,
    total: invoice.totalAmount,
  })
  const [taxProvince, setTaxProvince] = useState(invoice.taxProvince)
  const [manualTax, setManualTax] = useState(invoice.manualTaxAmount ?? '')
  const [manualSubtotal, setManualSubtotal] = useState(invoice.manualSubtotalAmount ?? '')
  const [notes, setNotes] = useState(invoice.notes ?? '')
  const [reason, setReason] = useState('')
  const [paymentAmount, setPaymentAmount] = useState(detail.balanceDue)
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['invoice', invoice.id] })

  const previewInput = useMemo(
    () => ({
      taxProvince,
      workOrderId: invoice.workOrderId,
      appliedTaxRate: invoice.appliedTaxRate,
      manualTaxAmount: manualTax || null,
      manualSubtotalAmount: manualSubtotal || null,
      labour: labour.map((line) => ({ hours: line.hours, rate: line.hourlyRate })),
      parts: parts.map((line) => ({ partNo: line.partNo, qty: line.qty, price: line.price })),
      specialParts: specialParts.map((line) => ({ name: line.name, qty: line.qty, price: line.price })),
    }),
    [taxProvince, invoice.workOrderId, invoice.appliedTaxRate, manualTax, manualSubtotal, labour, parts, specialParts],
  )

  const preview = useMutation({
    mutationFn: () => previewInvoiceFn({ data: previewInput as never }),
    onSuccess: (result) =>
      setTotals({
        labour: result.labour,
        material: result.material,
        subtotal: result.subtotal,
        tax: result.tax,
        total: result.total,
      }),
  })
  const save = useMutation({
    mutationFn: () =>
      saveInvoiceFn({
        data: {
          invoiceId: invoice.id,
          version: invoice.version,
          invoiceDate: invoice.invoiceDate,
          taxProvince,
          appliedTaxRate: invoice.appliedTaxRate,
          appliedTaxRatePst: invoice.appliedTaxRatePst,
          manualTaxAmount: manualTax || null,
          manualSubtotalAmount: manualSubtotal || null,
          notes: notes || null,
          labour: labour.map((line) => ({
            date: line.date,
            hours: line.hours,
            rateCode: line.rateCode,
            hourlyRate: line.hourlyRate,
            description: line.description || null,
          })),
          parts,
          specialParts: specialParts.map((line) => ({
            ...line,
            warrantyYears: line.warrantyYears || null,
            laborWarrantyYears: line.laborWarrantyYears || null,
          })),
          totals,
        },
      }),
    onSuccess: invalidate,
  })
  const issue = useMutation({
    mutationFn: () => issueInvoiceFn({ data: { invoiceId: invoice.id, version: invoice.version } }),
    onSuccess: invalidate,
  })
  const reject = useMutation({
    mutationFn: () => rejectInvoiceFn({ data: { invoiceId: invoice.id, reason } }),
    onSuccess: invalidate,
  })
  const resubmit = useMutation({
    mutationFn: () => resubmitInvoiceFn({ data: { invoiceId: invoice.id } }),
    onSuccess: invalidate,
  })
  const payment = useMutation({
    mutationFn: () =>
      recordInvoicePaymentFn({
        data: { invoiceId: invoice.id, amount: paymentAmount, idempotencyKey },
      }),
    onSuccess: invalidate,
  })
  const regenerate = useMutation({
    mutationFn: (documentId: string) => regenerateInvoiceDocumentFn({ data: { documentId } }),
    onSuccess: invalidate,
  })

  const error =
    save.error ?? issue.error ?? reject.error ?? resubmit.error ?? payment.error ?? preview.error

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hair pb-5 pt-2">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">
            Sales invoice
          </p>
          <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">
            {invoice.invoiceNumber}
          </h1>
          <p className="mt-1 text-[13.5px] text-fg-secondary">
            Work order{' '}
            <Link to="/work-orders/$id" params={{ id: String(invoice.workOrderId) }} className="text-brand underline">
              {invoice.workOrderNumber}
            </Link>{' '}
            · <span data-testid="invoice-status" className="capitalize">{invoice.status.replace('_', ' ')}</span> · version {invoice.version}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10.5px] uppercase tracking-[0.1em] text-fg-muted">Total</p>
          <p className="font-serif text-[26px] text-fg">{formatMoney(invoice.totalAmount)}</p>
          <p className="text-[12px] text-fg-muted">Paid {formatMoney(detail.paidAmount)} · Balance {formatMoney(detail.balanceDue)}</p>
        </div>
      </div>

      {detail.immutability.immutable ? (
        <div className="rounded-[4px] border border-[var(--status-pending-bd)] bg-[var(--status-pending-bg)] p-3 text-[13px]">
          Locked: {detail.immutability.reason}
        </div>
      ) : null}
      {error ? <ErrorPanel message={error.message} /> : null}

      <Card title="Snapshot lines" action={<span className="text-[11.5px] text-fg-muted">Wholesale replacement on save</span>}>
        <div className="space-y-4">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-hair text-left text-[10px] uppercase tracking-[0.08em] text-fg-muted">
                <th className="py-2 pr-2">Date</th>
                <th className="py-2 pr-2">Hours</th>
                <th className="py-2 pr-2">Rate code</th>
                <th className="py-2 pr-2">Rate</th>
                <th className="py-2 pr-2">Description</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {labour.map((line, index) => (
                <tr key={index} className="border-b border-hair">
                  <td className="py-2 pr-2">
                    <Input type="date" value={line.date} onChange={(e) => update(labour, setLabour, index, { date: e.target.value })} />
                  </td>
                  <td className="py-2 pr-2">
                    <Input data-testid={`invoice-hours-${index}`} value={line.hours} onChange={(e) => update(labour, setLabour, index, { hours: e.target.value })} className="w-[80px]" />
                  </td>
                  <td className="py-2 pr-2">
                    <Input type="number" min={1} max={3} value={line.rateCode} onChange={(e) => update(labour, setLabour, index, { rateCode: Number(e.target.value) })} className="w-[70px]" />
                  </td>
                  <td className="py-2 pr-2">
                    <Input data-testid={`invoice-rate-${index}`} value={line.hourlyRate} onChange={(e) => update(labour, setLabour, index, { hourlyRate: e.target.value })} className="w-[90px]" />
                  </td>
                  <td className="py-2 pr-2">
                    <Input value={line.description} onChange={(e) => update(labour, setLabour, index, { description: e.target.value })} />
                  </td>
                  <td className="py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setLabour(labour.filter((_, i) => i !== index))} disabled={labour.length === 1}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button size="sm" onClick={() => setLabour([...labour, { date: labour[0]?.date || today(), hours: '0', rateCode: 1, hourlyRate: '0', description: '' }])}>
            Add labour line
          </Button>

          <div className="grid gap-2 md:grid-cols-2">
            <Field label="Tax province">
              <Input value={taxProvince} onChange={(e) => setTaxProvince(e.target.value)} />
            </Field>
            <Field label="Notes">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <Field label="Manual tax override" hint="Cleared whenever the subtotal changes.">
              <Input value={manualTax} onChange={(e) => setManualTax(e.target.value)} />
            </Field>
            <Field label="Manual subtotal override">
              <Input value={manualSubtotal} onChange={(e) => setManualSubtotal(e.target.value)} />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button data-testid="invoice-recalculate" onClick={() => preview.mutate()} disabled={preview.isPending}>
              {preview.isPending ? 'Calculating…' : 'Recalculate preview'}
            </Button>
            {invoice.status === 'draft' || invoice.status === 'rejected' ? (
              <Button data-testid="invoice-save" variant="primary" onClick={() => save.mutate()} disabled={save.isPending || detail.immutability.immutable}>
                {save.isPending ? 'Saving…' : 'Save snapshot'}
              </Button>
            ) : null}
            <span className="ml-auto text-[12px] text-fg-muted">
              Labour {formatMoney(totals.labour)} · Material {formatMoney(totals.material)} · Tax {formatMoney(totals.tax)}
            </span>
          </div>
          <p className="text-[12px] text-fg-muted">Stored total on the invoice: {formatMoney(invoice.totalAmount)}</p>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Lifecycle">
          <div className="space-y-3">
            {detail.canIssue ? (
              <Button data-testid="invoice-issue" variant="primary" onClick={() => issue.mutate()} disabled={issue.isPending}>
                {issue.isPending ? 'Issuing…' : 'Issue invoice'}
              </Button>
            ) : null}
            {invoice.status === 'issued' && detail.paidAmount === '0.00' ? (
              <div className="space-y-2">
                <Field label="Rejection reason" required>
                  <Input data-testid="invoice-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What did the customer reject?" />
                </Field>
                <Button data-testid="invoice-reject" variant="danger" onClick={() => reject.mutate()} disabled={!reason.trim() || reject.isPending}>
                  Record rejection
                </Button>
              </div>
            ) : null}
            {invoice.status === 'rejected' ? (
              <Button data-testid="invoice-resubmit" variant="primary" onClick={() => resubmit.mutate()} disabled={resubmit.isPending}>
                Resubmit for editing
              </Button>
            ) : null}
            {['issued', 'partially_paid'].includes(invoice.status) ? (
              <div className="space-y-2">
                <Field label="Payment amount" required>
                  <Input data-testid="invoice-payment-amount" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} />
                </Field>
                <Button data-testid="invoice-payment" onClick={() => payment.mutate()} disabled={payment.isPending}>
                  {payment.isPending ? 'Recording…' : 'Record payment'}
                </Button>
              </div>
            ) : null}
            <p className="text-[12px] text-fg-muted">
              Sage: {detail.sagePosting ? `${detail.sagePosting.status} (${detail.sagePosting.externalRef})` : 'not queued'}. Posting never blocks issue.
            </p>
          </div>
        </Card>

        <Card title="Documents">
          <div className="space-y-2">
            {detail.documents.length === 0 ? (
              <p className="text-[13px] text-fg-muted">The PDF is generated when the invoice is issued.</p>
            ) : (
              detail.documents.map((document) => (
                <div key={document.id} className="flex items-center justify-between gap-2 border-b border-hair pb-2 text-[12px]">
                  <span>
                    {formatDateTime(document.createdAt)} · {document.pageCount} page(s) · v{document.schemaVersion}
                    <span className="ml-2 font-mono text-[10.5px] text-fg-muted">{document.sha256.slice(0, 12)}</span>
                  </span>
                  <Button size="sm" onClick={() => regenerate.mutate(document.id)} disabled={regenerate.isPending}>
                    Regenerate
                  </Button>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Payments">
          {detail.payments.length === 0 ? (
            <p className="text-[13px] text-fg-muted">No payments recorded.</p>
          ) : (
            <ul className="space-y-2 text-[13px]">
              {detail.payments.map((entry) => (
                <li key={entry.id} className="flex justify-between border-b border-hair pb-1.5">
                  <span>
                    {formatDate(entry.paidOn)} · {entry.method ?? 'Payment'}
                  </span>
                  <span className="tabular-nums">{formatMoney(entry.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Rejection history">
          {detail.rejections.length === 0 ? (
            <p className="text-[13px] text-fg-muted">No rejections recorded.</p>
          ) : (
            <ul className="space-y-2 text-[13px]">
              {detail.rejections.map((entry) => (
                <li key={entry.id} className="border-b border-hair pb-2">
                  <p className="font-medium">{entry.reason}</p>
                  <p className="text-[12px] text-fg-muted">
                    {formatDateTime(entry.rejectedAt)} · {entry.resubmittedAt ? `resubmitted ${formatDateTime(entry.resubmittedAt)}` : 'not resubmitted'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

function update<T>(rows: T[], setRows: (next: T[]) => void, index: number, patch: Partial<T>) {
  setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
}
