import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../../../server/auth.functions'
import { WorkOrderListScreen } from '../../../modules/work-orders/components/work-order-list'
import { parseListSearch } from '../../../modules/work-orders/lib/list-search'

export const Route = createFileRoute('/_app/work-orders/')({
  validateSearch: (search: Record<string, unknown>) => parseListSearch(search),
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/work-orders' } })
    if (!session.user.grants.some((grant) => grant.key === 'workorder:read')) {
      throw redirect({ to: '/' })
    }
    return { session }
  },
  component: WorkOrdersPage,
})

function WorkOrdersPage() {
  const search = Route.useSearch()
  const { session } = Route.useRouteContext()
  return (
    <WorkOrderListScreen
      search={search}
      listPath="/work-orders"
      detailPath="/work-orders/$id"
      newPath="/work-orders/new"
      eyebrow="Operations · Work orders"
      title="Work orders."
      description="Subcontractor, local and project work orders. The default view is open work; the invoiced archive is reachable but never loaded by default."
      canCreate={session.user.grants.some((grant) => grant.key === 'workorder:create')}
      portal="office"
    />
  )
}
