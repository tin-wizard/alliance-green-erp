import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../../../../server/auth.functions'
import { FixturesPanel } from '../../../../modules/tjx/components/fixtures-panel'
import { MasterPage } from '../../../../modules/tjx/components/master-ui'

export const Route = createFileRoute('/_app/tjx/masters/fixtures')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/tjx/masters/fixtures' } })
    return { session }
  },
  component: FixturesPage,
})

function FixturesPage() {
  return (
    <MasterPage
      eyebrow="TJX masters"
      title="Fixtures & parts"
      description="Each fixture carries the parts installed per unit, with a markup and a ratio per fixture. A quote copies these values when the fixture is selected."
    >
      <FixturesPanel />
    </MasterPage>
  )
}
