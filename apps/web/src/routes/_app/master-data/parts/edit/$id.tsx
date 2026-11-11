import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../../../../../server/auth.functions'
import { PartForm } from '../../../../../modules/master-data/components/forms'

export const Route = createFileRoute('/_app/master-data/parts/edit/$id')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/master-data/parts' } })
    if (!session.user.grants.some((grant) => grant.key === 'inventory:write')) throw redirect({ to: '/' })
    return { session }
  },
  component: EditPage,
})

function EditPage() {
  const { id } = Route.useParams()
  const numeric = Number(id)
  if (!Number.isInteger(numeric) || numeric === 0) throw notFound()
  return <PartForm mode="edit" id={numeric} />
}
