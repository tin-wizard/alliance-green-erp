import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../../../../server/auth.functions'
import { MasterPage } from '../../../../modules/tjx/components/master-ui'
import { RoomsPanel } from '../../../../modules/tjx/components/rooms-panel'

export const Route = createFileRoute('/_app/tjx/masters/rooms')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/tjx/masters/rooms' } })
    return { session }
  },
  component: RoomsPage,
})

function RoomsPage() {
  return (
    <MasterPage
      eyebrow="TJX masters"
      title="Rooms"
      description="The physical spaces a TJX quote is divided into. Templates choose which rooms appear by default."
    >
      <RoomsPanel />
    </MasterPage>
  )
}
