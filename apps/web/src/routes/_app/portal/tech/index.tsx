import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../../../../server/auth.functions'
import { WorkOrderListScreen } from '../../../../modules/work-orders/components/work-order-list'
import { parseListSearch } from '../../../../modules/work-orders/lib/list-search'

export const Route = createFileRoute('/_app/portal/tech/')({
  validateSearch: (search: Record<string, unknown>) => parseListSearch(search),
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/portal/tech' } })
    if (!session.user.grants.some((grant) => grant.key === 'workorder:read')) {
      throw redirect({ to: '/' })
    }
    return { session }
  },
  component: TechnicianPortalPage,
})

function TechnicianPortalPage() {
  const search = Route.useSearch()
  return (
    <WorkOrderListScreen
      search={search}
      listPath="/portal/tech"
      detailPath="/portal/tech/$id"
      eyebrow="Technician portal"
      title="Assigned jobs."
      description="Only work orders assigned to you are listed. Arrival/departure, labour, parts, the report and photos are captured from the job sheet."
      canCreate={false}
      portal="technician"
    />
  )
}
