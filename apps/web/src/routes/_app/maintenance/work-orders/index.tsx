import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../../../../server/auth.functions'
import { WorkOrderListScreen } from '../../../../modules/work-orders/components/work-order-list'
import { parseListSearch } from '../../../../modules/work-orders/lib/list-search'

export const Route = createFileRoute('/_app/maintenance/work-orders/')({
  validateSearch: (search: Record<string, unknown>) => parseListSearch(search),
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/maintenance/work-orders' } })
    if (!session.user.grants.some((grant) => grant.key === 'workorder:read')) {
      throw redirect({ to: '/' })
    }
    return { session }
  },
  component: MaintenanceWorkOrdersPage,
})

function MaintenanceWorkOrdersPage() {
  const search = Route.useSearch()
  const { session } = Route.useRouteContext()
  return (
    <WorkOrderListScreen
      search={search}
      series={2}
      listPath="/maintenance/work-orders"
      detailPath="/maintenance/work-orders/$id"
      newPath="/maintenance/work-orders/new"
      eyebrow="Operations · Maintenance"
      title="Maintenance work orders."
      description="The second numbering series (`wo_next_pid.id = 2`). Same lifecycle and money rules as the main series."
      canCreate={session.user.grants.some((grant) => grant.key === 'workorder:create')}
      portal="office"
    />
  )
}
