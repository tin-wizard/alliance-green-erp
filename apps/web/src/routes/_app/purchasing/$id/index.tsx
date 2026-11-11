import { createFileRoute, redirect } from '@tanstack/react-router'
import { PurchaseOrderDetailView } from '../../../../modules/purchasing/components/purchase-order-detail'
import { getSessionFn } from '../../../../server/auth.functions'

export const Route = createFileRoute('/_app/purchasing/$id/')({
  beforeLoad: async ({ params }) => {
    const session = await getSessionFn()
    if (!session) {
      throw redirect({ to: '/login', search: { redirect: `/purchasing/${params.id}` } })
    }
    return { session }
  },
  component: PurchaseOrderPage,
})

function PurchaseOrderPage() {
  const { id } = Route.useParams()
  const numericId = Number(id)
  return <PurchaseOrderDetailView id={numericId} />
}
