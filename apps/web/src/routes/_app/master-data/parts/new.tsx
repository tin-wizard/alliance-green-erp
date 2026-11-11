import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../../../../server/auth.functions'
import { PartForm } from '../../../../modules/master-data/components/forms'

export const Route = createFileRoute('/_app/master-data/parts/new')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/master-data/parts/new' } })
    if (!session.user.grants.some((grant) => grant.key === 'inventory:write')) throw redirect({ to: '/' })
    return { session }
  },
  component: () => <PartForm mode="create" />,
})
