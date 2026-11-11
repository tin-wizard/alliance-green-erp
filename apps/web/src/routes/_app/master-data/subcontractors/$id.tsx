import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../../../../server/auth.functions'
import { SubcontractorDetailScreen } from '../../../../modules/master-data/components/details'

export const Route = createFileRoute('/_app/master-data/subcontractors/$id')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/master-data/subcontractors' } })
    if (!session.user.grants.some((grant) => grant.key === 'subcontractor:read')) {
      throw redirect({ to: '/' })
    }
    return { session }
  },
  component: SubcontractorPage,
})

function SubcontractorPage() {
  const { id } = Route.useParams()
  const { session } = Route.useRouteContext()
  const canWrite = session.user.grants.some((grant) => grant.key === 'subcontractor:write')
  const numeric = Number(id)
  if (!Number.isInteger(numeric) || numeric === 0) throw notFound()
  return <SubcontractorDetailScreen id={numeric} canWrite={canWrite} canManageCompliance={session.user.grants.some((grant) => grant.key === 'compliance:write')} />
}
