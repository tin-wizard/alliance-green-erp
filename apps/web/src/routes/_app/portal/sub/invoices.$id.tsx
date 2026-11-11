import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { SubInvoiceDetail } from '../../../../modules/invoicing/components/sub-invoice-detail'
import { getSessionFn } from '../../../../server/auth.functions'

export const Route = createFileRoute('/_app/portal/sub/invoices/$id')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/portal/sub/invoices' } })
    if (session.user.role !== 'subcontractor') throw redirect({ to: '/' })
    return { session }
  },
  component: SubInvoiceDetailPage,
})

function SubInvoiceDetailPage() {
  const { id } = Route.useParams()
  const numeric = Number(id)
  if (!Number.isInteger(numeric) || numeric <= 0) throw notFound()
  return <SubInvoiceDetail id={numeric} />
}
