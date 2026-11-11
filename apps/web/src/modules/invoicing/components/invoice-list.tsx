import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, EmptyState, ErrorPanel, Input, formatDate, formatMoney } from '../../work-orders/components/ui'
import { listInvoicesFn } from '../server/invoicing.functions'

const STATUS_OPTIONS = ['', 'draft', 'issued', 'rejected', 'partially_paid', 'paid', 'cancelled']

export function InvoiceList() {
  const [status, setStatus] = useState('')
  const [term, setTerm] = useState('')
  const [search, setSearch] = useState('')
  const query = useQuery({
    queryKey: ['invoices', status, search],
    queryFn: () => listInvoicesFn({ data: { ...(status ? { status } : {}), search } }),
  })

  if (query.isError) return <ErrorPanel message={query.error.message} />
  const rows = query.data ?? []

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          setSearch(term.trim())
        }}
      >
        <Input
          aria-label="Search invoices"
          placeholder="Invoice or work order number"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          className="w-[260px]"
        />
        <select
          aria-label="Invoice status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="h-9 rounded-[4px] border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-3 text-[13px]"
        >
          {STATUS_OPTIONS.map((value) => (
            <option key={value || 'all'} value={value}>
              {value ? value.replace('_', ' ') : 'All statuses'}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <Card padded={false}>
        {query.isPending ? (
          <p className="p-4 text-[13px] text-fg-muted">Loading invoices…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No invoices yet"
            description="Create one from a work order's invoice-ready snapshot."
          />
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-hair text-left text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
                <th className="px-4 py-2.5">Invoice</th>
                <th className="px-4 py-2.5">Work order</th>
                <th className="px-4 py-2.5">Date</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((invoice) => (
                <tr key={invoice.id} className="border-b border-hair last:border-0">
                  <td className="px-4 py-2.5">
                    <Link to="/invoicing/$id" params={{ id: String(invoice.id) }} className="font-medium text-brand underline">
                      {invoice.invoiceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">{invoice.workOrderNumber}</td>
                  <td className="px-4 py-2.5">{formatDate(invoice.invoiceDate)}</td>
                  <td className="px-4 py-2.5 capitalize">{invoice.status.replace('_', ' ')}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(invoice.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
