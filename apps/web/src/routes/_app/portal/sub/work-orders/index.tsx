import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../../../../../server/auth.functions'
import { WorkOrderListScreen } from '../../../../../modules/work-orders/components/work-order-list'
import { parseListSearch } from '../../../../../modules/work-orders/lib/list-search'

export const Route = createFileRoute('/_app/portal/sub/work-orders/')({
  validateSearch: (search: Record<string, unknown>) => parseListSearch(search),
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) {
      throw redirect({ to: '/login', search: { redirect: '/portal/sub/work-orders' } })
    }
    if (!session.user.grants.some((grant) => grant.key === 'workorder:read')) {
      throw redirect({ to: '/' })
    }
    return { session }
  },
  component: SubcontractorWorkOrdersPage,
})

function SubcontractorWorkOrdersPage() {
  const search = Route.useSearch()
  return (
    <WorkOrderListScreen
      search={search}
      listPath="/portal/sub/work-orders"
      detailPath="/portal/sub/work-orders/$id"
      eyebrow="Subcontractor portal"
      title="Your work orders."
      description="Only work orders assigned to your company are listed. The server scopes every query and every write to your vendor."
      canCreate={false}
      portal="subcontractor"
    />
  )
}
