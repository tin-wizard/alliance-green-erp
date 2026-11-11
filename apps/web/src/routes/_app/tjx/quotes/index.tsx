import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../../../../server/auth.functions'
import { MasterPage } from '../../../../modules/tjx/components/master-ui'
import { QuotesList } from '../../../../modules/tjx/components/quotes-list'

export const Route = createFileRoute('/_app/tjx/quotes/')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/tjx/quotes' } })
    return { session }
  },
  component: QuotesPage,
})

function QuotesPage() {
  return (
    <MasterPage
      eyebrow="TJX program"
      title="Quotes"
      description="Create a quote from the default room template, then price it per room, fixture and part. Both money triplets are calculated on the server."
    >
      <QuotesList />
    </MasterPage>
  )
}
