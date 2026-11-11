import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { InvoiceDetailScreen } from '../../../modules/invoicing/components/invoice-detail'
import { getSessionFn } from '../../../server/auth.functions'

export const Route = createFileRoute('/_app/invoicing/$id')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/invoicing' } })
    return { session }
  },
  component: InvoiceDetailPage,
})

function InvoiceDetailPage() {
  const { id } = Route.useParams()
  const numeric = Number(id)
  if (!Number.isInteger(numeric) || numeric <= 0) throw notFound()
  return <InvoiceDetailScreen id={numeric} />
}
