import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  approveSubcontractorInvoiceFn,
  listSubcontractorInvoicesFn,
  rejectSubcontractorInvoiceFn,
} from '../server/invoicing.functions'
import { Button, Card, ErrorPanel, Input, formatDate, formatMoney } from '../../work-orders/components/ui'

export function SubInvoiceReview() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['sub-invoices', 'office'],
    queryFn: () => listSubcontractorInvoicesFn(),
  })
  const [reasons, setReasons] = useState<Record<number, string>>({})
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['sub-invoices'] })
  const approve = useMutation({
    mutationFn: (input: { invoiceId: number; version: number }) =>
      approveSubcontractorInvoiceFn({ data: input }),
    onSuccess: invalidate,
  })
  const reject = useMutation({
    mutationFn: (input: { invoiceId: number; reason: string }) =>
      rejectSubcontractorInvoiceFn({ data: input }),
    onSuccess: invalidate,
  })
  const error = approve.error ?? reject.error ?? query.error

  return (
    <div className="space-y-5">
      <div className="border-b border-hair pb-5 pt-2">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">Purchasing</p>
        <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">
          Subcontractor invoices
        </h1>
        <p className="mt-1 max-w-[68ch] text-[13.5px] text-fg-secondary">
          Review submitted purchase invoices. Approval queues the Sage posting; payment tracking
          continues on the approved invoice.
        </p>
      </div>
      {error ? <ErrorPanel message={error.message} /> : null}
      <Card padded={false}>
        {query.isPending ? (
          <p className="p-4 text-[13px] text-fg-muted">Loading…</p>
        ) : (query.data ?? []).length === 0 ? (
          <p className="p-4 text-[13px] text-fg-muted">No subcontractor invoices submitted.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-hair text-left text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
                <th className="px-4 py-2.5">Invoice</th>
                <th className="px-4 py-2.5">Work order</th>
                <th className="px-4 py-2.5">Subcontractor</th>
                <th className="px-4 py-2.5">Date</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Total</th>
                <th className="px-4 py-2.5">Review</th>
              </tr>
            </thead>
            <tbody>
              {(query.data ?? []).map((invoice) => (
                <tr key={invoice.id} data-testid={`sub-review-${invoice.invoiceNumber}`} className="border-b border-hair align-top last:border-0">
                  <td className="px-4 py-2.5">{invoice.invoiceNumber}</td>
                  <td className="px-4 py-2.5">{invoice.workOrderId}</td>
                  <td className="px-4 py-2.5">{invoice.subcontractorId}</td>
                  <td className="px-4 py-2.5">{formatDate(invoice.invoiceDate)}</td>
                  <td className="px-4 py-2.5 capitalize">
                    {invoice.status.replace('_', ' ')}
                    {invoice.rejectionReason ? (
                      <span className="block text-[11.5px] text-fg-muted">{invoice.rejectionReason}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(invoice.totalAmount)}</td>
                  <td className="px-4 py-2.5">
                    {invoice.status === 'submitted' ? (
                      <div className="flex flex-col gap-1.5">
                        <Button
                          data-testid={`sub-approve-${invoice.invoiceNumber}`}
                          size="sm"
                          variant="primary"
                          onClick={() => approve.mutate({ invoiceId: invoice.id, version: invoice.version })}
                          disabled={approve.isPending}
                        >
                          Approve
                        </Button>
                        <Input
                          aria-label={`Rejection reason for ${invoice.invoiceNumber}`}
                          placeholder="Rejection reason"
                          value={reasons[invoice.id] ?? ''}
                          onChange={(e) => setReasons({ ...reasons, [invoice.id]: e.target.value })}
                          className="w-[180px]"
                        />
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => reject.mutate({ invoiceId: invoice.id, reason: reasons[invoice.id] ?? '' })}
                          disabled={!reasons[invoice.id]?.trim() || reject.isPending}
                        >
                          Reject
                        </Button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
