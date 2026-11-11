import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { getSessionFn } from '../../../../server/auth.functions'
import { SiteListScreen } from '../../../../modules/master-data/components/lists'
import { parseSiteListSearch } from '../../../../modules/master-data/lib/search'

export const Route = createFileRoute('/_app/master-data/sites/')({
  validateSearch: (search: Record<string, unknown>) => parseSiteListSearch(search),
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/master-data/sites' } })
    if (!session.user.grants.some((grant) => grant.key === 'customer:read')) {
      throw redirect({ to: '/' })
    }
    return { session }
  },
  component: SitesPage,
})

function SitesPage() {
  const { q, page, parent } = Route.useSearch()
  const { session } = Route.useRouteContext()
  const canWrite = session.user.grants.some((grant) => grant.key === 'customer:write')
  const navigate = useNavigate({ from: Route.fullPath })
  return (
    <SiteListScreen
      search={q ?? ''}
      page={page ?? 1}
      parent={parent ?? 'all'}
      onSearch={(value) =>
        void navigate({ search: (prev) => ({ ...prev, q: value || undefined, page: 1 }) })
      }
      onParent={(value) =>
        void navigate({ search: (prev) => ({ ...prev, parent: value, page: 1 }) })
      }
      onPage={(next) => void navigate({ search: (prev) => ({ ...prev, page: next }) })}
      canWrite={canWrite}
    />
  )
}
