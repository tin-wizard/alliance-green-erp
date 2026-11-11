import { createFileRoute, redirect } from '@tanstack/react-router'
import { SubInvoicePortal } from '../../../../../modules/invoicing/components/sub-invoice-portal'
import { getSessionFn } from '../../../../../server/auth.functions'

export const Route = createFileRoute('/_app/portal/sub/invoices/')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/portal/sub/invoices' } })
    if (session.user.role !== 'subcontractor') throw redirect({ to: '/' })
    return { session }
  },
  component: SubInvoicePortalPage,
})

function SubInvoicePortalPage() {
  return <SubInvoicePortal />
}
