import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../../../../server/auth.functions'
import { SupplierDetailScreen } from '../../../../modules/master-data/components/details'

export const Route = createFileRoute('/_app/master-data/suppliers/$id')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/master-data/suppliers' } })
    if (!session.user.grants.some((grant) => grant.key === 'supplier:read')) {
      throw redirect({ to: '/' })
    }
    return { session }
  },
  component: SupplierPage,
})

function SupplierPage() {
  const { id } = Route.useParams()
  const numeric = Number(id)
  if (!Number.isInteger(numeric) || numeric <= 0) throw notFound()
  return <SupplierDetailScreen id={numeric} />
}
