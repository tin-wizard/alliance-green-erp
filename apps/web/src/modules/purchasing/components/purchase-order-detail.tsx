import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { StatusChip } from '../../../shell/status-chip'
import {
  Button,
  ErrorPanel,
  Input,
  formatDate,
  formatDateTime,
  formatMoney,
} from '../../work-orders/components/ui'
import { PO_STATUS_LABELS, poStatusChip } from '../lib/status'
import {
  closePurchaseOrderInvoiceFn,
  createPurchaseOrderInvoiceFn,
  getPurchaseOrderFn,
  receivePurchaseOrderFn,
  transitionPurchaseOrderFn,
} from '../server/purchasing.functions'
import type { PurchaseOrderStatus } from '../types'

function remaining(qty: string, received: string): number {
  return Math.max(0, Number(qty) - Number(received))
}

export function PurchaseOrderDetailView({ id }: { id: number }) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['purchase-order', id],
    queryFn: () => getPurchaseOrderFn({ data: { id } }),
  })
  const [receiptQtys, setReceiptQtys] = useState<Record<number, string>>({})
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [receiptKey] = useState(() => `receipt-${crypto.randomUUID()}`)

  const refresh = async (note: string) => {
    setMessage(note)
    await queryClient.invalidateQueries({ queryKey: ['purchase-order', id] })
    await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
  }

  const transition = useMutation({
    mutationFn: (to: PurchaseOrderStatus) =>
      transitionPurchaseOrderFn({
        data: { id, version: query.data!.version, to, reason: reason || null },
      }),
    onSuccess: async (result) => {
      setReason('')
      await refresh(`Status is now ${PO_STATUS_LABELS[result.status]}.`)
    },
  })

  const receive = useMutation({
    mutationFn: async () => {
      const po = query.data!
      const lines = po.lines
        .map((line) => ({
          partLineId: line.id,
          qty: receiptQtys[line.id] ?? remaining(line.qty, line.qtyReceived).toFixed(2),
        }))
        .filter((line) => Number(line.qty) > 0)
      const specialLines = po.specialLines
        .map((line) => ({
          specialPartLineId: line.id,
          qty: receiptQtys[-line.id] ?? remaining(line.qty, line.qtyReceived).toFixed(2),
        }))
        .filter((line) => Number(line.qty) > 0)
      return receivePurchaseOrderFn({
        data: {
          id,
          version: po.version,
          idempotencyKey: receiptKey,
          notes: reason || null,
          lines: [...lines, ...specialLines],
        },
      })
    },
    onSuccess: async (result) => {
      setReceiptQtys({})
      await refresh(`Receipt ${result.receiptId} recorded; ${result.stockLinesPosted} stock line(s) posted.`)
    },
  })

  const invoice = useMutation({
    mutationFn: async () => {
      const po = query.data!
      const lines = po.lines
        .map((line) => ({
          partLineId: line.id,
          qty: line.qty,
          unitPrice: line.price,
        }))
      return createPurchaseOrderInvoiceFn({
        data: {
          id,
          supplierInvoiceNumber: invoiceNumber,
          invoiceDate,
          taxCode: po.taxCode,
          lines,
        },
      })
    },
    onSuccess: async (result) => {
      setInvoiceNumber('')
      await refresh(`Invoice recorded as ${result.status}.`)
    },
  })

  const closeInvoice = useMutation({
    mutationFn: (invoiceId: number) =>
      closePurchaseOrderInvoiceFn({
        data: { id, invoiceId, acceptVarianceReason: reason || null },
      }),
    onSuccess: async () => {
      setReason('')
      await refresh('Invoice posted and purchase order marked invoiced.')
    },
  })

  if (query.isPending) return <p className="text-[13px] text-fg-muted">Loading purchase order…</p>
  if (query.error) return <ErrorPanel message={query.error.message} />
  const po = query.data
  if (!po) return null

  const canReceiveLines = po.capabilities.canReceive
  const canInvoiceLines = po.capabilities.canInvoice

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-hair pb-5 pt-2">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">Purchasing</p>
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">
              PO {po.displayNumber}
            </h1>
            <StatusChip status={poStatusChip(po.status)} />
            <span data-testid="po-status" className="text-[13px] text-fg-secondary">{PO_STATUS_LABELS[po.status]}</span>
          </div>
          <p className="mt-1 text-[13.5px] text-fg-secondary">
            {po.supplierName} · {po.taxCode} · version {po.version}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {po.capabilities.canEdit ? (
            <Link to="/purchasing/$id/edit" params={{ id: String(id) }}>
              <Button variant="ghost">Edit</Button>
            </Link>
          ) : null}
          {po.capabilities.canRequestApproval ? (
            <Button onClick={() => transition.mutate(7)}>Request approval</Button>
          ) : null}
          {po.capabilities.canApprove ? (
            <Button onClick={() => transition.mutate(8)}>Approve</Button>
          ) : null}
          {po.capabilities.canChallenge ? (
            <Button variant="ghost" onClick={() => transition.mutate(9)} disabled={!reason}>
              Challenge
            </Button>
          ) : null}
          {po.capabilities.canIssue ? (
            <Button onClick={() => transition.mutate(2)}>Issue to supplier</Button>
          ) : null}
          {po.capabilities.canShortClose ? (
            <Button variant="ghost" onClick={() => transition.mutate(4)} disabled={!reason}>
              Close short
            </Button>
          ) : null}
          {po.capabilities.canCancel ? (
            <Button variant="ghost" onClick={() => transition.mutate(10)} disabled={!reason}>
              Cancel PO
            </Button>
          ) : null}
        </div>
      </div>

      {po.selfApproved ? (
        <p className="rounded-[4px] border border-hair bg-surface-2 px-3 py-2 text-[12.5px] text-fg-secondary">
          Self-approved by the same user who requested approval. The edit-after-approval rule drops
          this purchase order to Saved if any line changes.
        </p>
      ) : null}
      <Input
        aria-label="Reason or note"
        placeholder="Reason for challenge, cancellation, short close, receipt or variance"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        className="max-w-[520px]"
      />
      {message ? <p className="text-[12.5px] text-fg-secondary">{message}</p> : null}
      {[transition, receive, invoice, closeInvoice].map((mutation, index) =>
        mutation.error ? <ErrorPanel key={index} message={mutation.error.message} /> : null,
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-[5px] border border-hair bg-surface p-3">
          <p className="text-[11px] uppercase tracking-[0.08em] text-fg-muted">Subtotal</p>
          <p className="text-[16px] tabular-nums">{formatMoney(po.subtotal)}</p>
        </div>
        <div className="rounded-[5px] border border-hair bg-surface p-3">
          <p className="text-[11px] uppercase tracking-[0.08em] text-fg-muted">Tax</p>
          <p className="text-[16px] tabular-nums">{formatMoney(po.tax)}</p>
        </div>
        <div className="rounded-[5px] border border-hair bg-surface p-3">
          <p className="text-[11px] uppercase tracking-[0.08em] text-fg-muted">Total</p>
          <p className="text-[16px] tabular-nums">{formatMoney(po.total)}</p>
        </div>
        <div className="rounded-[5px] border border-hair bg-surface p-3">
          <p className="text-[11px] uppercase tracking-[0.08em] text-fg-muted">Expected</p>
          <p className="text-[14px]">{po.expectedDelivery ? formatDate(po.expectedDelivery) : '—'}</p>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold text-fg">Lines</h2>
        <table className="w-full border border-hair text-left text-[13px]">
          <thead className="bg-surface-2 text-[11px] uppercase tracking-[0.08em] text-fg-muted">
            <tr>
              <th className="px-3 py-2">Part</th>
              <th className="px-3 py-2 text-right">Ordered</th>
              <th className="px-3 py-2 text-right">Received</th>
              <th className="px-3 py-2 text-right">Price</th>
              <th className="px-3 py-2 text-right">Line total</th>
              {canReceiveLines ? <th className="px-3 py-2">Receive now</th> : null}
            </tr>
          </thead>
          <tbody>
            {[...po.lines, ...po.specialLines.map((line) => ({ ...line, partNo: line.name }))].map((line) => (
              <tr key={line.id} className="border-t border-hair">
                <td className="px-3 py-2">{line.partNo}</td>
                <td className="px-3 py-2 text-right tabular-nums">{line.qty}</td>
                <td className="px-3 py-2 text-right tabular-nums">{line.qtyReceived}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(line.price)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(line.lineTotal)}</td>
                {canReceiveLines ? (
                  <td className="px-3 py-2">
                    <Input
                      aria-label={`Receive quantity for ${line.partNo}`}
                      className="w-[90px]"
                      value={
                        receiptQtys[line.id] ??
                        remaining(line.qty, line.qtyReceived).toFixed(2)
                      }
                      onChange={(event) =>
                        setReceiptQtys({ ...receiptQtys, [line.id]: event.target.value })
                      }
                    />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {canReceiveLines ? (
          <div className="flex items-center gap-2">
            <Button onClick={() => receive.mutate()} disabled={receive.isPending}>
              {receive.isPending ? 'Posting receipt…' : 'Post receipt'}
            </Button>
          </div>
        ) : null}
      </section>

      {canInvoiceLines ? (
        <section className="space-y-2 rounded-[5px] border border-hair bg-surface p-3">
          <h2 className="text-[13px] font-semibold text-fg">Supplier invoice</h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-[12px] text-fg-secondary">
              <span>Invoice number</span>
              <Input
                aria-label="Supplier invoice number"
                value={invoiceNumber}
                onChange={(event) => setInvoiceNumber(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-[12px] text-fg-secondary">
              <span>Invoice date</span>
              <Input
                aria-label="Invoice date"
                type="date"
                value={invoiceDate}
                onChange={(event) => setInvoiceDate(event.target.value)}
              />
            </label>
            <Button
              onClick={() => invoice.mutate()}
              disabled={invoice.isPending || !invoiceNumber.trim()}
            >
              {invoice.isPending ? 'Recording…' : 'Record invoice'}
            </Button>
          </div>
          <p className="text-[12px] text-fg-muted">
            An invoice recorded before delivery stays pending receipt and cannot close the PO.
          </p>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold text-fg">Invoices</h2>
        {po.invoices.length === 0 ? (
          <p className="text-[12.5px] text-fg-muted">No invoices recorded.</p>
        ) : (
          <table className="w-full border border-hair text-left text-[13px]">
            <thead className="bg-surface-2 text-[11px] uppercase tracking-[0.08em] text-fg-muted">
              <tr>
                <th className="px-3 py-2">Number</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Variance</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {po.invoices.map((row) => (
                <tr key={row.id} className="border-t border-hair">
                  <td className="px-3 py-2">{row.supplierInvoiceNumber}</td>
                  <td className="px-3 py-2">{formatDate(row.invoiceDate)}</td>
                  <td className="px-3 py-2">{row.status}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.total)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.variance)}</td>
                  <td className="px-3 py-2 text-right">
                    {po.capabilities.canCloseInvoice && row.status !== 'posted' ? (
                      <Button variant="ghost" onClick={() => closeInvoice.mutate(row.id)}>
                        {row.status === 'pending_receipt' ? 'Pending receipt' : 'Close as invoiced'}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold text-fg">Receipts</h2>
        {po.receipts.length === 0 ? (
          <p className="text-[12.5px] text-fg-muted">No receipts recorded.</p>
        ) : (
          <ul className="space-y-2">
            {po.receipts.map((receipt) => (
              <li key={receipt.id} className="rounded-[4px] border border-hair bg-surface p-3 text-[12.5px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">Receipt {receipt.id}</span>
                  <span className="text-fg-muted">{formatDate(receipt.receivedOn)}</span>
                  <span className="text-fg-muted">
                    stock posted {formatDateTime(receipt.stockPostedAt)}
                  </span>
                </div>
                <p className="text-fg-secondary">
                  {receipt.lines
                    .map((line) => `${line.partNo ?? line.name}: ${line.qty}`)
                    .join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold text-fg">Status history</h2>
        <ul className="space-y-1 text-[12.5px]">
          {po.statusHistory.map((event) => (
            <li key={event.id} className="flex flex-wrap items-center gap-2 border-b border-hair py-1">
              <span className="text-fg-muted">{formatDateTime(event.createdAt)}</span>
              <span>
                {event.fromStatus ? PO_STATUS_LABELS[event.fromStatus as PurchaseOrderStatus] : 'New'} →{' '}
                {PO_STATUS_LABELS[event.toStatus as PurchaseOrderStatus]}
              </span>
              <span className="text-fg-muted">{event.action}</span>
              <span className="text-fg-muted">version {event.poVersion}</span>
              {event.selfApproved ? <span className="text-brand">self-approved</span> : null}
              {event.note ? <span className="text-fg-secondary">“{event.note}”</span> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
