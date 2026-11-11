import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { getSessionFn } from '../../../../server/auth.functions'
import { getTjxQuoteFn } from '../../../../modules/tjx/server/quotes.functions'
import { MasterPage } from '../../../../modules/tjx/components/master-ui'
import { TjxQuoteEditor } from '../../../../modules/tjx/components/quote-editor'
import { ErrorPanel } from '../../../../modules/work-orders/components/ui'

export const Route = createFileRoute('/_app/tjx/quotes/$id')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/tjx/quotes' } })
    return { session }
  },
  component: QuoteDetailPage,
})

function QuoteDetailPage() {
  const { id } = Route.useParams()
  const quoteId = Number(id)
  const quote = useQuery({
    queryKey: ['tjx', 'quote', quoteId],
    queryFn: () => getTjxQuoteFn({ data: { id: quoteId } }),
    enabled: Number.isInteger(quoteId) && quoteId > 0,
  })

  return (
    <MasterPage
      eyebrow="TJX program"
      title={`TJX-${id}`}
      description="Edit the header, rooms, fixtures, part markup and prices. Totals are recalculated on every save; revisions keep the full snapshot."
      actions={
        <Link to="/tjx/quotes" className="text-[12.5px] text-brand hover:underline">
          Back to quotes
        </Link>
      }
    >
      {quote.isPending ? (
        <div className="h-[320px] animate-pulse rounded-[6px] border border-hair bg-subtle" />
      ) : quote.isError ? (
        <ErrorPanel message={quote.error.message} retry={() => void quote.refetch()} />
      ) : quote.data ? (
        <TjxQuoteEditor key={`${quote.data.id}-${quote.data.updatedAt}`} quote={quote.data} />
      ) : null}
    </MasterPage>
  )
}
