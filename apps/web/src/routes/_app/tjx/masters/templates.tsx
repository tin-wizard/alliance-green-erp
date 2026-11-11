import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../../../../server/auth.functions'
import { MasterPage } from '../../../../modules/tjx/components/master-ui'
import { TemplatesPanel } from '../../../../modules/tjx/components/templates-panel'

export const Route = createFileRoute('/_app/tjx/masters/templates')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/tjx/masters/templates' } })
    return { session }
  },
  component: TemplatesPage,
})

function TemplatesPage() {
  return (
    <MasterPage
      eyebrow="TJX masters"
      title="Room templates"
      description="A template is an ordered room list. New quotes copy the default template; later edits never change an existing quote."
    >
      <TemplatesPanel />
    </MasterPage>
  )
}
