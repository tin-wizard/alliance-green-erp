import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Button,
  Card,
  ErrorPanel,
  Field,
  Input,
  Select,
  Textarea,
  formatDateTime,
  formatQuantity,
} from '../../../modules/work-orders/components/ui'
import {
  adjustStockFn,
  movementReportFn,
} from '../../../modules/inventory/server/inventory.functions'
import { getSessionFn } from '../../../server/auth.functions'

export const Route = createFileRoute('/_app/inventory/adjustments')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/inventory/adjustments' } })
    return { session }
  },
  component: AdjustStockPage,
})

const TYPES = ['global', 'alliance', 'subcontractor', 'customer', 'contractor'] as const

function AdjustStockPage() {
  const queryClient = useQueryClient()
  const [partNo, setPartNo] = useState('')
  const [qty, setQty] = useState('')
  const [adjustmentType, setAdjustmentType] = useState<(typeof TYPES)[number]>('global')
  const [notes, setNotes] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const [result, setResult] = useState<string | null>(null)

  const recent = useQuery({
    queryKey: ['inventory-movements', 'adjustment'],
    queryFn: () => movementReportFn({ data: { kind: 'complete', limit: 100, search: '' } }),
  })

  const mutation = useMutation({
    mutationFn: () =>
      adjustStockFn({
        data: {
          partNo: partNo.trim(),
          qty,
          adjustmentType,
          notes: notes.trim() || null,
          idempotencyKey,
        },
      }),
    onSuccess: (data) => {
      setResult(
        `${data.replay ? 'Already posted' : 'Posted'} adjustment #${data.adjustmentId}. Current stock is ${formatQuantity(
          data.currentQuantity,
        )}.`,
      )
      setIdempotencyKey(crypto.randomUUID())
      setQty('')
      setNotes('')
      void queryClient.invalidateQueries({ queryKey: ['inventory-stock'] })
      void queryClient.invalidateQueries({ queryKey: ['inventory-movements'] })
    },
  })

  const adjustments =
    recent.data?.filter((row) => row.transactionType === 'Adjustment').slice(0, 25) ?? []

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hair pb-5 pt-2">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">
            Inventory
          </p>
          <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">
            Adjust stock
          </h1>
          <p className="mt-1 max-w-[68ch] text-[13.5px] text-fg-secondary">
            A signed quantity: negative removes stock, positive adds it. Every adjustment keeps its
            reason, actor and ledger row.
          </p>
        </div>
        <Link to="/inventory" className="text-[13px] text-brand underline">
          Back to stock
        </Link>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <Card title="New adjustment">
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              setResult(null)
              mutation.mutate()
            }}
          >
            <Field label="Part number">
              <Input
                name="partNo"
                required
                placeholder="e.g. ALL-LED-4FT"
                value={partNo}
                onChange={(event) => setPartNo(event.target.value)}
              />
            </Field>
            <Field label="Quantity (signed)">
              <Input
                name="qty"
                required
                inputMode="decimal"
                placeholder="-2.00"
                value={qty}
                onChange={(event) => setQty(event.target.value)}
              />
            </Field>
            <Field label="Adjustment type">
              <Select
                name="adjustmentType"
                value={adjustmentType}
                onChange={(event) =>
                  setAdjustmentType(event.target.value as (typeof TYPES)[number])
                }
              >
                {TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reason">
              <Textarea
                name="notes"
                rows={3}
                placeholder="Cycle count, damage, site return…"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Field>
            {mutation.error ? <ErrorPanel message={mutation.error.message} /> : null}
            {result ? (
              <p data-testid="adjustment-result" className="text-[12.5px] text-emerald-700">
                {result}
              </p>
            ) : null}
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Posting…' : 'Post adjustment'}
            </Button>
          </form>
        </Card>

        <Card title="Recent adjustments">
          {recent.isPending ? <p className="text-[13px] text-fg-muted">Loading…</p> : null}
          {recent.error ? <ErrorPanel message={recent.error.message} /> : null}
          {adjustments.length === 0 && recent.data ? (
            <p className="text-[13px] text-fg-muted">No adjustments yet.</p>
          ) : null}
          {adjustments.length > 0 ? (
            <table className="w-full text-left text-[12.5px]">
              <thead className="text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
                <tr>
                  <th className="pb-2 pr-2">When</th>
                  <th className="pb-2 pr-2">Part</th>
                  <th className="pb-2 pr-2 text-right">Qty</th>
                  <th className="pb-2 pr-2">Type</th>
                  <th className="pb-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.map((row) => (
                  <tr key={row.id} className="border-t border-hair">
                    <td className="py-1.5 pr-2 text-fg-muted">{formatDateTime(row.createdAt)}</td>
                    <td className="py-1.5 pr-2 font-mono text-[12px]">{row.partNo}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{formatQuantity(row.qty)}</td>
                    <td className="py-1.5 pr-2">{row.adjustmentType}</td>
                    <td className="py-1.5 text-fg-muted">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </Card>
      </div>
    </div>
  )
}
