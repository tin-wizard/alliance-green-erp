import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { QuoteDetailScreen } from '../../../../modules/quotes/components/quote-detail'
import { getSessionFn } from '../../../../server/auth.functions'

export const Route = createFileRoute('/_app/quotes/$id/')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/quotes' } })
    return { session }
  },
  component: QuoteDetailPage,
})

function QuoteDetailPage() {
  const { id } = Route.useParams()
  const numeric = Number(id)
  if (!Number.isInteger(numeric) || numeric <= 0) throw notFound()
  return <QuoteDetailScreen id={numeric} />
}
