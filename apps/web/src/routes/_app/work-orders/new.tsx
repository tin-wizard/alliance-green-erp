import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { PageHeader } from '../../../shell/page-header'
import { WorkOrderForm } from '../../../modules/work-orders/components/work-order-form'
import { getSessionFn } from '../../../server/auth.functions'

export const Route = createFileRoute('/_app/work-orders/new')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/work-orders/new' } })
    if (!session.user.grants.some((grant) => grant.key === 'workorder:create')) {
      throw redirect({ to: '/work-orders', search: { view: 'open', sort: 'newest', size: 25 } })
    }
    return { session }
  },
  component: NewWorkOrderPage,
})

function NewWorkOrderPage() {
  const navigate = useNavigate()
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations · Work orders"
        title="New work order"
        description="The number is allocated on the server from the work-order series. Site, service type and priority come from master data."
      />
      <div className="mx-auto max-w-[860px]">
        <WorkOrderForm
          mode="create"
          series={1}
          onSaved={(id) => {
            void navigate({ to: '/work-orders/$id', params: { id: String(id) } })
          }}
        />
      </div>
    </div>
  )
}
