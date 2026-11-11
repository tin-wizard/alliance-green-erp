import { createFileRoute, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { EmptyState, ErrorPanel, formatMoney } from '../../../../modules/work-orders/components/ui'
import { supplierPortalListFn } from '../../../../modules/purchasing/server/purchasing.functions'
import { getSessionFn } from '../../../../server/auth.functions'

export const Route = createFileRoute('/_app/portal/supplier/')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/portal/supplier' } })
    if (session.user.role !== 'supplier') throw redirect({ to: '/' })
    return { session }
  },
  component: SupplierPortalPage,
})

function SupplierPortalPage() {
  const query = useQuery({
    queryKey: ['supplier-portal'],
    queryFn: () => supplierPortalListFn({ data: {} }),
  })

  return (
    <div className="space-y-5">
      <div className="border-b border-hair pb-5 pt-2">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">Supplier portal</p>
        <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">Your purchasing</h1>
        <p className="mt-1 max-w-[68ch] text-[13.5px] text-fg-secondary">
          Only purchase orders and RFQs sent to your supplier account appear here.
        </p>
      </div>
      {query.error ? <ErrorPanel message={query.error.message} /> : null}
      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold text-fg">Purchase orders</h2>
        {query.data && query.data.purchaseOrders.length === 0 ? (
          <EmptyState title="No purchase orders" description="Issued orders will appear here." />
        ) : null}
        <ul className="space-y-2">
          {(query.data?.purchaseOrders ?? []).map((po) => (
            <li key={po.id} className="rounded-[4px] border border-hair bg-surface p-3 text-[13px]">
              <Link to="/purchasing/$id" params={{ id: String(po.id) }} className="font-medium text-brand">
                PO {po.displayNumber}
              </Link>
              <span className="ml-3 text-fg-secondary">{formatMoney(po.total)}</span>
              <span className="ml-3 text-fg-muted">status {po.status}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2">
        <h2 className="text-[13px] font-semibold text-fg">RFQs</h2>
        {query.data && query.data.rfqs.length === 0 ? (
          <EmptyState title="No RFQs" description="Requests for quotation sent to you will appear here." />
        ) : null}
        <ul className="space-y-2">
          {(query.data?.rfqs ?? []).map((rfq) => (
            <li key={rfq.rfqId} className="rounded-[4px] border border-hair bg-surface p-3 text-[13px]">
              RFQ {rfq.rfqId}
              <span className="ml-3 text-fg-muted">status {rfq.status}</span>
              <span className="ml-3 text-fg-muted">your response: {rfq.responseStatus}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
