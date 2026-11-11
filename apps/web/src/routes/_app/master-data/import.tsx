import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../../../server/auth.functions'
import { ImportPanel } from '../../../modules/master-data/components/import-panel'

export const Route = createFileRoute('/_app/master-data/import')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/master-data/import' } })
    if (!session.user.grants.some((grant) => grant.key === 'customer:write')) throw redirect({ to: '/' })
    return { session }
  },
  component: ImportPanel,
})
