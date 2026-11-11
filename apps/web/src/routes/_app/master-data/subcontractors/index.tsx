import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { getSessionFn } from '../../../../server/auth.functions'
import { SubcontractorListScreen } from '../../../../modules/master-data/components/lists'
import { parseSubcontractorListSearch } from '../../../../modules/master-data/lib/search'

export const Route = createFileRoute('/_app/master-data/subcontractors/')({
  validateSearch: (search: Record<string, unknown>) => parseSubcontractorListSearch(search),
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/master-data/subcontractors' } })
    if (!session.user.grants.some((grant) => grant.key === 'subcontractor:read')) {
      throw redirect({ to: '/' })
    }
    return { session }
  },
  component: SubcontractorsPage,
})

function SubcontractorsPage() {
  const { q, page, wsib } = Route.useSearch()
  const { session } = Route.useRouteContext()
  const canWrite = session.user.grants.some((grant) => grant.key === 'subcontractor:write')
  const navigate = useNavigate({ from: Route.fullPath })
  return (
    <SubcontractorListScreen
      search={q ?? ''}
      page={page ?? 1}
      wsib={wsib ?? 'all'}
      onSearch={(value) =>
        void navigate({ search: (prev) => ({ ...prev, q: value || undefined, page: 1 }) })
      }
      onWsib={(value) => void navigate({ search: (prev) => ({ ...prev, wsib: value, page: 1 }) })}
      onPage={(next) => void navigate({ search: (prev) => ({ ...prev, page: next }) })}
      canWrite={canWrite}
    />
  )
}
