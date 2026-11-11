import { useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Card,
  ErrorPanel,
  Field,
  Input,
  Select,
  Tag,
  Textarea,
  formatDate,
  formatDateTime,
  formatMoney,
} from '../../../modules/work-orders/components/ui'
import {
  approveRgaFn,
  getRgaFn,
  listRgaDocumentsFn,
  queueRgaReminderFn,
  recordRgaCreditFn,
  renderRgaPdfFn,
  transitionRgaFn,
} from '../../../modules/rga/server/rga.functions'
import { allowedNextStatuses, canApprove, canRecordCredit } from '../../../modules/rga/lib/lifecycle'
import { getSessionFn } from '../../../server/auth.functions'

export const Route = createFileRoute('/_app/rgas/$id')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/rgas' } })
    return { session }
  },
  component: RgaDetailPage,
})

function RgaDetailPage() {
  const { id } = Route.useParams()
  const { session } = Route.useRouteContext()
  const rgaId = Number(id)
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const [nextStatus, setNextStatus] = useState('')
  const [creditNumber, setCreditNumber] = useState('')
  const [creditDate, setCreditDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [taxProvince, setTaxProvince] = useState('ON')
  const [taxRate, setTaxRate] = useState('')

  const detail = useQuery({
    queryKey: ['rga', rgaId],
    queryFn: () => getRgaFn({ data: { rgaId } }),
    enabled: Number.isInteger(rgaId) && rgaId > 0,
  })
  const documents = useQuery({
    queryKey: ['rga-documents', rgaId],
    queryFn: () => listRgaDocumentsFn({ data: { rgaId } }),
    enabled: Number.isInteger(rgaId) && rgaId > 0,
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['rga', rgaId] })
    void queryClient.invalidateQueries({ queryKey: ['rga-documents', rgaId] })
    void queryClient.invalidateQueries({ queryKey: ['rgas'] })
  }

  const approve = useMutation({
    mutationFn: () => approveRgaFn({ data: { rgaId, version: detail.data!.rga.version, note: note.trim() || null } }),
    onSuccess: () => {
      setNote('')
      invalidate()
    },
  })
  const transition = useMutation({
    mutationFn: () =>
      transitionRgaFn({
        data: {
          rgaId,
          version: detail.data!.rga.version,
          toStatus: Number(nextStatus) as 3 | 4 | 6 | 7 | 10,
          note: note.trim() || null,
        },
      }),
    onSuccess: () => {
      setNote('')
      setNextStatus('')
      invalidate()
    },
  })
  const credit = useMutation({
    mutationFn: () =>
      recordRgaCreditFn({
        data: {
          rgaId,
          version: detail.data!.rga.version,
          creditNumber: creditNumber.trim() || undefined,
          creditDate,
          taxProvince,
          appliedTaxRate: taxRate.trim() || undefined,
        },
      }),
    onSuccess: () => {
      setCreditNumber('')
      invalidate()
    },
  })
  const pdf = useMutation({
    mutationFn: () => renderRgaPdfFn({ data: { rgaId } }),
    onSuccess: () => invalidate(),
  })
  const reminder = useMutation({
    mutationFn: () => queueRgaReminderFn({ data: { rgaId, notifyType: 'Reminder' } }),
    onSuccess: () => invalidate(),
  })

  if (detail.isError) {
    return (
      <ErrorPanel
        message={detail.error instanceof Error ? detail.error.message : 'Could not load this RGA.'}
        retry={() => void detail.refetch()}
      />
    )
  }
  if (detail.isLoading || !detail.data) {
    return <p className="text-[13px] text-fg-muted">Loading RGA…</p>
  }

  const { rga, supplier, purchaseOrder, workOrder, site, credit: recorded, parts, specialParts, history, notifications } =
    detail.data
  const grants = new Set(session.user.grants.map((grant) => grant.key))
  const transitions = allowedNextStatuses(rga.status).filter((status) => status !== 3)
  const actionError =
    approve.error ?? transition.error ?? credit.error ?? pdf.error ?? reminder.error
  const actionMessage = approve.isError || transition.isError || credit.isError || pdf.isError || reminder.isError
    ? actionError instanceof Error
      ? actionError.message
      : 'The action failed.'
    : null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hair pb-5 pt-2">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">Supply</p>
          <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">
            RGA {rga.number}
          </h1>
          <p className="mt-1 text-[13.5px] text-fg-secondary">
            {rga.rgaType} · requested {formatDate(rga.requestDate)} ·{' '}
            <Tag tone={rga.status === 10 ? 'danger' : rga.status === 2 ? 'warning' : 'info'}>
              {rga.statusLabel}
            </Tag>
          </p>
        </div>
        <Link to="/rgas" className="text-[13px] text-brand underline">
          Back to RGAs
        </Link>
      </div>

      {actionMessage ? <ErrorPanel message={actionMessage} /> : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Card title="Header">
            <dl className="grid gap-3 text-[13px] sm:grid-cols-2">
              <div><dt className="text-fg-muted">Supplier</dt><dd>{supplier?.name ?? '—'}</dd></div>
              <div><dt className="text-fg-muted">Work order</dt><dd>{workOrder?.number ?? '—'}</dd></div>
              <div><dt className="text-fg-muted">Purchase order</dt><dd>{purchaseOrder?.displayNumber ?? '—'}</dd></div>
              <div><dt className="text-fg-muted">Site</dt><dd>{site?.name ?? '—'}</dd></div>
              <div><dt className="text-fg-muted">Replacement</dt><dd>{rga.replacementType ?? '—'}</dd></div>
              <div><dt className="text-fg-muted">Approved</dt><dd>{rga.approvedAt ? formatDateTime(rga.approvedAt) : '—'}</dd></div>
              <div className="sm:col-span-2"><dt className="text-fg-muted">Shipping</dt><dd>{rga.shippingAddress ?? '—'}</dd></div>
              <div className="sm:col-span-2"><dt className="text-fg-muted">Notes</dt><dd>{rga.rgaNotes ?? '—'}</dd></div>
            </dl>
          </Card>

          <Card title="Return lines">
            <table className="w-full text-left text-[12.5px]">
              <thead className="border-b border-hair text-[10.5px] uppercase tracking-[0.12em] text-fg-muted">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Part</th>
                  <th className="py-2 pr-3 font-semibold">Description</th>
                  <th className="py-2 pr-3 font-semibold">Qty</th>
                  <th className="py-2 pr-3 font-semibold">Return</th>
                  <th className="py-2 pr-3 font-semibold">Price</th>
                  <th className="py-2 pr-3 font-semibold">Reason</th>
                </tr>
              </thead>
              <tbody>
                {parts.map((line) => (
                  <tr key={`part-${line.id}`} className="border-b border-hair/60">
                    <td className="py-2 pr-3">{line.partNo}</td>
                    <td className="py-2 pr-3">{line.description ?? '—'}</td>
                    <td className="py-2 pr-3">{line.qty}</td>
                    <td className="py-2 pr-3">{line.returnQty}</td>
                    <td className="py-2 pr-3">{formatMoney(line.price)}</td>
                    <td className="py-2 pr-3">{line.reasonForReturn ?? '—'}</td>
                  </tr>
                ))}
                {specialParts.map((line) => (
                  <tr key={`special-${line.id}`} className="border-b border-hair/60">
                    <td className="py-2 pr-3">{line.name}</td>
                    <td className="py-2 pr-3">{line.description ?? '—'}</td>
                    <td className="py-2 pr-3">{line.qty}</td>
                    <td className="py-2 pr-3">{line.returnQty}</td>
                    <td className="py-2 pr-3">{formatMoney(line.price)}</td>
                    <td className="py-2 pr-3">{line.reasonForReturn ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {recorded ? (
            <Card title={`Credit ${recorded.creditNumber}`}>
              <dl className="grid gap-3 text-[13px] sm:grid-cols-3">
                <div><dt className="text-fg-muted">Credit date</dt><dd>{formatDate(recorded.creditDate)}</dd></div>
                <div><dt className="text-fg-muted">Subtotal</dt><dd>{formatMoney(recorded.subtotalAmount)}</dd></div>
                <div><dt className="text-fg-muted">Tax</dt><dd>{formatMoney(recorded.taxAmount)}</dd></div>
                <div><dt className="text-fg-muted">Total</dt><dd>{formatMoney(recorded.totalAmount)}</dd></div>
                <div><dt className="text-fg-muted">Status</dt><dd>{recorded.status}</dd></div>
                <div><dt className="text-fg-muted">Tax province</dt><dd>{recorded.taxProvince}</dd></div>
              </dl>
            </Card>
          ) : null}

          <Card title="History">
            <ul className="space-y-2 text-[12.5px]">
              {history.map((row) => (
                <li key={row.id} className="border-b border-hair/60 pb-2 last:border-0">
                  <span className="font-medium text-fg">{row.action}</span>{' '}
                  <span className="text-fg-muted">
                    {row.fromStatusLabel ? `${row.fromStatusLabel} → ` : ''}
                    {row.toStatusLabel} · {row.actorLabel ?? 'system'} · {formatDateTime(row.createdAt)}
                  </span>
                  {row.note ? <p className="text-fg-secondary">{row.note}</p> : null}
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Notifications">
            {notifications.length === 0 ? (
              <p className="text-[13px] text-fg-muted">Nothing queued.</p>
            ) : (
              <ul className="space-y-2 text-[12.5px]">
                {notifications.map((row) => (
                  <li key={row.id}>
                    <Tag tone={row.status === 'failed' ? 'danger' : 'neutral'}>{row.status}</Tag>{' '}
                    {row.notifyType} · due {formatDateTime(row.dueAt)} · {row.subject ?? '—'}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3">
              <Button
                size="sm"
                onClick={() => reminder.mutate()}
                disabled={reminder.isPending || rga.status === 4 || rga.status === 10 || rga.status === 11}
              >
                Queue reminder
              </Button>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          {canApprove(rga.status) && grants.has('rga:approve') ? (
            <Card title="Approval">
              <Field label="Note">
                <Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
              </Field>
              <div className="mt-3">
                <Button
                  data-testid="approve-rga"
                  onClick={() => approve.mutate()}
                  disabled={approve.isPending}
                >
                  {approve.isPending ? 'Approving…' : 'Approve RGA'}
                </Button>
              </div>
            </Card>
          ) : null}

          {transitions.length > 0 && grants.has('rga:approve') ? (
            <Card title="Move status">
              <Field label="Next status">
                <Select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)}>
                  <option value="">Choose…</option>
                  {transitions.map((status) => (
                    <option key={status} value={status}>
                      {status === 10 ? 'Cancelled' : status === 7 ? 'In Transit' : status === 6 ? 'Received' : 'Completed'}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Note">
                <Input value={note} onChange={(event) => setNote(event.target.value)} />
              </Field>
              <div className="mt-3">
                <Button
                  onClick={() => transition.mutate()}
                  disabled={!nextStatus || transition.isPending}
                >
                  Move RGA
                </Button>
              </div>
            </Card>
          ) : null}

          {canRecordCredit(rga.status, rga.rgaType) && grants.has('rga:credit') ? (
            <Card title="Record supplier credit">
              <p className="mb-3 text-[12.5px] text-fg-secondary">
                The credit is created through Purchasing and queued for Sage as a purchase credit
                note.
              </p>
              <div className="space-y-3">
                <Field label="Credit number">
                  <Input
                    aria-label="Credit number"
                    placeholder={`Defaults to ${rga.number}`}
                    value={creditNumber}
                    onChange={(event) => setCreditNumber(event.target.value)}
                  />
                </Field>
                <Field label="Credit date">
                  <Input type="date" value={creditDate} onChange={(event) => setCreditDate(event.target.value)} />
                </Field>
                <Field label="Tax province">
                  <Input value={taxProvince} onChange={(event) => setTaxProvince(event.target.value)} />
                </Field>
                <Field label="Tax rate override">
                  <Input
                    inputMode="decimal"
                    placeholder="e.g. 0.13"
                    value={taxRate}
                    onChange={(event) => setTaxRate(event.target.value)}
                  />
                </Field>
                <Button
                  data-testid="record-credit"
                  onClick={() => credit.mutate()}
                  disabled={credit.isPending}
                >
                  {credit.isPending ? 'Recording…' : 'Record credit'}
                </Button>
              </div>
            </Card>
          ) : null}

          <Card title="Document">
            <div className="flex flex-wrap items-center gap-2">
              <Button data-testid="render-rga-pdf" onClick={() => pdf.mutate()} disabled={pdf.isPending}>
                {pdf.isPending ? 'Rendering…' : 'Render PDF'}
              </Button>
              {documents.data?.[0]?.url ? (
                <a href={documents.data[0].url} className="text-[13px] text-brand underline" target="_blank" rel="noreferrer">
                  Open latest PDF
                </a>
              ) : null}
            </div>
            {pdf.isSuccess ? (
              <p className="mt-2 text-[12px] text-fg-muted">
                {pdf.data.pageCount ?? '?'} page(s), sha256 {pdf.data.sha256.slice(0, 12)}…
              </p>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  )
}
