import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../../../../server/auth.functions'
import { SiteForm } from '../../../../modules/master-data/components/forms'

export const Route = createFileRoute('/_app/master-data/sites/new')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/master-data/sites/new' } })
    if (!session.user.grants.some((grant) => grant.key === 'customer:write')) throw redirect({ to: '/' })
    return { session }
  },
  component: () => <SiteForm mode="create" />,
})
