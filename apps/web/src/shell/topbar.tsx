import { useState } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { LogOut, Menu, Search } from 'lucide-react'
import { ROLE_LABELS, type Role } from '@cls/core'
import { logoutFn } from '../server/auth.functions'

/**
 * Top bar: 60px, sticky, search trigger, user menu. Search/palette and
 * notifications arrive with the first module; the controls are rendered as
 * disabled so they cannot pretend to work.
 */
export function TopBar({
  user,
  onOpenNav,
}: {
  user: { displayName: string; role: Role }
  onOpenNav: () => void
}) {
  const router = useRouter()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  async function signOut() {
    setBusy(true)
    try {
      await logoutFn()
      await router.invalidate()
      await navigate({ to: '/login' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <header className="sticky top-0 z-20 flex h-[60px] items-center gap-3 border-b border-hair bg-canvas px-4 lg:px-8">
      <button
        type="button"
        onClick={onOpenNav}
        className="rounded-[4px] p-2 text-fg-secondary hover:bg-muted lg:hidden"
        aria-label="Open navigation"
      >
        <Menu size={20} strokeWidth={1.5} aria-hidden="true" />
      </button>

      <button
        type="button"
        disabled
        title="The command palette arrives with the Work Orders module"
        className="flex h-9 w-full max-w-[420px] items-center gap-2 rounded-[4px] border border-hair bg-subtle px-3 text-left text-[13px] text-fg-muted disabled:cursor-not-allowed"
      >
        <Search size={16} strokeWidth={1.5} aria-hidden="true" />
        <span className="truncate">Search work orders, quotes, parts…</span>
        <kbd className="ml-auto hidden rounded-[2px] border border-hair bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-fg-muted sm:inline">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-3">
        <span className="hidden rounded-[2px] border border-hair px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-muted sm:inline">
          {ROLE_LABELS[user.role]}
        </span>
        <div className="flex items-center gap-2">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-fg-secondary"
            aria-hidden="true"
          >
            {initials(user.displayName)}
          </span>
          <span className="hidden text-[13px] font-medium text-fg md:inline">{user.displayName}</span>
        </div>
        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          className="flex h-8 items-center gap-1.5 rounded-[4px] border border-hair px-2.5 text-[12px] font-medium text-fg-secondary hover:bg-subtle disabled:opacity-60"
        >
          <LogOut size={14} strokeWidth={1.5} aria-hidden="true" />
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </header>
  )
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}
