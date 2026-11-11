import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../../../../server/auth.functions'
import { PartDetailScreen } from '../../../../modules/master-data/components/details'

export const Route = createFileRoute('/_app/master-data/parts/$id')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/master-data/parts' } })
    if (!session.user.grants.some((grant) => grant.key === 'inventory:read')) {
      throw redirect({ to: '/' })
    }
    return { session }
  },
  component: PartPage,
})

function PartPage() {
  const { id } = Route.useParams()
  const numeric = Number(id)
  if (!Number.isInteger(numeric) || numeric <= 0) throw notFound()
  return <PartDetailScreen id={numeric} />
}
