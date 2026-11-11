import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Pencil, FileText, Plus } from 'lucide-react'
import { StatusChip } from '../../../shell/status-chip'
import {
  Button,
  Card,
  EmptyState,
  ErrorPanel,
  Select,
  Tag,
  Textarea,
  formatDate,
  formatDateTime,
  formatMoney,
} from './ui'
import {
  HoursForm,
  LocalHoursForm,
  PartsForm,
  ReportForm,
  SignatureForm,
  SpecialPartsForm,
  UploadForm,
} from './capture-forms'
import { WorkOrderForm } from './work-order-form'
import {
  addNoteFn,
  getInvoiceReadySnapshotFn,
  getRevisionFn,
  getWorkOrderFn,
  queueReminderFn,
  saveRevisionFn,
  setTriageFn,
  transitionWorkOrderFn,
} from '../server/work-orders.functions'
import type {
  TriageFlag,
  WorkOrderDetail,
  WorkOrderStatusCode,
} from '../types'
import { allowedNextStatuses, statusLabel } from '../lib/status'
import { TRIAGE_LABELS } from '../lib/rules'

type Tab = 'overview' | 'labour' | 'parts' | 'documents' | 'revisions' | 'activity' | 'invoice'

type ListPath =
  | '/work-orders'
  | '/maintenance/work-orders'
  | '/portal/sub/work-orders'
  | '/portal/tech'

