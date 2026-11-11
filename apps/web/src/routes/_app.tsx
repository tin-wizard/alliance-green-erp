import { useState } from 'react'
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { getSessionFn } from '../server/auth.functions'
import { Sidebar } from '../shell/sidebar'
import { TopBar } from '../shell/topbar'
import { getNavigation } from '../shell/navigation'

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => {
    // UX guard only. Every server function enforces its own permission; see
    // packages/auth/src/middleware.ts and docs/adr/0004.
    const session = await getSessionFn()
    if (!session) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
    return { session }
  },
  component: AppLayout,
})

function AppLayout() {
  const { session } = Route.useRouteContext()
  const [navOpen, setNavOpen] = useState(false)
  const groups = getNavigation(session.user.grants.map((grant) => grant.key))

  return (
    <div className="flex min-h-screen bg-app">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-[4px] focus:bg-canvas focus:px-3 focus:py-2 focus:text-[13px] focus:font-medium"
      >
        Skip to content
      </a>

      <Sidebar
        groups={groups}
        user={{ displayName: session.user.displayName, role: session.user.role }}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          user={{ displayName: session.user.displayName, role: session.user.role }}
          onOpenNav={() => setNavOpen(true)}
        />
        <main id="main" className="flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
