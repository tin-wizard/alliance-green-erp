import { useState } from 'react'
import { createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { loginFn, getSessionFn } from '../server/auth.functions'
import { APP_VERSION } from '@cls/core'

export interface LoginSearch {
  redirect?: string
}

function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (!value.startsWith('/') || value.startsWith('//')) return undefined
  return value
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: safeRedirect(search.redirect),
  }),
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (session) throw redirect({ to: '/' })
  },
  component: LoginPage,
})

function LoginPage() {
  const { redirect: redirectTo } = Route.useSearch()
  const router = useRouter()
  const navigate = useNavigate()
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm({
    defaultValues: { identifier: '', password: '' },
    onSubmit: async ({ value }) => {
      setFormError(null)
      try {
        await loginFn({ data: value })
        await router.invalidate()
        await navigate({ to: (redirectTo ?? '/') as '/' })
      } catch (error) {
        setFormError(
          error instanceof Error && error.message
            ? error.message
            : 'Sign-in failed. Check your username and password.',
        )
      }
    },
  })

  return (
    <div className="flex min-h-screen bg-app">
      <div className="hidden w-[44%] max-w-[560px] flex-col justify-between bg-[var(--shell-sidebar-bg)] px-12 py-10 lg:flex">
        <div>
          <p className="text-[15px] font-semibold tracking-[0.01em] text-white">
            CLS Green System
          </p>
          <p className="mt-1 text-[9.5px] font-semibold uppercase tracking-[0.22em] text-[var(--shell-sidebar-fg-faint)]">
            Operations
          </p>
        </div>
        <div>
          <p className="max-w-[30ch] font-serif text-[40px] leading-[1.1] text-white">
            Work orders, quotes, purchasing and invoicing in one place.
          </p>
          <p className="mt-5 max-w-[42ch] text-[14px] leading-relaxed text-[var(--shell-sidebar-fg-muted)]">
            The replacement for the Alliance Lighting workorder system.
          </p>
        </div>
        <p className="text-[11px] text-[var(--shell-sidebar-fg-faint)]">v{APP_VERSION} · Alliance Lighting</p>
      </div>

      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[380px]">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">
            Sign in
          </p>
          <h1 className="mt-1 font-serif text-[32px] leading-tight text-fg">Welcome back</h1>
          <p className="mt-2 text-[13px] text-fg-secondary">
            Use the account your administrator created. Sessions end after 12 hours.
          </p>

          <form
            className="mt-8 space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void form.handleSubmit()
            }}
          >
            <form.Field
              name="identifier"
              children={(field) => (
                <div>
                  <label
                    htmlFor={field.name}
                    className="mb-1.5 block text-[12px] font-medium text-fg-secondary"
                  >
                    Username or email
                  </label>
                  <input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    className="h-11 w-full rounded-[4px] border border-strong bg-canvas px-3 text-[14px] text-fg placeholder:text-fg-faint focus:border-brand focus:outline-none focus:ring-4 focus:ring-[var(--focus-halo)]"
                    placeholder="jdoe"
                  />
                </div>
              )}
            />

            <form.Field
              name="password"
              children={(field) => (
                <div>
                  <label
                    htmlFor={field.name}
                    className="mb-1.5 block text-[12px] font-medium text-fg-secondary"
                  >
                    Password
                  </label>
                  <input
                    id={field.name}
                    name={field.name}
                    type="password"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    autoComplete="current-password"
                    className="h-11 w-full rounded-[4px] border border-strong bg-canvas px-3 text-[14px] text-fg focus:border-brand focus:outline-none focus:ring-4 focus:ring-[var(--focus-halo)]"
                  />
                </div>
              )}
            />

            {formError ? (
              <p
                role="alert"
                className="rounded-[4px] border border-[var(--status-rejected-bd)] bg-[var(--status-rejected-bg)] px-3 py-2 text-[12px] text-[var(--status-rejected-fg)]"
              >
                {formError}
              </p>
            ) : null}

            <form.Subscribe
              selector={(state) => state.isSubmitting}
              children={(isSubmitting) => (
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-11 w-full rounded-[4px] bg-accent text-[13px] font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-wait disabled:opacity-70"
                >
                  {isSubmitting ? 'Signing in…' : 'Sign in'}
                </button>
              )}
            />
          </form>

          <p className="mt-6 text-[11.5px] leading-relaxed text-fg-muted">
            Use your email or legacy username. No account yet? Ask an administrator. Identities and
            password resets are managed in Neon Auth; roles and permissions are managed in
            <span className="font-medium text-fg-secondary"> Admin → Users &amp; roles</span>.
          </p>
        </div>
      </main>
    </div>
  )
}
