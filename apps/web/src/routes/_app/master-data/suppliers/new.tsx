import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../../../../server/auth.functions'
import { SupplierForm } from '../../../../modules/master-data/components/forms'

export const Route = createFileRoute('/_app/master-data/suppliers/new')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/master-data/suppliers/new' } })
    if (!session.user.grants.some((grant) => grant.key === 'supplier:write')) throw redirect({ to: '/' })
    return { session }
  },
  component: () => <SupplierForm mode="create" />,
})
