import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { getTjxSubInvoiceFn } from '../../../../modules/tjx/server/subinvoices.functions'
import { TjxSubInvoiceScreen } from '../../../../modules/tjx/components/sub-invoice-editor'
import { ErrorNote } from '../../../../modules/tjx/components/master-ui'
import { getSessionFn } from '../../../../server/auth.functions'

export const Route = createFileRoute('/_app/tjx/invoices/$workOrderId')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/tjx/invoices' } })
    if (!session.user.grants.some((grant) => grant.key === 'tjx:read')) {
      throw redirect({ to: '/' })
    }
    return { session }
  },
  component: TjxInvoiceReviewPage,
})

function TjxInvoiceReviewPage() {
  const { workOrderId } = Route.useParams()
  const numeric = Number(workOrderId)
  if (!Number.isInteger(numeric) || numeric <= 0) throw notFound()
  const query = useQuery({
    queryKey: ['tjx', 'sub-invoice', numeric],
    queryFn: () => getTjxSubInvoiceFn({ data: { workOrderId: numeric } }),
  })
  if (query.isError) return <ErrorNote message={query.error.message} />
  if (query.isPending) return <p className="text-[13px] text-fg-muted">Loading TJX invoice…</p>
  return <TjxSubInvoiceScreen invoice={query.data} office />
}
