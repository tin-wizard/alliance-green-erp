import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../../../../server/auth.functions'
import { SubcontractorForm } from '../../../../modules/master-data/components/forms'

export const Route = createFileRoute('/_app/master-data/subcontractors/new')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/master-data/subcontractors/new' } })
    if (!session.user.grants.some((grant) => grant.key === 'subcontractor:write')) throw redirect({ to: '/' })
    return { session }
  },
  component: () => <SubcontractorForm mode="create" />,
})
