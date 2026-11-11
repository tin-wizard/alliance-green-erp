import { createFileRoute, redirect } from '@tanstack/react-router'
import { PurchaseOrderForm } from '../../../modules/purchasing/components/purchase-order-form'
import { getSessionFn } from '../../../server/auth.functions'

export const Route = createFileRoute('/_app/purchasing/new')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/purchasing/new' } })
    return { session }
  },
  component: NewPurchaseOrderPage,
})

function NewPurchaseOrderPage() {
  return (
    <div className="space-y-5">
      <div className="border-b border-hair pb-5 pt-2">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">Purchasing</p>
        <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">
          New purchase order
        </h1>
        <p className="mt-1 max-w-[68ch] text-[13.5px] text-fg-secondary">
          Totals use the purchase tax table for the chosen province. The order starts as Saved and
          needs approval before it can be issued.
        </p>
      </div>
      <PurchaseOrderForm />
    </div>
  )
}
