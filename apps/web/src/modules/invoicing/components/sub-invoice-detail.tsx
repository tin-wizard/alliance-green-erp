import { useQuery } from '@tanstack/react-query'
import { getSubcontractorInvoiceFn } from '../server/invoicing.functions'
import { Card, ErrorPanel, formatDate, formatMoney } from '../../work-orders/components/ui'

export function SubInvoiceDetail({ id }: { id: number }) {
  const query = useQuery({
    queryKey: ['sub-invoice', id],
    queryFn: () => getSubcontractorInvoiceFn({ data: { invoiceId: id } }),
  })
  if (query.isError) return <ErrorPanel message={query.error.message} />
  if (query.isPending) return <p className="text-[13px] text-fg-muted">Loading invoice…</p>
  const { invoice, lines, payments, paidAmount, balanceDue } = query.data
  return (
    <div className="space-y-5">
      <div className="border-b border-hair pb-5 pt-2">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">
          Subcontractor portal
        </p>
        <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">
          {invoice.invoiceNumber}
        </h1>
        <p className="mt-1 text-[13.5px] text-fg-secondary">
          Work order {invoice.workOrderNumber} · <span className="capitalize">{invoice.status.replace('_', ' ')}</span> ·{' '}
          {formatDate(invoice.invoiceDate)}
        </p>
      </div>
      <Card title="Lines">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-hair text-left text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
              <th className="py-2">Kind</th>
              <th className="py-2">Description</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Rate</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-b border-hair">
                <td className="py-2 capitalize">{line.kind}</td>
                <td className="py-2">{line.description ?? '—'}</td>
                <td className="py-2 text-right">{line.qty}</td>
                <td className="py-2 text-right">{formatMoney(line.rate)}</td>
                <td className="py-2 text-right">{formatMoney(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex justify-end gap-6 text-[13px]">
          <span>Paid {formatMoney(paidAmount)}</span>
          <span>Balance {formatMoney(balanceDue)}</span>
        </div>
      </Card>
      {invoice.rejectionReason ? (
        <Card title="Rejection reason">
          <p className="text-[13px]">{invoice.rejectionReason}</p>
        </Card>
      ) : null}
      <Card title="Payments">
        {payments.length === 0 ? (
          <p className="text-[13px] text-fg-muted">No payments recorded.</p>
        ) : (
          <ul className="space-y-1 text-[13px]">
            {payments.map((payment) => (
              <li key={payment.id} className="flex justify-between border-b border-hair pb-1">
                <span>{formatDate(payment.paidOn)}</span>
                <span>{formatMoney(payment.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
