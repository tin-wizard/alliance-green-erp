import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../../../../server/auth.functions'
import { MasterPage } from '../../../../modules/tjx/components/master-ui'
import { RatesPanel } from '../../../../modules/tjx/components/rates-panel'

export const Route = createFileRoute('/_app/tjx/masters/rates')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/tjx/masters/rates' } })
    return { session }
  },
  component: RatesPage,
})

function RatesPage() {
  return (
    <MasterPage
      eyebrow="TJX masters"
      title="Subcontractor rates"
      description="The install cost per part for each TJX subcontractor. These rates feed the subcontractor invoice; they never change a part price."
    >
      <RatesPanel />
    </MasterPage>
  )
}
