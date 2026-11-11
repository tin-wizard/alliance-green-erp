import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { InvoiceList } from '../../../modules/invoicing/components/invoice-list'
import { getSessionFn } from '../../../server/auth.functions'

export const Route = createFileRoute('/_app/invoicing/')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/invoicing' } })
    return { session }
  },
  component: InvoicingPage,
})

function InvoicingPage() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hair pb-5 pt-2">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">Sales</p>
          <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">Invoicing</h1>
          <p className="mt-1 max-w-[68ch] text-[13.5px] text-fg-secondary">
            Customer invoices built from the work-order invoice-ready snapshot. Posting to Sage is
            queued and idempotent; the invoice still issues when Sage is unreachable.
          </p>
        </div>
        <Link
          to="/invoicing/new"
          className="inline-flex h-9 items-center gap-1.5 rounded-[4px] border border-[var(--action-primary-bg)] bg-[var(--action-primary-bg)] px-3.5 text-[13px] font-medium text-[var(--action-primary-fg)]"
        >
          <Plus size={14} aria-hidden="true" /> New invoice
        </Link>
      </div>
      <InvoiceList />
    </div>
  )
}
