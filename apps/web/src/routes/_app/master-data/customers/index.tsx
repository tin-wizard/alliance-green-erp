import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { getSessionFn } from '../../../../server/auth.functions'
import { CustomerListScreen } from '../../../../modules/master-data/components/lists'
import { parseListSearch } from '../../../../modules/master-data/lib/search'

export const Route = createFileRoute('/_app/master-data/customers/')({
  validateSearch: (search: Record<string, unknown>) => parseListSearch(search),
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/master-data/customers' } })
    if (!session.user.grants.some((grant) => grant.key === 'customer:read')) {
      throw redirect({ to: '/' })
    }
    return { session }
  },
  component: CustomersPage,
})

function CustomersPage() {
  const { q, page } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  return (
    <CustomerListScreen
      search={q ?? ''}
      page={page ?? 1}
      onSearch={(value) =>
        void navigate({ search: (prev) => ({ ...prev, q: value || undefined, page: 1 }) })
      }
      onPage={(next) => void navigate({ search: (prev) => ({ ...prev, page: next }) })}
    />
  )
}
