import { createFileRoute, redirect } from '@tanstack/react-router'
import { QuoteForm } from '../../../modules/quotes/components/quote-form'
import { getSessionFn } from '../../../server/auth.functions'

export const Route = createFileRoute('/_app/quotes/new')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/quotes' } })
    if (!session.user.grants.some((grant) => grant.key === 'quote:write')) {
      throw redirect({ to: '/quotes', search: { kind: 'all', status: null, q: '', size: 25, cursor: null } })
    }
    return { session }
  },
  component: NewQuotePage,
})

function NewQuotePage() {
  return <QuoteForm mode="create" />
}
