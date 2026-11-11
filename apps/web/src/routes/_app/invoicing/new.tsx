import { createFileRoute, redirect } from '@tanstack/react-router'
import { InvoiceCreate } from '../../../modules/invoicing/components/invoice-create'
import { getSessionFn } from '../../../server/auth.functions'

export const Route = createFileRoute('/_app/invoicing/new')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/invoicing/new' } })
    if (!session.user.grants.some((grant) => grant.key === 'invoice:write')) {
      throw redirect({ to: '/invoicing' })
    }
    return { session }
  },
  component: NewInvoicePage,
})

function NewInvoicePage() {
  return (
    <div className="space-y-5">
      <div className="border-b border-hair pb-5 pt-2">
        <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">New invoice</h1>
      </div>
      <InvoiceCreate />
    </div>
  )
}
