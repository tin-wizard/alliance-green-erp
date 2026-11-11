import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../../../../server/auth.functions'
import { MasterPage } from '../../../../modules/tjx/components/master-ui'
import { TjxQuoteNewForm } from '../../../../modules/tjx/components/quote-new'

export const Route = createFileRoute('/_app/tjx/quotes/new')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/tjx/quotes/new' } })
    return { session }
  },
  component: NewQuotePage,
})

function NewQuotePage() {
  return (
    <MasterPage
      eyebrow="TJX program"
      title="New quote"
      description="Start from the default room template. Rooms are copied as snapshots; later template edits never change this quote."
    >
      <TjxQuoteNewForm />
    </MasterPage>
  )
}
