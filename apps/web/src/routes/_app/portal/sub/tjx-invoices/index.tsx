import { createFileRoute, redirect } from '@tanstack/react-router'
import { AssignedTjxInvoiceList } from '../../../../../modules/tjx/components/sub-invoice-list'
import { getSessionFn } from '../../../../../server/auth.functions'

export const Route = createFileRoute('/_app/portal/sub/tjx-invoices/')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) {
      throw redirect({ to: '/login', search: { redirect: '/portal/sub/tjx-invoices' } })
    }
    return { session }
  },
  component: SubTjxInvoicesPage,
})

function SubTjxInvoicesPage() {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">
          Subcontractor portal
        </p>
        <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">
          TJX installation invoices
        </h1>
        <p className="mt-1 max-w-[68ch] text-[13.5px] text-fg-secondary">
          Open an approved TJX work order, enter the installed quantities, attach the three pieces of
          evidence and submit. The office reviews the standard invoice and Sage posting.
        </p>
      </div>
      <AssignedTjxInvoiceList />
    </div>
  )
}
