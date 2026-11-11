import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../../../../server/auth.functions'
import { CustomerDetailScreen } from '../../../../modules/master-data/components/details'

export const Route = createFileRoute('/_app/master-data/customers/$id')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/master-data/customers' } })
    if (!session.user.grants.some((grant) => grant.key === 'customer:read')) {
      throw redirect({ to: '/' })
    }
    return { session }
  },
  component: CustomerPage,
})

function CustomerPage() {
  const { id } = Route.useParams()
  const { session } = Route.useRouteContext()
  const canWrite = session.user.grants.some((grant) => grant.key === 'customer:write')
  const numeric = Number(id)
  if (!Number.isInteger(numeric) || numeric === 0) throw notFound()
  return <CustomerDetailScreen id={numeric} canWrite={canWrite} />
}
