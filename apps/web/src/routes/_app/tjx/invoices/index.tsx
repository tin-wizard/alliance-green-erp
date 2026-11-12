import { createFileRoute, redirect } from '@tanstack/react-router'
import { TjxInvoiceReviewList } from '../../../../modules/tjx/components/sub-invoice-list'
import { getSessionFn } from '../../../../server/auth.functions'

export const Route = createFileRoute('/_app/tjx/invoices/')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/tjx/invoices' } })
    if (!session.user.grants.some((grant) => grant.key === 'tjx:read')) {
      throw redirect({ to: '/' })
    }
    return { session }
  },
  component: TjxInvoicesPage,
})

function TjxInvoicesPage() {
  return (
    <div className="space-y-5">
      <div className="border-b border-hair pb-5 pt-2">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">Sales</p>
        <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">
          TJX subcontractor invoices
        </h1>
        <p className="mt-1 max-w-[68ch] text-[13.5px] text-fg-secondary">
          Review the standard invoice the subcontractor submitted. Approval queues one Sage posting
          and moves the work order to Pending Invoice; rejection returns it for correction.
        </p>
      </div>
      <TjxInvoiceReviewList />
    </div>
  )
}
