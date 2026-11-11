import type { ReactNode } from 'react'
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import appCss from '../styles/app.css?url'
import type { RouterContext } from '../router'

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'CLS Green System' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
  errorComponent: RootError,
  notFoundComponent: NotFound,
})

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext()
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  )
}

function RootError({ error, reset }: { error: unknown; reset: () => void }) {
  const message =
    error instanceof Error && error.message ? error.message : 'An unexpected error occurred.'
  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">
        Application error
      </p>
      <h1 className="mt-1 font-serif text-[32px] text-fg">Something went wrong</h1>
      <p className="mt-3 text-[14px] text-fg-secondary">
        {message}
      </p>
      <p className="mt-2 text-[12px] text-fg-muted">
        If this mentions the database, check <code className="font-mono">/api/health</code> and the
        server log. The error has been logged with a stack trace.
      </p>
      <div className="mt-6">
        <button
          type="button"
          onClick={reset}
          className="h-11 rounded-[4px] bg-accent px-4 text-[13px] font-semibold text-accent-fg hover:bg-accent-hover"
        >
          Try again
        </button>
      </div>
    </div>
  )
}

function NotFound() {
  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">404</p>
      <h1 className="mt-1 font-serif text-[32px] text-fg">Page not found</h1>
      <p className="mt-3 text-[14px] text-fg-secondary">
        This route does not exist, or the module that owns it has not been built yet.
      </p>
      <a href="/" className="mt-6 text-[13px] font-medium text-brand underline underline-offset-4">
        Back to the dashboard
      </a>
    </div>
  )
}
