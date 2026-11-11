import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../../../../../server/auth.functions'
import { CustomerForm } from '../../../../../modules/master-data/components/forms'

export const Route = createFileRoute('/_app/master-data/customers/edit/$id')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/master-data/customers' } })
    if (!session.user.grants.some((grant) => grant.key === 'customer:write')) throw redirect({ to: '/' })
    return { session }
  },
  component: EditPage,
})

function EditPage() {
  const { id } = Route.useParams()
  const numeric = Number(id)
  if (!Number.isInteger(numeric) || numeric === 0) throw notFound()
  return <CustomerForm mode="edit" id={numeric} />
}
