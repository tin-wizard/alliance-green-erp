import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { QuoteList } from '../../../modules/quotes/components/quote-list'
import { parseQuoteSearch } from '../../../modules/quotes/lib/list-search'
import { getSessionFn } from '../../../server/auth.functions'

export const Route = createFileRoute('/_app/quotes/')({
  validateSearch: parseQuoteSearch,
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/quotes' } })
    return { session }
  },
  component: QuotesPage,
})

function QuotesPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hair pb-5 pt-2">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">
            Sales
          </p>
          <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">Quotes</h1>
          <p className="mt-1 max-w-[68ch] text-[13.5px] text-fg-secondary">
            Customer and standalone quotes. Approving a quote reserves its work-order number;
            converting creates the work order through the Work Orders module.
          </p>
        </div>
        <Link
          to="/quotes/new"
          className="inline-flex h-9 items-center gap-1.5 rounded-[4px] border border-[var(--action-primary-bg)] bg-[var(--action-primary-bg)] px-3.5 text-[13px] font-medium text-[var(--action-primary-fg)]"
        >
          <Plus size={14} aria-hidden="true" /> New quote
        </Link>
      </div>
      <QuoteList search={search} onSearch={(next) => navigate({ search: next })} />
    </div>
  )
}
