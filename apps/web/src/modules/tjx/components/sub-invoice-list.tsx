import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { listAssignedTjxWorkOrdersFn, listTjxSubInvoicesFn } from '../server/subinvoices.functions'
import { Card, formatDate, formatMoney } from '../../work-orders/components/ui'
import { ErrorNote } from './master-ui'

export function AssignedTjxInvoiceList() {
  const query = useQuery({
    queryKey: ['tjx', 'assigned-work-orders'],
    queryFn: () => listAssignedTjxWorkOrdersFn(),
  })
  return (
    <Card title="Your TJX work orders">
      {query.isError ? <ErrorNote message={query.error.message} /> : null}
      {query.isPending ? <p className="text-[13px] text-fg-muted">Loading…</p> : null}
      {query.data && query.data.length === 0 ? (
        <p className="text-[13px] text-fg-muted">
          No approved TJX work orders are assigned to you yet.
        </p>
      ) : null}
      {query.data && query.data.length > 0 ? (
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-hair text-left text-[10px] uppercase tracking-[0.08em] text-fg-muted">
              <th className="py-2">Work order</th>
              <th className="py-2">Quote</th>
              <th className="py-2">Invoice</th>
              <th className="py-2">Status</th>
              <th className="py-2 text-right">Total</th>
              <th className="py-2 text-right">Updated</th>
            </tr>
          </thead>
          <tbody>
            {query.data.map((row) => (
              <tr key={row.workOrderId} className="border-b border-hair">
                <td className="py-2">
                  <Link
                    to="/portal/sub/tjx-invoices/$workOrderId"
                    params={{ workOrderId: String(row.workOrderId) }}
                    className="text-brand underline"
                  >
                    {row.workOrderId}
                  </Link>
                </td>
                <td className="py-2">{row.quoteId}</td>
                <td className="py-2">{row.invoiceId ?? 'Not started'}</td>
                <td className="py-2 capitalize">{row.invoiceStatus ?? 'not started'}</td>
                <td className="py-2 text-right tabular-nums">
                  {row.total === null ? '—' : formatMoney(row.total)}
                </td>
                <td className="py-2 text-right">{row.updatedAt ? formatDate(row.updatedAt) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Card>
  )
}

export function TjxInvoiceReviewList() {
  const query = useQuery({
    queryKey: ['tjx', 'sub-invoices'],
    queryFn: () => listTjxSubInvoicesFn(),
  })
  const rows = query.data ?? []
  return (
    <Card title="Subcontractor TJX invoices">
      {query.isError ? <ErrorNote message={query.error.message} /> : null}
      {query.isPending ? <p className="text-[13px] text-fg-muted">Loading…</p> : null}
      {!query.isPending && rows.length === 0 ? (
        <p className="text-[13px] text-fg-muted">No TJX subcontractor invoices yet.</p>
      ) : null}
      {rows.length > 0 ? (
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-hair text-left text-[10px] uppercase tracking-[0.08em] text-fg-muted">
              <th className="py-2">Work order</th>
              <th className="py-2">Invoice</th>
              <th className="py-2">Date</th>
              <th className="py-2">Status</th>
              <th className="py-2">Rejected</th>
              <th className="py-2 text-right">Total</th>
              <th className="py-2 text-right">Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-hair">
                <td className="py-2">
                  <Link
                    to="/tjx/invoices/$workOrderId"
                    params={{ workOrderId: String(row.workOrderId) }}
                    className="text-brand underline"
                  >
                    {row.workOrderId}
                  </Link>
                </td>
                <td className="py-2">{row.invoiceNumber}</td>
                <td className="py-2">{formatDate(row.invoiceDate)}</td>
                <td className="py-2 capitalize">{row.status}</td>
                <td className="py-2">{row.rejectedCount}</td>
                <td className="py-2 text-right tabular-nums">{formatMoney(row.total)}</td>
                <td className="py-2 text-right">{formatDate(row.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Card>
  )
}
