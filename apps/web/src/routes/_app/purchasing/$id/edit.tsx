import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ErrorPanel } from '../../../../modules/work-orders/components/ui'
import { PurchaseOrderForm } from '../../../../modules/purchasing/components/purchase-order-form'
import { getPurchaseOrderFn } from '../../../../modules/purchasing/server/purchasing.functions'
import { getSessionFn } from '../../../../server/auth.functions'

export const Route = createFileRoute('/_app/purchasing/$id/edit')({
  beforeLoad: async ({ params }) => {
    const session = await getSessionFn()
    if (!session) {
      throw redirect({ to: '/login', search: { redirect: `/purchasing/${params.id}/edit` } })
    }
    return { session }
  },
  component: EditPurchaseOrderPage,
})

function EditPurchaseOrderPage() {
  const { id } = Route.useParams()
  const query = useQuery({
    queryKey: ['purchase-order', Number(id)],
    queryFn: () => getPurchaseOrderFn({ data: { id: Number(id) } }),
  })
  return (
    <div className="space-y-5">
      <div className="border-b border-hair pb-5 pt-2">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">Purchasing</p>
        <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">
          Edit purchase order {query.data?.displayNumber ?? id}
        </h1>
        <p className="mt-1 max-w-[68ch] text-[13.5px] text-fg-secondary">
          Saving an approved, issued or in-transit order clears its approval and returns it to
          Saved. It must be approved again before issue.
        </p>
      </div>
      {query.error ? <ErrorPanel message={query.error.message} /> : null}
      {query.data ? <PurchaseOrderForm existing={query.data} /> : null}
    </div>
  )
}
