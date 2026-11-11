import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { getSessionFn } from '../../../../server/auth.functions'
import { PartListScreen } from '../../../../modules/master-data/components/lists'
import { parseListSearch } from '../../../../modules/master-data/lib/search'

export const Route = createFileRoute('/_app/master-data/parts/')({
  validateSearch: (search: Record<string, unknown>) => parseListSearch(search),
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/master-data/parts' } })
    if (!session.user.grants.some((grant) => grant.key === 'inventory:read')) {
      throw redirect({ to: '/' })
    }
    return { session }
  },
  component: PartsPage,
})

function PartsPage() {
  const { q, page } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  return (
    <PartListScreen
      search={q ?? ''}
      page={page ?? 1}
      onSearch={(value) =>
        void navigate({ search: (prev) => ({ ...prev, q: value || undefined, page: 1 }) })
      }
      onPage={(next) => void navigate({ search: (prev) => ({ ...prev, page: next }) })}
    />
  )
}