export function WorkOrderDetailScreen({
  id,
  listPath,
  initialTab = 'overview',
  portal,
}: {
  id: number
  listPath: ListPath
  initialTab?: Tab
  portal: 'office' | 'subcontractor' | 'technician'
}) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>(initialTab)
  const [editing, setEditing] = useState(false)
  const [statusTarget, setStatusTarget] = useState<string>('')
  const [note, setNote] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [revisionId, setRevisionId] = useState<number | null>(null)

  const detail = useQuery({
    queryKey: ['work-order', id],
    queryFn: () => getWorkOrderFn({ data: { id } }),
  })

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['work-order', id] })
    void queryClient.invalidateQueries({ queryKey: ['work-orders'] })
    void queryClient.invalidateQueries({ queryKey: ['work-order-view-counts'] })
  }

  const transition = useMutation({
    mutationFn: (to: WorkOrderStatusCode) =>
      transitionWorkOrderFn({
        data: {
          id,
          version: detail.data!.version,
          to,
          note: note || null,
        },
      }),
    onSuccess: (result) => {
      setStatusTarget('')
      setNote('')
      setNotice(`Status updated to ${statusLabel(result.status)}.`)
      refresh()
    },
    onError: (error: Error) => setNotice(error.message),
  })

  const triage = useMutation({
    mutationFn: (flags: TriageFlag[]) =>
      setTriageFn({ data: { id, version: detail.data!.version, flags } }),
    onSuccess: refresh,
    onError: (error: Error) => setNotice(error.message),
  })

  const revision = useMutation({
    mutationFn: () => saveRevisionFn({ data: { id } }),
    onSuccess: (result) => {
      setNotice(`Revision ${result.revisionId} saved.`)
      refresh()
    },
    onError: (error: Error) => setNotice(error.message),
  })

  const reminder = useMutation({
    mutationFn: () => queueReminderFn({ data: { id } }),
    onSuccess: (result) =>
      setNotice(
        result.queued
          ? 'Reminder queued for the subcontractor.'
          : 'Reminder recorded, but the subcontractor has no e-mail on file.',
      ),
    onError: (error: Error) => setNotice(error.message),
  })

  if (detail.isPending) {
    return <div className="h-[320px] animate-pulse rounded-[6px] border border-hair bg-subtle" />
  }
  if (detail.isError) {
    return <ErrorPanel message={(detail.error as Error).message} retry={() => void detail.refetch()} />
  }

  const data = detail.data
  const nextStatuses = allowedNextStatuses(data.status).filter((code) => {
    if (code === 7) return data.capabilities.canDispatch
    if (code === 6 || code === 10) return data.capabilities.canApprove
    return data.capabilities.canEdit
  })
  const primary = nextStatuses[0]
  const wsibBlocked =
    primary === 7 &&
    (!data.subcontractor || (!data.wsib.valid && !data.capabilities.canOverrideWsib))

  const tabs: Array<{ key: Tab; label: string; count?: number }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'labour', label: 'Labour', count: data.hours.length + data.localHours.length },
    { key: 'parts', label: 'Parts', count: data.parts.length + data.specialParts.length },
    { key: 'documents', label: 'Documents', count: data.documents.length },
    { key: 'revisions', label: 'Revisions', count: data.revisions.length },
    { key: 'activity', label: 'Activity', count: data.activity.length },
    { key: 'invoice', label: 'Invoice ready' },
  ]

  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12px] text-fg-muted">
        <Link to={listPath} search={{ view: 'open', sort: 'newest', size: 25 }} className="hover:text-fg">
          Work orders
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-fg">WO-{data.id}</span>
      </nav>

      <div className="border-b border-hair pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={data.statusProjection.display} />
          {data.statusProjection.flags.map((flag) => (
            <Tag key={flag} tone="neutral">
              {flag.replaceAll('_', ' ')}
            </Tag>
          ))}
          <Tag tone="neutral">{data.priorityName ?? `Priority ${data.priorityId}`}</Tag>
          {data.triage.map((flag) => (
            <Tag key={flag} tone={flag === 'critical' ? 'danger' : 'info'}>
              {TRIAGE_LABELS[flag]}
            </Tag>
          ))}
          {data.customerPo ? <Tag>PO {data.customerPo}</Tag> : null}
          <span className="text-[11.5px] text-fg-muted">Updated {formatDateTime(data.updatedAt)}</span>
        </div>

        <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h1 className="font-serif text-[26px] leading-tight tracking-[-0.01em] text-fg">
              {data.site?.name ?? `Site ${data.siteId}`}
              {data.serviceRequired ? (
                <span className="text-fg-muted"> — {data.serviceRequired.slice(0, 80)}</span>
              ) : null}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-muted">
              <span>{data.site?.customerName ?? 'Unknown customer'}</span>
              {data.site ? (
                <span>
                  {data.site.street}, {data.site.city} {data.site.province}
                </span>
              ) : null}
              <span className="font-mono">WO-{data.id}</span>
              {data.series === 2 ? <Tag tone="info">Maintenance</Tag> : null}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {notice ? (
              <p role="status" className="max-w-[360px] text-[12px] text-fg-secondary">
                {notice}
              </p>
            ) : null}
            {data.capabilities.canEdit ? (
              <Button onClick={() => setEditing((value) => !value)}>
                <Pencil size={14} aria-hidden="true" /> {editing ? 'Close editor' : 'Edit'}
              </Button>
            ) : null}
            <Button
              onClick={() => reminder.mutate()}
              disabled={!data.capabilities.canEdit || reminder.isPending}
            >
              Send reminder
            </Button>
            {primary ? (
              <Button
                variant="primary"
                disabled={transition.isPending || wsibBlocked}
                title={
                  wsibBlocked
                    ? 'Assign a subcontractor with valid WSIB/insurance or use the override permission.'
                    : undefined
                }
                onClick={() =>
                  transition.mutate(primary)
                }
              >
                {primary === 7 ? 'Dispatch' : primary === 2 ? 'Mark complete' : `Set ${statusLabel(primary)}`}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto border-b border-hair" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.key}
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => setTab(item.key)}
            className={`relative flex h-10 shrink-0 items-center gap-1.5 px-3 text-[13px] font-medium ${
              tab === item.key ? 'text-fg' : 'text-fg-muted hover:text-fg'
            }`}
          >
            {item.label}
            {item.count !== undefined ? (
              <span className="rounded-[2px] bg-subtle px-1.5 text-[10.5px] font-semibold text-fg-muted">
                {item.count}
              </span>
            ) : null}
            {tab === item.key ? (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[var(--action-primary-bg)]" />
            ) : null}
          </button>
        ))}
      </div>

      {editing ? (
        <WorkOrderForm
          mode="edit"
          detail={data}
          onSaved={() => {
            setEditing(false)
            setNotice('Work order saved.')
            refresh()
          }}
          onCancel={() => setEditing(false)}
        />
      ) : tab === 'overview' ? (
        <OverviewTab
          detail={data}
          onTriage={(flags) => triage.mutate(flags)}
          onTransition={(to) => transition.mutate(to)}
          nextStatuses={nextStatuses}
          statusTarget={statusTarget}
          setStatusTarget={setStatusTarget}
          note={note}
          setNote={setNote}
          onDone={refresh}
        />
      ) : tab === 'labour' ? (
        <LabourTab detail={data} onDone={refresh} />
      ) : tab === 'parts' ? (
        <PartsTab detail={data} onDone={refresh} />
      ) : tab === 'documents' ? (
        <DocumentsTab detail={data} onDone={refresh} />
      ) : tab === 'revisions' ? (
        <RevisionsTab
          detail={data}
          revisionId={revisionId}
          setRevisionId={setRevisionId}
          onSave={() => revision.mutate()}
          saving={revision.isPending}
        />
      ) : tab === 'activity' ? (
        <ActivityTab detail={data} onDone={refresh} />
      ) : (
        <InvoiceReadyTab detail={data} portal={portal} />
      )}

      <p className="text-[11.5px] text-fg-muted">
        Record version {data.version}. Every write is audited; revisions are full snapshots.
      </p>
    </div>
  )
}

