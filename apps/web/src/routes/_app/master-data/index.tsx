import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../../../server/auth.functions'

export const Route = createFileRoute('/_app/master-data/')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/master-data/customers' } })
    const keys = session.user.grants.map((grant) => grant.key)
    if (keys.includes('customer:read')) throw redirect({ to: '/master-data/customers' })
    if (keys.includes('subcontractor:read')) throw redirect({ to: '/master-data/subcontractors' })
    if (keys.includes('supplier:read')) throw redirect({ to: '/master-data/suppliers' })
    if (keys.includes('inventory:read')) throw redirect({ to: '/master-data/parts' })
    throw redirect({ to: '/' })
  },
  component: () => null,
})
