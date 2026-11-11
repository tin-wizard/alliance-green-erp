import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Button,
  EmptyState,
  ErrorPanel,
  Input,
  Select,
  formatDateTime,
  formatMoney,
} from '../../../modules/work-orders/components/ui'
import {
  movementReportFn,
  stockDisagreementsFn,
} from '../../../modules/inventory/server/inventory.functions'
import { getSessionFn } from '../../../server/auth.functions'

export const Route = createFileRoute('/_app/inventory/movements')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/inventory/movements' } })
    return { session }
  },
  component: MovementsPage,
})

type Kind = 'purchased' | 'sold' | 'complete'

const LABELS: Record<Kind, string> = {
  purchased: 'Purchased detail',
  sold: 'Sold detail',
  complete: 'Complete detail',
}

function MovementsPage() {
  const [kind, setKind] = useState<Kind>('complete')
  const [term, setTerm] = useState('')
  const [search, setSearch] = useState('')

  const report = useQuery({
    queryKey: ['inventory-movements', kind, search],
    queryFn: () => movementReportFn({ data: { kind, search, limit: 300 } }),
  })
  const disagreements = useQuery({
    queryKey: ['inventory-disagreements'],
    queryFn: () => stockDisagreementsFn({ data: {} }),
  })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hair pb-5 pt-2">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">
            Inventory
          </p>
          <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">
            Stock movements
          </h1>
          <p className="mt-1 max-w-[70ch] text-[13.5px] text-fg-secondary">
            Purchased, sold and complete detail from the movement ledger. Deleted rows stay in
            history; excluded rows stay out of the ledger total.
          </p>
        </div>
        <Link to="/inventory" className="text-[13px] text-brand underline">
          Back to stock
        </Link>
      </div>

      {disagreements.data && disagreements.data.length > 0 ? (
        <div
          data-testid="disagreement-report"
          className="rounded-[4px] border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900"
        >
          <strong>{disagreements.data.length} counter/ledger difference(s).</strong> The counter is
          authoritative (E4); these are reported, not repaired.
          <ul className="mt-1 list-inside list-disc">
            {disagreements.data.slice(0, 8).map((row) => (
              <li key={row.partNumber}>
                {row.partNumber}: counter {formatMoney(row.currentQuantity)}, ledger{' '}
                {formatMoney(row.ledgerQuantity)} → {formatMoney(row.difference)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          data-testid="movement-kind"
          aria-label="Report"
          value={kind}
          onChange={(event) => setKind(event.target.value as Kind)}
          className="w-[190px]"
        >
          {Object.entries(LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            setSearch(term.trim())
          }}
        >
          <Input
            aria-label="Search movements"
            placeholder="Part number…"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            className="max-w-[320px]"
          />
          <Button type="submit">Search</Button>
          {search ? (
            <Button
              variant="ghost"
              onClick={() => {
                setTerm('')
                setSearch('')
              }}
            >
              Clear
            </Button>
          ) : null}
        </form>
        <span className="ml-auto text-[12px] text-fg-muted">
          {report.data ? `${report.data.length} row${report.data.length === 1 ? '' : 's'}` : ''}
        </span>
      </div>

      {report.isPending ? <p className="text-[13px] text-fg-muted">Loading movements…</p> : null}
      {report.error ? <ErrorPanel message={report.error.message} /> : null}
      {report.data && report.data.length === 0 ? (
        <EmptyState
          title="No movements"
          description="Receipts, sales and adjustments appear here."
        />
      ) : null}

      {report.data && report.data.length > 0 ? (
        <div className="overflow-hidden rounded-[5px] border border-hair bg-surface">
          <table className="w-full text-left text-[12.5px]">
            <thead className="bg-surface-2 text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Part</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Document</th>
                <th className="px-3 py-2">Legacy ids</th>
                <th className="px-3 py-2">Flags</th>
              </tr>
            </thead>
            <tbody>
              {report.data.map((row) => (
                <tr key={row.id} className="border-t border-hair">
                  <td className="px-3 py-2 text-fg-muted">{formatDateTime(row.createdAt)}</td>
                  <td className="px-3 py-2 font-mono">{row.partNo}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.qty)}</td>
                  <td className="px-3 py-2">
                    {row.transactionType}
                    <span className="ml-1 text-fg-muted">({row.movementType})</span>
                  </td>
                  <td className="px-3 py-2 text-fg-muted">
                    {row.documentType ?? row.referenceType} #{row.documentId ?? row.referenceId}
                  </td>
                  <td className="px-3 py-2 text-fg-muted">
                    {row.woidPoid ? `wo/poid ${row.woidPoid}` : ''}
                    {row.invoiceId ? ` · inv ${row.invoiceNumber ?? row.invoiceId}` : ''}
                  </td>
                  <td className="px-3 py-2 text-fg-muted">
                    {row.isLogDeleted ? 'deleted ' : ''}
                    {!row.isIncludedInStockManagement ? 'excluded' : ''}
                    {row.adjustmentType ? row.adjustmentType : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
