import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../../../../server/auth.functions'
import { SiteDetailScreen } from '../../../../modules/master-data/components/details'

export const Route = createFileRoute('/_app/master-data/sites/$id')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/master-data/sites' } })
    if (!session.user.grants.some((grant) => grant.key === 'customer:read')) {
      throw redirect({ to: '/' })
    }
    return { session }
  },
  component: SitePage,
})

function SitePage() {
  const { id } = Route.useParams()
  const numeric = Number(id)
  if (!Number.isInteger(numeric) || numeric <= 0) throw notFound()
  return <SiteDetailScreen id={numeric} />
}