function OverviewTab({
  detail,
  onTriage,
  nextStatuses,
  statusTarget,
  setStatusTarget,
  note,
  setNote,
  onTransition,
  onDone,
}: {
  detail: WorkOrderDetail
  onTriage: (flags: TriageFlag[]) => void
  nextStatuses: readonly WorkOrderStatusCode[]
  statusTarget: string
  setStatusTarget: (value: string) => void
  note: string
  setNote: (value: string) => void
  onTransition: (to: WorkOrderStatusCode) => void
  onDone: () => void
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <Card title="Summary">
          <dl className="grid gap-x-8 gap-y-3 text-[12.5px] sm:grid-cols-2">
            <Item label="Customer" value={detail.site?.customerName ?? '—'} />
            <Item
              label="Site"
              value={
                detail.site
                  ? `${detail.site.street}, ${detail.site.city} ${detail.site.province}`
                  : '—'
              }
            />
            <Item label="Service type" value={detail.serviceTypeName ?? `#${detail.serviceTypeId}`} />
            <Item label="Category" value={detail.categoryName ?? '—'} />
            <Item label="Date taken" value={formatDate(detail.dateTaken)} />
            <Item label="Expected completion" value={formatDate(detail.expectedCompletion)} />
            <Item label="Subcontractor" value={detail.subcontractor?.name ?? 'Unassigned'} />
            <Item label="Customer PO" value={detail.customerPo ?? '—'} />
            <Item label="Created" value={`${formatDateTime(detail.createdAt)} · ${detail.createdByLabel ?? '—'}`} />
            <Item label="Updated" value={`${formatDateTime(detail.updatedAt)} · ${detail.updatedByLabel ?? '—'}`} />
          </dl>
          <div className="mt-4 border-t border-hair pt-3">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">
              Service required
            </p>
            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-fg-secondary">
              {detail.serviceRequired || '—'}
            </p>
          </div>
          {detail.notes ? (
            <div className="mt-3">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">
                Internal notes
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-fg-secondary">
                {detail.notes}
              </p>
            </div>
          ) : null}
        </Card>

        <Card title="Service report">
          {detail.capabilities.canCapture ? (
            <ReportForm detail={detail} onDone={onDone} />
          ) : (
            <p className="whitespace-pre-wrap text-[13px] text-fg-secondary">
              {detail.report || 'No report yet.'}
            </p>
          )}
        </Card>
      </div>

      <div className="space-y-5">
        <Card title="Status">
          <p className="text-[11.5px] text-fg-muted">
            {detail.statusProjection.legacyLabel} — step through the lifecycle. Invoiced and
            cancelled are terminal.
          </p>
          {nextStatuses.length > 0 ? (
            <div className="mt-3 space-y-2">
              <Select
                aria-label="Next status"
                value={statusTarget}
                onChange={(event) => setStatusTarget(event.target.value)}
              >
                <option value="">Choose a status…</option>
                {nextStatuses.map((code) => (
                  <option key={code} value={code}>
                    {statusLabel(code)}
                  </option>
                ))}
              </Select>
              <Textarea
                aria-label="Status note"
                rows={2}
                placeholder="Optional note for the activity trail."
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <Button
                variant="primary"
                className="w-full"
                disabled={!statusTarget}
                onClick={() => onTransition(Number(statusTarget) as WorkOrderStatusCode)}
              >
                Update status
              </Button>
            </div>
          ) : (
            <p className="mt-3 text-[12.5px] text-fg-secondary">No further transitions.</p>
          )}
        </Card>

        <Card title="Triage">
          <div className="flex flex-wrap gap-3">
            {(['red', 'green', 'critical'] as TriageFlag[]).map((flag) => (
              <label key={flag} className="flex items-center gap-1.5 text-[12.5px] text-fg-secondary">
                <input
                  type="checkbox"
                  checked={detail.triage.includes(flag)}
                  disabled={!detail.capabilities.canEdit}
                  onChange={(event) =>
                    onTriage(
                      event.target.checked
                        ? [...detail.triage, flag]
                        : detail.triage.filter((item) => item !== flag),
                    )
                  }
                />
                {TRIAGE_LABELS[flag]}
              </label>
            ))}
          </div>
        </Card>

        <Card title="WSIB / insurance">
          {detail.subcontractor ? (
            <div className="space-y-2 text-[12.5px]">
              <p className="text-fg">{detail.subcontractor.name}</p>
              {detail.wsib.valid ? (
                <p className="text-[var(--status-complete-fg)]">
                  Valid{documentTypeSuffix(detail.wsib.documentType)} — expires{' '}
                  {formatDate(detail.wsib.expirationDate)}
                </p>
              ) : (
                <p className="text-[var(--status-rejected-fg)]">
                  No valid document on file. Assignment needs the override permission.
                </p>
              )}
              {detail.capabilities.canOverrideWsib ? (
                <p className="text-fg-muted">You hold the scoped WSIB override for this vendor.</p>
              ) : null}
            </div>
          ) : (
            <p className="text-[12.5px] text-fg-muted">No subcontractor assigned.</p>
          )}
        </Card>

        <Card title="Assignment">
          {detail.assignments.length === 0 ? (
            <p className="text-[12.5px] text-fg-muted">Nobody assigned yet.</p>
          ) : (
            <ul className="space-y-2 text-[12.5px]">
              {detail.assignments.map((assignment) => (
                <li key={assignment.id} className="flex items-center justify-between gap-2">
                  <span>{assignment.techName ?? assignment.subcontractorName ?? '—'}</span>
                  <Tag>{assignment.role}</Tag>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

function documentTypeSuffix(documentType: string | null): string {
  return documentType ? ` (${documentType})` : ''
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-[13px] text-fg">{value}</dd>
    </div>
  )
}

function LabourTab({ detail, onDone }: { detail: WorkOrderDetail; onDone: () => void }) {
  return (
    <div className="space-y-5">
      {detail.capabilities.canCapture ? (
        <Card title="Add labour">
          <HoursForm detail={detail} onDone={onDone} />
        </Card>
      ) : null}
      <Card title="Labour lines" padded={false}>
        {detail.hours.length === 0 ? (
          <EmptyState title="No labour yet" description="Invoice calculation requires at least one labour line." />
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-subtle text-left text-[10px] uppercase tracking-[0.08em] text-fg-muted">
                <th className="px-4 py-2 font-semibold">Date</th>
                <th className="px-4 py-2 font-semibold">Hours</th>
                <th className="px-4 py-2 font-semibold">Rate code</th>
                <th className="px-4 py-2 font-semibold">Hourly rate</th>
                <th className="px-4 py-2 text-right font-semibold">Amount</th>
                <th className="px-4 py-2 font-semibold">Note</th>
              </tr>
            </thead>
            <tbody>
              {detail.hours.map((line) => (
                <tr key={line.id} className="border-t border-hair">
                  <td className="px-4 py-2">{formatDate(line.lineDate)}</td>
                  <td className="px-4 py-2 tabular-nums">{line.hours}</td>
                  <td className="px-4 py-2">{line.rateCode}</td>
                  <td className="px-4 py-2 tabular-nums">{formatMoney(line.hourlyRate)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatMoney(String(Number(line.hours) * Number(line.hourlyRate)))}
                  </td>
                  <td className="px-4 py-2 text-fg-muted">{line.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {detail.isLocal ? (
        <>
          {detail.capabilities.canCapture ? (
            <Card title="Local time">
              <LocalHoursForm detail={detail} onDone={onDone} />
            </Card>
          ) : null}
          <Card title="Local time lines" padded={false}>
            {detail.localHours.length === 0 ? (
              <EmptyState title="No local time captured" />
            ) : (
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="bg-subtle text-left text-[10px] uppercase tracking-[0.08em] text-fg-muted">
                    <th className="px-4 py-2 font-semibold">Date</th>
                    <th className="px-4 py-2 font-semibold">In</th>
                    <th className="px-4 py-2 font-semibold">Out</th>
                    <th className="px-4 py-2 font-semibold">Hours</th>
                    <th className="px-4 py-2 font-semibold">Headcount</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.localHours.map((line) => (
                    <tr key={line.id} className="border-t border-hair">
                      <td className="px-4 py-2">{formatDate(line.lineDate)}</td>
                      <td className="px-4 py-2">{line.timeIn ?? '—'}</td>
                      <td className="px-4 py-2">{line.timeOut ?? '—'}</td>
                      <td className="px-4 py-2 tabular-nums">{line.hours}</td>
                      <td className="px-4 py-2">{line.headcount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      ) : null}

      {detail.isLocal ? (
        <>
          {detail.capabilities.canCapture ? (
            <Card title="Capture signature">
              <SignatureForm detail={detail} onDone={onDone} />
            </Card>
          ) : null}
          <Card title="Signatures">
            {detail.signatures.length === 0 ? (
              <p className="text-[12.5px] text-fg-muted">No signatures captured.</p>
            ) : (
              <ul className="divide-y divide-[var(--border-hair)] text-[12.5px]">
                {detail.signatures.map((signature) => (
                  <li key={signature.id} className="flex items-center justify-between py-2">
                    <span>{signature.signerName}</span>
                    <span className="text-fg-muted">{formatDateTime(signature.capturedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}
    </div>
  )
}

function PartsTab({ detail, onDone }: { detail: WorkOrderDetail; onDone: () => void }) {
  return (
    <div className="space-y-5">
      {detail.capabilities.canCapture ? (
        <Card title="Add parts">
          <PartsForm detail={detail} onDone={onDone} />
        </Card>
      ) : null}
      <Card title="Parts" padded={false}>
        {detail.parts.length === 0 ? (
          <EmptyState title="No parts yet" />
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-subtle text-left text-[10px] uppercase tracking-[0.08em] text-fg-muted">
                <th className="px-4 py-2 font-semibold">Part</th>
                <th className="px-4 py-2 font-semibold">Description</th>
                <th className="px-4 py-2 font-semibold">Qty</th>
                <th className="px-4 py-2 font-semibold">Price</th>
                <th className="px-4 py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {detail.parts.map((line) => (
                <tr key={line.id} className="border-t border-hair">
                  <td className="px-4 py-2 font-mono text-[11.5px]">{line.partNo}</td>
                  <td className="px-4 py-2">{line.description ?? '—'}</td>
                  <td className="px-4 py-2 tabular-nums">{line.qty}</td>
                  <td className="px-4 py-2 tabular-nums">{formatMoney(line.price)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatMoney(String(Number(line.qty) * Number(line.price)))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {detail.capabilities.canCapture ? (
        <Card title="Add special-order part">
          <SpecialPartsForm detail={detail} onDone={onDone} />
        </Card>
      ) : null}
      <Card title="Special-order parts" padded={false}>
        {detail.specialParts.length === 0 ? (
          <EmptyState title="No special-order parts" />
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-subtle text-left text-[10px] uppercase tracking-[0.08em] text-fg-muted">
                <th className="px-4 py-2 font-semibold">Description</th>
                <th className="px-4 py-2 font-semibold">Qty</th>
                <th className="px-4 py-2 font-semibold">Price</th>
                <th className="px-4 py-2 font-semibold">Emergency</th>
                <th className="px-4 py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {detail.specialParts.map((line) => (
                <tr key={line.id} className="border-t border-hair">
                  <td className="px-4 py-2">{line.name}</td>
                  <td className="px-4 py-2 tabular-nums">{line.qty}</td>
                  <td className="px-4 py-2 tabular-nums">{formatMoney(line.price)}</td>
                  <td className="px-4 py-2">{line.isEmergencyLighting ? 'Yes' : '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatMoney(String(Number(line.qty) * Number(line.price)))}
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

function DocumentsTab({ detail, onDone }: { detail: WorkOrderDetail; onDone: () => void }) {
  return (
    <div className="space-y-5">
      {detail.capabilities.canCapture ? (
        <Card title="Upload">
          <UploadForm detail={detail} onDone={onDone} />
        </Card>
      ) : null}
      <Card title="Documents" padded={false}>
        {detail.documents.length === 0 ? (
          <EmptyState title="No documents" description="Photos, service reports and signatures appear here." />
        ) : (
          <ul className="divide-y divide-[var(--border-hair)]">
            {detail.documents.map((document) => (
              <li key={document.id} className="flex items-center gap-3 px-4 py-3">
                <FileText size={18} strokeWidth={1.5} className="shrink-0 text-fg-faint" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-fg">{document.filename}</p>
                  <p className="text-[11px] text-fg-muted">
                    {document.kind} · {document.contentType ?? 'unknown type'} ·{' '}
                    {document.sizeBytes ? `${Math.round(document.sizeBytes / 1024)} KB` : '—'} ·{' '}
                    {formatDateTime(document.uploadedAt)}
                  </p>
                </div>
                {document.url ? (
                  <a
                    href={document.url}
                    className="text-[12px] font-medium text-brand hover:underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download
                  </a>
                ) : (
                  <span className="text-[11px] text-fg-faint">Local storage</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function RevisionsTab({
  detail,
  revisionId,
  setRevisionId,
  onSave,
  saving,
}: {
  detail: WorkOrderDetail
  revisionId: number | null
  setRevisionId: (id: number | null) => void
  onSave: () => void
  saving: boolean
}) {
  const revision = useQuery({
    queryKey: ['revision', detail.id, revisionId],
    queryFn: () =>
      getRevisionFn({ data: { workOrderId: detail.id, revisionId: revisionId as number } }),
    enabled: revisionId !== null,
  })

  return (
    <div className="space-y-5">
      <Card
        title="Revisions"
        action={
          detail.capabilities.canManageRevisions ? (
            <Button size="sm" onClick={onSave} disabled={saving}>
              <Plus size={13} aria-hidden="true" /> Save revision
            </Button>
          ) : null
        }
        padded={false}
      >
        {detail.revisions.length === 0 ? (
          <EmptyState title="No revisions" />
        ) : (
          <ul className="divide-y divide-[var(--border-hair)]">
            {detail.revisions.map((item) => (
              <li key={item.revisionId} className="flex items-center gap-3 px-4 py-2.5 text-[12.5px]">
                <button
                  className="font-medium text-brand hover:underline"
                  onClick={() => setRevisionId(item.revisionId)}
                >
                  Revision {item.revisionId}
                </button>
                <Tag>{item.revisionType}</Tag>
                {item.isLastRevision ? <Tag tone="info">Current</Tag> : null}
                <span className="ml-auto text-fg-muted">{formatDateTime(item.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {revisionId !== null ? (
        <Card title={`Snapshot ${revisionId}`}>
          {revision.isPending ? (
            <p className="text-[12.5px] text-fg-muted">Loading snapshot…</p>
          ) : revision.isError ? (
            <ErrorPanel message={(revision.error as Error).message} />
          ) : revision.data ? (
            <pre className="max-h-[520px] overflow-auto rounded-[4px] bg-subtle p-3 text-[11px] leading-relaxed text-fg-secondary">
              {JSON.stringify(revision.data, null, 2)}
            </pre>
          ) : null}
        </Card>
      ) : null}
    </div>
  )
}

function ActivityTab({ detail, onDone }: { detail: WorkOrderDetail; onDone: () => void }) {
  const [notes, setNotes] = useState('')
  const addNote = useMutation({
    mutationFn: () =>
      addNoteFn({ data: { workOrderId: detail.id, notes, isPublic: false } }),
    onSuccess: () => {
      setNotes('')
      onDone()
    },
  })

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card title="Activity">
        {detail.activity.length === 0 ? (
          <p className="text-[12.5px] text-fg-muted">No activity recorded.</p>
        ) : (
          <ol className="divide-y divide-[var(--border-hair)]">
            {detail.activity.map((event) => (
              <li key={event.id} className="flex gap-3 py-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--action-primary-bg)]" />
                <div className="min-w-0">
                  <p className="text-[12.5px] text-fg">
                    {event.summary ?? event.action}
                  </p>
                  <p className="text-[11px] text-fg-muted">
                    {formatDateTime(event.createdAt)} · {event.actorLabel ?? 'system'}
                    {event.actorRole ? ` (${event.actorRole})` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <div className="space-y-5">
        <Card title="Notes and status history">
          {detail.noteHistory.length === 0 ? (
            <p className="text-[12.5px] text-fg-muted">No notes yet.</p>
          ) : (
            <ul className="space-y-3">
              {detail.noteHistory.map((entry) => (
                <li key={entry.id} className="text-[12.5px]">
                  <p className="font-medium text-fg">{entry.title ?? entry.notesType}</p>
                  {entry.notes ? <p className="text-fg-secondary">{entry.notes}</p> : null}
                  <p className="text-[11px] text-fg-muted">
                    {formatDateTime(entry.createdAt)} · {entry.actorLabel ?? 'system'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {detail.capabilities.canEdit ? (
          <Card title="Add note">
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (notes.trim()) addNote.mutate()
              }}
            >
              <Textarea
                aria-label="Note"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
              <Button type="submit" variant="primary" disabled={!notes.trim() || addNote.isPending}>
                Add note
              </Button>
              {addNote.isError ? (
                <p role="alert" className="text-[12px] text-danger">
                  {(addNote.error as Error).message}
                </p>
              ) : null}
            </form>
          </Card>
        ) : null}
      </div>
    </div>
  )
}

function InvoiceReadyTab({
  detail,
  portal,
}: {
  detail: WorkOrderDetail
  portal: 'office' | 'subcontractor' | 'technician'
}) {
  const snapshot = useQuery({
    queryKey: ['invoice-ready', detail.id],
    queryFn: () => getInvoiceReadySnapshotFn({ data: { id: detail.id } }),
  })

  if (snapshot.isPending) {
    return <div className="h-[240px] animate-pulse rounded-[6px] border border-hair bg-subtle" />
  }
  if (snapshot.isError) {
    return <ErrorPanel message={(snapshot.error as Error).message} retry={() => void snapshot.refetch()} />
  }
  const data = snapshot.data

  return (
    <div className="space-y-5">
      <Card title="Invoice-ready snapshot">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Item label="Calc type" value={data.calcType} />
          <Item label="Tax province" value={data.taxProvince} />
          <Item label="Customer PO" value={data.customerPo ?? '—'} />
          <Item
            label="Immutable"
            value={data.immutable ? 'Sage/stock posted — locked' : 'Not posted'}
          />
        </div>
        <p className="mt-3 text-[11.5px] text-fg-muted">
          This is the contract the Invoicing module consumes. Work Orders does not issue an
          invoice or post to Sage.
        </p>
      </Card>

      {data.totals ? (
        <Card title="Preview totals">
          <dl className="ml-auto w-full max-w-[260px] space-y-1 text-[13px]">
            <Row label="Labour" value={formatMoney(data.totals.labour)} />
            <Row label="Material" value={formatMoney(data.totals.material)} />
            <Row label="Subtotal" value={formatMoney(data.totals.subtotal)} />
            <Row label={`Tax (${data.taxProvince})`} value={formatMoney(data.totals.tax)} />
            <div className="flex justify-between border-t border-strong pt-1 text-[15px] font-semibold text-fg">
              <dt>Total</dt>
              <dd>{formatMoney(data.totals.total)}</dd>
            </div>
          </dl>
          {data.legacyCentCorrectionApplied ? (
            <p className="mt-2 text-[11px] text-fg-muted">
              Historical WO 73850 one-cent correction applied.
            </p>
          ) : null}
        </Card>
      ) : (
        <Card title="Totals withheld">
          <p className="text-[12.5px] text-fg-secondary">
            {data.totalsWithheldReason === 'invoice.calculate'
              ? 'Your account does not hold invoice.calculate, so the server withholds the money figures. Line inputs are still available to Invoicing.'
              : data.calculationError ?? 'Totals are not available yet.'}
          </p>
        </Card>
      )}

      <Card title="Inputs" padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-subtle text-left text-[10px] uppercase tracking-[0.08em] text-fg-muted">
                <th className="px-4 py-2 font-semibold">Kind</th>
                <th className="px-4 py-2 font-semibold">Description</th>
                <th className="px-4 py-2 font-semibold">Qty / hours</th>
                <th className="px-4 py-2 font-semibold">Rate / price</th>
                <th className="px-4 py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.labour.map((line, index) => (
                <tr key={`l-${index}`} className="border-t border-hair">
                  <td className="px-4 py-2">Labour</td>
                  <td className="px-4 py-2">{line.date}</td>
                  <td className="px-4 py-2 tabular-nums">{line.hours}</td>
                  <td className="px-4 py-2 tabular-nums">{line.hourlyRate}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{line.amount}</td>
                </tr>
              ))}
              {data.parts.map((line, index) => (
                <tr key={`p-${index}`} className="border-t border-hair">
                  <td className="px-4 py-2">Part</td>
                  <td className="px-4 py-2">{line.description ?? line.partNo}</td>
                  <td className="px-4 py-2 tabular-nums">{line.qty}</td>
                  <td className="px-4 py-2 tabular-nums">{line.price}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{line.amount}</td>
                </tr>
              ))}
              {data.specialParts.map((line, index) => (
                <tr key={`s-${index}`} className="border-t border-hair">
                  <td className="px-4 py-2">Special order</td>
                  <td className="px-4 py-2">{line.name}</td>
                  <td className="px-4 py-2 tabular-nums">{line.qty}</td>
                  <td className="px-4 py-2 tabular-nums">{line.price}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{line.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {portal === 'subcontractor' ? (
        <p className="text-[11.5px] text-fg-muted">
          Subcontractor portal: only this company’s work orders are visible, enforced on the server.
        </p>
      ) : null}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-fg-secondary">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}
