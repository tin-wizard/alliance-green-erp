import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, ShieldAlert, ShieldCheck } from 'lucide-react'
import {
  Button,
  Card,
  EmptyState,
  ErrorPanel,
  Input,
  Tag,
  formatDate,
  formatDateTime,
} from '../../../modules/work-orders/components/ui'
import { getSessionFn } from '../../../server/auth.functions'
import { getComplianceOverviewFn } from '../../../modules/compliance/server/compliance.functions'
import { COMPLIANCE_WINDOWS, type ComplianceDocumentView } from '../../../modules/compliance/types'
import { complianceWindowLabel } from '../../../modules/compliance/lib/format'

export const Route = createFileRoute('/_app/compliance/')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/compliance' } })
    return { session }
  },
  component: CompliancePage,
})

function CompliancePage() {
  const [term, setTerm] = useState('')
  const [windowFilter, setWindowFilter] = useState<'all' | 'expired' | number>('all')
  const query = useQuery({
    queryKey: ['compliance-overview'],
    queryFn: () => getComplianceOverviewFn({ data: {} }),
  })

  const data = query.data
  const subcontractors = useMemo(() => {
    if (!data) return []
    const search = term.trim().toLowerCase()
    return data.subcontractors.filter(
      (row) => !search || row.name.toLowerCase().includes(search),
    )
  }, [data, term])

  const expiries = useMemo(() => {
    if (!data) return []
    return data.expiries.filter((row) =>
      windowFilter === 'all'
        ? true
        : windowFilter === 'expired'
          ? row.state === 'expired'
          : row.window === windowFilter,
    )
  }, [data, windowFilter])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hair pb-5 pt-2">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">
            Operations
          </p>
          <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">
            Compliance
          </h1>
          <p className="mt-1 max-w-[75ch] text-[13.5px] text-fg-secondary">
            WSIB and insurance validity, the expiry windows that drive reminders, open work orders
            that cannot be assigned, and the override trail. Documents stay in Master Data; this
            screen reads them.
          </p>
        </div>
        {data ? <Tag tone="neutral">Business date {formatDate(data.today)}</Tag> : null}
      </div>

      {query.isPending ? <p className="text-[13px] text-fg-muted">Loading compliance…</p> : null}
      {query.error ? <ErrorPanel message={query.error.message} /> : null}

      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              icon={<ShieldCheck size={16} />}
              label="Active subcontractors"
              value={data.totals.activeSubcontractors}
              note={`${data.totals.gateBlocked} blocked for assignment`}
            />
            <Stat
              icon={<ShieldAlert size={16} />}
              label="Missing WSIB"
              value={data.totals.missingWsib}
              note={`${data.totals.missingInsurance} missing insurance`}
              danger={data.totals.missingWsib > 0}
            />
            <Stat
              icon={<CalendarClock size={16} />}
              label="Expiring in 30 days"
              value={data.totals.expiring30}
              note={`${data.totals.expired} already expired`}
              danger={data.totals.expired > 0}
            />
            <Stat
              icon={<AlertTriangle size={16} />}
              label="Blocked open work orders"
              value={data.totals.openWorkOrdersBlocked}
              note={`${data.totals.warrantyExpiring30} warranties expiring in 30`}
              danger={data.totals.openWorkOrdersBlocked > 0}
            />
          </div>

          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-[15px] font-semibold text-fg">Subcontractor status</h2>
                <p className="text-[12.5px] text-fg-muted">
                  A zero-document vendor is missing, not valid. The assignment gate accepts a valid
                  WSIB or insurance certificate.
                </p>
              </div>
              <Input
                aria-label="Search subcontractors"
                placeholder="Search subcontractor…"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                className="max-w-[280px]"
              />
            </div>
            {subcontractors.length === 0 ? (
              <EmptyState
                title="No subcontractors"
                description="Master Data creates the vendor; this screen never invents one."
              />
            ) : (
              <div className="overflow-x-auto rounded-[5px] border border-hair bg-surface">
                <table className="w-full text-left text-[12.5px]" data-testid="compliance-subcontractors">
                  <thead className="bg-surface-2 text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
                    <tr>
                      <th className="px-3 py-2">Subcontractor</th>
                      <th className="px-3 py-2">WSIB</th>
                      <th className="px-3 py-2">Insurance</th>
                      <th className="px-3 py-2 text-right">Open WOs</th>
                      <th className="px-3 py-2">Assignment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subcontractors.map((row) => (
                      <tr key={row.id} className="border-t border-hair align-top">
                        <td className="px-3 py-2">
                          <Link
                            to="/master-data/subcontractors/$id"
                            params={{ id: String(row.id) }}
                            className="font-medium text-fg underline decoration-hair underline-offset-2"
                          >
                            {row.name}
                          </Link>
                          <div className="text-[11.5px] text-fg-muted">
                            {row.province ?? 'No province'} · #{row.id}
                            {!row.isActive ? ' · inactive' : ''}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <DocumentState document={row.wsib} />
                        </td>
                        <td className="px-3 py-2">
                          <DocumentState document={row.insurance} />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.openWorkOrders}</td>
                        <td className="px-3 py-2">
                          {row.isActive ? (
                            row.gateValid ? (
                              <Tag tone="info">Allowed</Tag>
                            ) : (
                              <Tag tone="danger">Held</Tag>
                            )
                          ) : (
                            <Tag tone="neutral">Inactive</Tag>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-[15px] font-semibold text-fg">Expiry dashboard</h2>
                <p className="text-[12.5px] text-fg-muted">
                  The same 30/14/7/1/0 windows Master Data uses to queue reminders.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <WindowButton active={windowFilter === 'all'} onClick={() => setWindowFilter('all')}>
                  All
                </WindowButton>
                {[...COMPLIANCE_WINDOWS].reverse().map((window) => (
                  <WindowButton
                    key={window}
                    active={windowFilter === window}
                    onClick={() => setWindowFilter(window)}
                  >
                    {window === 0 ? 'Today' : `${window}d`}
                  </WindowButton>
                ))}
                <WindowButton
                  active={windowFilter === 'expired'}
                  onClick={() => setWindowFilter('expired')}
                >
                  Expired
                </WindowButton>
              </div>
            </div>
            {expiries.length === 0 ? (
              <EmptyState
                title="No documents in this window"
                description="Nothing is due in the selected window. Widen the filter to see all current documents."
              />
            ) : (
              <div className="overflow-x-auto rounded-[5px] border border-hair bg-surface">
                <table className="w-full text-left text-[12.5px]" data-testid="compliance-expiries">
                  <thead className="bg-surface-2 text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
                    <tr>
                      <th className="px-3 py-2">Subcontractor</th>
                      <th className="px-3 py-2">Document</th>
                      <th className="px-3 py-2">Expires</th>
                      <th className="px-3 py-2">Window</th>
                      <th className="px-3 py-2">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expiries.map((row) => (
                      <tr key={`${row.subcontractorId}-${row.kind}`} className="border-t border-hair">
                        <td className="px-3 py-2 font-medium">{row.subcontractor}</td>
                        <td className="px-3 py-2">
                          <Tag tone={row.kind === 'wsib' ? 'info' : 'neutral'}>
                            {row.kind === 'wsib' ? 'WSIB' : 'Insurance'}
                          </Tag>
                          <span className="ml-2 text-[11.5px] text-fg-muted">
                            {row.fileName ?? 'No file name'}
                          </span>
                        </td>
                        <td className="px-3 py-2 tabular-nums">{formatDate(row.expiresOn)}</td>
                        <td className="px-3 py-2">{complianceWindowLabel(row.daysRemaining)}</td>
                        <td className="px-3 py-2">
                          {row.state === 'expired' ? (
                            <Tag tone="danger">Expired</Tag>
                          ) : (
                            <Tag tone="warning">Expiring</Tag>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-[15px] font-semibold text-fg">Work orders without valid coverage</h2>
              <p className="text-[12.5px] text-fg-muted">
                Open work orders assigned to a subcontractor whose WSIB and insurance are both
                missing, expired or invalid. These are the rows the WSIB hold blocks.
              </p>
            </div>
            {data.missingWsibWorkOrders.length === 0 ? (
              <EmptyState
                title="No blocked work orders"
                description="Every open assigned work order has current WSIB or insurance coverage."
              />
            ) : (
              <div className="overflow-x-auto rounded-[5px] border border-hair bg-surface">
                <table className="w-full text-left text-[12.5px]" data-testid="compliance-blocked-wos">
                  <thead className="bg-surface-2 text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
                    <tr>
                      <th className="px-3 py-2">WO</th>
                      <th className="px-3 py-2">Site</th>
                      <th className="px-3 py-2">Subcontractor</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Taken</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.missingWsibWorkOrders.map((row) => (
                      <tr key={row.id} className="border-t border-hair">
                        <td className="px-3 py-2 font-mono text-[12px]">
                          <Link to="/work-orders/$id" params={{ id: String(row.id) }} className="underline">
                            {row.id}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          {row.site}
                          <div className="text-[11.5px] text-fg-muted">{row.customer}</div>
                        </td>
                        <td className="px-3 py-2">{row.subcontractor}</td>
                        <td className="px-3 py-2">{row.statusLabel}</td>
                        <td className="px-3 py-2 tabular-nums">{formatDate(row.dateTaken)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card title="WSIB override grants">
              <p className="mb-3 text-[12px] text-fg-muted">
                Per-user permission <code className="text-[11px]">workorder:override_wsib_hold</code>.
                The note is the reason recorded with the grant.
              </p>
              {data.overrideGrants.length === 0 ? (
                <EmptyState
                  title="No per-user overrides"
                  description="Only an admin grant appears here. The role matrix does not grant this key by default."
                />
              ) : (
                <ul className="space-y-2 text-[12.5px]">
                  {data.overrideGrants.map((grant) => (
                    <li key={grant.userId} className="rounded-[4px] border border-hair px-3 py-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">{grant.user}</span>
                        <span className="text-[11.5px] text-fg-muted">{grant.email}</span>
                      </div>
                      <div className="text-[12px] text-fg-muted">
                        Scope: {grant.scopeSubcontractor ?? 'all subcontractors'}
                        {grant.scopeSubcontractorId ? ` (#${grant.scopeSubcontractorId})` : ''}
                      </div>
                      <div className="mt-1 text-[12px] text-fg">
                        Reason: {grant.note ?? 'No reason recorded on the grant'}
                      </div>
                      <div className="text-[11.5px] text-fg-muted">
                        Granted {formatDateTime(grant.grantedAt)}
                        {grant.expiresAt ? ` · expires ${formatDateTime(grant.expiresAt)}` : ''}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Recent override use">
              <p className="mb-3 text-[12px] text-fg-muted">
                Audit entries where a work order was saved or transitioned with the WSIB hold
                bypassed. The summary is the recorded reason.
              </p>
              {data.overrideUses.length === 0 ? (
                <EmptyState
                  title="No overrides used"
                  description="No audit entry records a bypass. A blocked assignment must attach a current document instead."
                />
              ) : (
                <ul className="space-y-2 text-[12.5px]">
                  {data.overrideUses.slice(0, 25).map((use) => (
                    <li key={use.id} className="rounded-[4px] border border-hair px-3 py-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">{use.actor}</span>
                        <span className="text-[11.5px] text-fg-muted">
                          {formatDateTime(use.createdAt)}
                        </span>
                      </div>
                      <div className="text-[12px] text-fg-muted">
                        {use.action}
                        {use.entityId ? ` · WO ${use.entityId}` : ''}
                      </div>
                      <div className="mt-1 text-[12px] text-fg">
                        Reason: {use.reason || 'No audit summary recorded'}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-[15px] font-semibold text-fg">Site warranty expiry</h2>
              <p className="text-[12.5px] text-fg-muted">
                {data.totals.warrantyExpired} expired and {data.totals.warrantyExpiring30} expiring
                in the next 30 days. Site warranties are created from RGA and remain editable in
                Master Data.
              </p>
            </div>
            {data.warranties.length === 0 ? (
              <EmptyState
                title="No site warranties"
                description="An approved RGA can record a site warranty. No warranty with an expiry date exists yet."
              />
            ) : (
              <div className="overflow-x-auto rounded-[5px] border border-hair bg-surface">
                <table className="w-full text-left text-[12.5px]" data-testid="compliance-warranties">
                  <thead className="bg-surface-2 text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
                    <tr>
                      <th className="px-3 py-2">Site</th>
                      <th className="px-3 py-2">Customer</th>
                      <th className="px-3 py-2">Description</th>
                      <th className="px-3 py-2">Expires</th>
                      <th className="px-3 py-2">State</th>
                      <th className="px-3 py-2">Source WO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.warranties.map((row) => (
                      <tr key={row.id} className="border-t border-hair">
                        <td className="px-3 py-2">
                          <Link
                            to="/master-data/sites/$id"
                            params={{ id: String(row.siteId) }}
                            className="underline"
                          >
                            {row.site}
                          </Link>
                        </td>
                        <td className="px-3 py-2">{row.customer}</td>
                        <td className="px-3 py-2">{row.description ?? '—'}</td>
                        <td className="px-3 py-2 tabular-nums">
                          {formatDate(row.expiresOn)}
                          <div className="text-[11.5px] text-fg-muted">
                            {complianceWindowLabel(row.daysRemaining)}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <Tag
                            tone={
                              row.state === 'expired'
                                ? 'danger'
                                : row.state === 'expiring'
                                  ? 'warning'
                                  : 'info'
                            }
                          >
                            {row.state === 'expired'
                              ? 'Expired'
                              : row.state === 'expiring'
                                ? 'Expiring'
                                : 'Active'}
                          </Tag>
                        </td>
                        <td className="px-3 py-2">
                          {row.workOrderId ? (
                            <Link
                              to="/work-orders/$id"
                              params={{ id: String(row.workOrderId) }}
                              className="underline"
                            >
                              {row.workOrderId}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}

function Stat({
  icon,
  label,
  value,
  note,
  danger,
}: {
  icon: React.ReactNode
  label: string
  value: number
  note: string
  danger?: boolean
}) {
  return (
    <div className={`rounded-[5px] border bg-surface p-4 ${danger ? 'border-red-300' : 'border-hair'}`}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-fg-muted">
        {icon}
        {label}
      </div>
      <div className={`mt-2 text-[26px] font-semibold tabular-nums ${danger ? 'text-red-700' : 'text-fg'}`}>
        {value}
      </div>
      <div className="text-[12px] text-fg-muted">{note}</div>
    </div>
  )
}

function DocumentState({ document }: { document: ComplianceDocumentView | null }) {
  if (!document || document.state === 'missing') {
    return (
      <div>
        <Tag tone="danger">Missing</Tag>
        <div className="mt-1 text-[11.5px] text-fg-muted">No current document</div>
      </div>
    )
  }
  if (document.state === 'expired') {
    return (
      <div>
        <Tag tone="danger">Expired</Tag>
        <div className="mt-1 text-[11.5px] text-fg-muted">
          {document.expiresOn ? formatDate(document.expiresOn) : 'No expiry date'}
          {document.daysRemaining !== null ? ` · ${complianceWindowLabel(document.daysRemaining)}` : ''}
        </div>
      </div>
    )
  }
  return (
    <div>
      <Tag tone={document.state === 'expiring' ? 'warning' : 'info'}>
        {document.state === 'expiring' ? 'Expiring' : 'Valid'}
      </Tag>
      <div className="mt-1 text-[11.5px] text-fg-muted">
        {document.expiresOn ? formatDate(document.expiresOn) : 'No expiry date'}
        {document.daysRemaining !== null ? ` · ${complianceWindowLabel(document.daysRemaining)}` : ''}
      </div>
    </div>
  )
}

function WindowButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button variant={active ? 'primary' : 'secondary'} className="h-7 px-2 text-[11.5px]" onClick={onClick}>
      {children}
    </Button>
  )
}
