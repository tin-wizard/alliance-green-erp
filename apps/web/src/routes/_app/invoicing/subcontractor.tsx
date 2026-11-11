import { createFileRoute, redirect } from '@tanstack/react-router'
import { SubInvoiceReview } from '../../../modules/invoicing/components/sub-invoice-review'
import { getSessionFn } from '../../../server/auth.functions'

export const Route = createFileRoute('/_app/invoicing/subcontractor')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/invoicing/subcontractor' } })
    if (!session.user.grants.some((grant) => grant.key === 'invoice:write')) {
      throw redirect({ to: '/invoicing' })
    }
    return { session }
  },
  component: SubInvoiceReviewPage,
})

function SubInvoiceReviewPage() {
  return <SubInvoiceReview />
}
