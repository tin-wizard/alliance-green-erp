import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ArrowRight, Database, HardDrive, PlugZap, ShieldCheck, Sparkles, Workflow } from 'lucide-react'
import { PERMISSIONS } from '@cls/core'
import { PageHeader } from '../../shell/page-header'
import { getSystemStatusFn } from '../../server/status.functions'

export const Route = createFileRoute('/_app/')({
  component: Dashboard,
})

function Dashboard() {
  const { session } = Route.useRouteContext()
  const status = useQuery({
    queryKey: ['system-status'],
    queryFn: () => getSystemStatusFn(),
    refetchInterval: 30_000,
  })

  const firstName = session.user.displayName.split(' ')[0] ?? session.user.displayName
  const today = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date())

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={`Operations · ${today}`}
        title={
          <>
            Good to see you, <span className="font-serif italic text-brand">{firstName}</span>
          </>
        }
        description="This is the platform shell. Work Orders is the first module being rebuilt; the areas in the sidebar appear as each module lands."
      />

      <section aria-labelledby="platform-status" className="space-y-3">
        <h2
          id="platform-status"
          className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted"
        >
          Platform status
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <StatusCard
            icon={Database}
            title="Postgres (Neon)"
            value={
              status.isPending
                ? 'Checking…'
                : status.data?.checks.database.status === 'ok'
                  ? `Connected · ${status.data.checks.database.latencyMs ?? 0} ms`
                  : status.data?.checks.database.status === 'not_configured'
                    ? 'Not configured'
                    : 'Unavailable'
            }
            tone={
              status.data?.checks.database.status === 'ok'
                ? 'ok'
                : status.isPending
                  ? 'neutral'
                  : 'warn'
            }
            detail={
              status.data?.checks.database.error ??
              'Pooled connection over TLS. Migrations run separately with pnpm db:migrate.'
            }
          />
          <StatusCard
            icon={PlugZap}
            title="Sage 50"
            value={
              status.isPending
                ? 'Checking…'
                : status.data?.checks.sage.status === 'disabled'
                  ? 'Disabled'
                  : status.data?.checks.sage.status === 'unreachable'
                    ? 'Unreachable'
                    : status.data?.checks.sage.status === 'unverified'
                      ? 'Unverified'
                      : status.data?.checks.sage.status === 'verified'
                        ? 'Connected'
                        : status.data?.checks.sage.status === 'error'
                          ? 'Wrong company'
                          : 'Unknown'
            }
            tone={
              status.data?.checks.sage.status === 'verified'
                ? 'ok'
                : status.data?.checks.sage.status === 'disabled'
                  ? 'neutral'
                  : 'warn'
            }
            detail={status.data?.checks.sage.message ?? 'Legacy MySQL port scan, 13541 first.'}
          />
          <StatusCard
            icon={ShieldCheck}
            title="Neon Auth"
            value={
              status.isPending
                ? 'Checking…'
                : status.data?.checks.auth.status === 'ok'
                  ? 'Verifying JWTs'
                  : status.data?.checks.auth.status === 'not_configured'
                    ? 'Not configured'
                    : 'Unavailable'
            }
            tone={
              status.data?.checks.auth.status === 'ok'
                ? 'ok'
                : status.isPending
                  ? 'neutral'
                  : 'warn'
            }
            detail={status.data?.checks.auth.message ?? 'EdDSA JWKS verification on every request.'}
          />
          <StatusCard
            icon={HardDrive}
            title="Object storage"
            value={
              status.isPending
                ? 'Checking…'
                : status.data?.checks.storage.status === 'ok'
                  ? `Ready · ${status.data.checks.storage.driver}`
                  : status.data?.checks.storage.status === 'not_configured'
                    ? 'Local fallback'
                    : 'Unavailable'
            }
            tone={
              status.data?.checks.storage.status === 'ok'
                ? 'ok'
                : status.isPending
                  ? 'neutral'
                  : 'warn'
            }
            detail={
              status.data?.checks.storage.message ??
              'Neon Object Storage through the S3 API; local filesystem when offline.'
            }
          />
          <StatusCard
            icon={Sparkles}
            title="AI Gateway"
            value={
              status.isPending
                ? 'Checking…'
                : status.data?.checks.ai.status === 'disabled'
                  ? 'Off'
                  : status.data?.checks.ai.status === 'available'
                    ? 'Models listed'
                    : 'Unavailable'
            }
            tone={
              status.data?.checks.ai.status === 'disabled'
                ? 'neutral'
                : status.data?.checks.ai.status === 'available'
                  ? 'ok'
                  : 'warn'
            }
            detail={status.data?.checks.ai.message ?? 'Feature flagged; no inference assumed.'}
          />
          <StatusCard
            icon={Workflow}
            title="Your access"
            value={`${session.user.grants.length} of ${PERMISSIONS.length} permissions`}
            tone="ok"
            detail={`Role: ${session.user.role}. Grants are role defaults plus explicit user grants.`}
          />
        </div>
      </section>

      <section aria-labelledby="next-modules" className="space-y-3">
        <h2
          id="next-modules"
          className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted"
        >
          Build order
        </h2>
        <div className="rounded-[6px] border border-hair bg-canvas">
          <ul className="divide-y divide-[var(--border-hair)]">
            {[
              ['Work orders', 'Subcontractor, local and project work orders with revisions, hours and parts.', 'In progress'],
              ['Quoting', 'Customer, standalone, subcontractor and TJX quotes.', 'Next'],
              ['Purchasing and inventory', 'Purchase orders, receipts, RGAs, parts catalogue and stock.', 'Planned'],
              ['Invoicing', 'Subcontractor, PO and project invoices with tax handling.', 'Planned'],
              ['Compliance and Sage sync', 'WSIB/insurance tracking and the preserved Sage 50 connection.', 'Planned'],
            ].map(([title, description, state]) => (
              <li key={title} className="flex items-start gap-3 px-4 py-3.5">
                <ArrowRight
                  size={16}
                  strokeWidth={1.5}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-fg-faint"
                />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-fg">{title}</p>
                  <p className="text-[12.5px] text-fg-muted">{description}</p>
                </div>
                <span className="ml-auto shrink-0 rounded-[2px] border border-hair px-2 py-0.5 text-[10.5px] font-medium text-fg-muted">
                  {state}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <p className="text-[11.5px] text-fg-muted">
        Health endpoint: <code className="font-mono text-fg-secondary">/api/health</code>. Readiness:{' '}
        <code className="font-mono text-fg-secondary">/api/ready</code>. Liveness:{' '}
        <code className="font-mono text-fg-secondary">/healthz</code>.
      </p>
    </div>
  )
}

function StatusCard({
  icon: Icon,
  title,
  value,
  detail,
  tone,
}: {
  icon: typeof Database
  title: string
  value: string
  detail: string
  tone: 'ok' | 'warn' | 'neutral'
}) {
  const dot =
    tone === 'ok'
      ? 'var(--status-complete-fg)'
      : tone === 'warn'
        ? 'var(--status-pending-fg)'
        : 'var(--text-faint)'
  return (
    <div className="rounded-[6px] border border-hair bg-canvas p-4">
      <div className="flex items-center gap-2 text-fg-muted">
        <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em]">{title}</span>
      </div>
      <p className="mt-3 flex items-center gap-2 text-[15px] font-medium text-fg">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
        {value}
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-fg-muted">{detail}</p>
    </div>
  )
}
