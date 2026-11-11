import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { WorkOrderDetailScreen } from '../../../../modules/work-orders/components/work-order-detail'
import { getSessionFn } from '../../../../server/auth.functions'

export const Route = createFileRoute('/_app/work-orders/$id/')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/work-orders' } })
    if (!session.user.grants.some((grant) => grant.key === 'workorder:read')) {
      throw redirect({ to: '/' })
    }
    return { session }
  },
  component: WorkOrderDetailPage,
})

function WorkOrderDetailPage() {
  const { id } = Route.useParams()
  const numeric = Number(id)
  if (!Number.isInteger(numeric) || numeric <= 0) throw notFound()
  return <WorkOrderDetailScreen id={numeric} listPath="/work-orders" portal="office" />
}
