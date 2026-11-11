import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { PageHeader } from '../../../../shell/page-header'
import { WorkOrderForm } from '../../../../modules/work-orders/components/work-order-form'
import { getSessionFn } from '../../../../server/auth.functions'

export const Route = createFileRoute('/_app/maintenance/work-orders/new')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) {
      throw redirect({ to: '/login', search: { redirect: '/maintenance/work-orders/new' } })
    }
    if (!session.user.grants.some((grant) => grant.key === 'workorder:create')) {
      throw redirect({ to: '/maintenance/work-orders', search: { view: 'open', sort: 'newest', size: 25 } })
    }
    return { session }
  },
  component: NewMaintenanceWorkOrderPage,
})

function NewMaintenanceWorkOrderPage() {
  const navigate = useNavigate()
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations · Maintenance"
        title="New maintenance work order"
        description="Allocated from the maintenance series. The number is never reused and never collides with a main-series number."
      />
      <div className="mx-auto max-w-[860px]">
        <WorkOrderForm
          mode="create"
          series={2}
          onSaved={(id) => {
            void navigate({
              to: '/maintenance/work-orders/$id',
              params: { id: String(id) },
            })
          }}
        />
      </div>
    </div>
  )
}
