import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  listSubcontractorInvoicesFn,
  submitSubcontractorInvoiceFn,
} from '../server/invoicing.functions'
import {
  Button,
  Card,
  ErrorPanel,
  Field,
  Input,
  Select,
  Textarea,
  formatDate,
  formatMoney,
} from '../../work-orders/components/ui'

type Line = { kind: 'labour' | 'part' | 'special'; description: string; qty: string; rate: string }

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function SubInvoicePortal() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['sub-invoices'],
    queryFn: () => listSubcontractorInvoicesFn(),
  })
  const [workOrderId, setWorkOrderId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(today())
  const [taxProvince, setTaxProvince] = useState('ON')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([{ kind: 'labour', description: '', qty: '0', rate: '0' }])
  const submit = useMutation({
    mutationFn: () =>
      submitSubcontractorInvoiceFn({
        data: {
          workOrderId: Number(workOrderId),
          invoiceNumber,
          invoiceDate,
          taxProvince,
          notes: notes || null,
          lines: lines.map((line) => ({
            kind: line.kind,
            description: line.description || null,
            qty: line.qty,
            rate: line.rate,
          })),
        },
      }),
    onSuccess: () => {
      setInvoiceNumber('')
      setLines([{ kind: 'labour', description: '', qty: '0', rate: '0' }])
      void queryClient.invalidateQueries({ queryKey: ['sub-invoices'] })
    },
  })

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">
          Subcontractor portal
        </p>
        <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">
          Your invoices
        </h1>
        <p className="mt-1 max-w-[68ch] text-[13.5px] text-fg-secondary">
          Submit a purchase invoice against one of your work orders. The office reviews it; approval
          queues the Sage posting. You only ever see your own company&apos;s invoices.
        </p>
      </div>

      <Card title="Submit an invoice">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submit.mutate()
          }}
        >
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Work order number" required>
              <Input data-testid="sub-work-order" value={workOrderId} onChange={(e) => setWorkOrderId(e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="Your invoice number" required>
              <Input data-testid="sub-invoice-number" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
            </Field>
            <Field label="Invoice date" required>
              <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </Field>
            <Field label="Tax province">
              <Input value={taxProvince} onChange={(e) => setTaxProvince(e.target.value)} />
            </Field>
            <Field label="Notes" className="md:col-span-2">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>

          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-hair text-left text-[10px] uppercase tracking-[0.08em] text-fg-muted">
                <th className="py-2 pr-2">Kind</th>
                <th className="py-2 pr-2">Description</th>
                <th className="py-2 pr-2">Qty / hours</th>
                <th className="py-2 pr-2">Rate</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={index} className="border-b border-hair">
                  <td className="py-2 pr-2">
                    <Select
                      value={line.kind}
                      onChange={(e) =>
                        setLines(lines.map((row, i) => (i === index ? { ...row, kind: e.target.value as Line['kind'] } : row)))
                      }
                      className="w-[110px]"
                    >
                      <option value="labour">Labour</option>
                      <option value="part">Part</option>
                      <option value="special">Special</option>
                    </Select>
                  </td>
                  <td className="py-2 pr-2">
                    <Input value={line.description} onChange={(e) => setLines(lines.map((row, i) => (i === index ? { ...row, description: e.target.value } : row)))} />
                  </td>
                  <td className="py-2 pr-2">
                    <Input data-testid={`sub-line-qty-${index}`} value={line.qty} onChange={(e) => setLines(lines.map((row, i) => (i === index ? { ...row, qty: e.target.value } : row)))} className="w-[90px]" />
                  </td>
                  <td className="py-2 pr-2">
                    <Input data-testid={`sub-line-rate-${index}`} value={line.rate} onChange={(e) => setLines(lines.map((row, i) => (i === index ? { ...row, rate: e.target.value } : row)))} className="w-[100px]" />
                  </td>
                  <td className="py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setLines(lines.filter((_, i) => i !== index))} disabled={lines.length === 1}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button size="sm" onClick={() => setLines([...lines, { kind: 'part', description: '', qty: '0', rate: '0' }])}>
            Add line
          </Button>
          {submit.isError ? <ErrorPanel message={submit.error.message} /> : null}
          <Button data-testid="sub-submit" type="submit" variant="primary" disabled={submit.isPending || !workOrderId || !invoiceNumber}>
            {submit.isPending ? 'Submitting…' : 'Submit invoice'}
          </Button>
        </form>
      </Card>

      <Card title="Submitted invoices">
        {query.isError ? <ErrorPanel message={query.error.message} /> : null}
        {query.isPending ? (
          <p className="text-[13px] text-fg-muted">Loading…</p>
        ) : (query.data ?? []).length === 0 ? (
          <p className="text-[13px] text-fg-muted">No invoices submitted yet.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-hair text-left text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
                <th className="py-2">Invoice</th>
                <th className="py-2">Work order</th>
                <th className="py-2">Date</th>
                <th className="py-2">Status</th>
                <th className="py-2 text-right">Total</th>
                <th className="py-2 text-right">Paid</th>
              </tr>
            </thead>
            <tbody>
              {(query.data ?? []).map((invoice) => (
                <tr key={invoice.id} data-testid={`sub-invoice-${invoice.invoiceNumber}`} className="border-b border-hair">
                  <td className="py-2">
                    <Link to="/portal/sub/invoices/$id" params={{ id: String(invoice.id) }} className="text-brand underline">
                      {invoice.invoiceNumber}
                    </Link>
                  </td>
                  <td className="py-2">{invoice.workOrderId}</td>
                  <td className="py-2">{formatDate(invoice.invoiceDate)}</td>
                  <td className="py-2 capitalize">{invoice.status.replace('_', ' ')}</td>
                  <td className="py-2 text-right">{formatMoney(invoice.totalAmount)}</td>
                  <td className="py-2 text-right">{formatMoney(invoice.paidAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
