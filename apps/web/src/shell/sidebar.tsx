import { X } from 'lucide-react'
import { APP_VERSION, ROLE_LABELS, type Role } from '@cls/core'
import type { NavGroup } from './navigation'
import { NavLink } from './nav-link'

/**
 * Sidebar: 256px, ink surface, brand block, grouped navigation, user footer.
 * Below 1024px it becomes an off-canvas drawer (design: 288px over a scrim).
 */
export function Sidebar({
  groups,
  user,
  open,
  onClose,
}: {
  groups: NavGroup[]
  user: { displayName: string; role: Role }
  open: boolean
  onClose: () => void
}) {
  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-[var(--surface-overlay)] lg:hidden"
        />
      ) : null}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 flex w-[288px] flex-col bg-[var(--shell-sidebar-bg)] text-[var(--shell-sidebar-fg)] transition-transform',
          'lg:static lg:z-auto lg:w-64 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
        aria-label="Sidebar"
      >
        <div className="flex h-16 items-center gap-2 px-4">
          <div className="flex min-w-0 flex-col">
            <span className="text-[15px] font-semibold tracking-[0.01em] text-white">
              CLS Green System
            </span>
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.22em] text-[var(--shell-sidebar-fg-faint)]">
              Operations
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-[4px] p-1.5 text-fg-inverse-muted hover:bg-white/5 hover:text-white lg:hidden"
            aria-label="Close navigation"
          >
            <X size={18} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Primary" className="flex-1 overflow-y-auto px-2 pb-4">
          {groups.map((group) => (
            <div key={group.label} className="mt-6 first:mt-2">
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--shell-sidebar-fg-faint)]">
                {group.label}
              </p>
              <ul className="space-y-1">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      label={item.label}
                      icon={item.icon}
                      badge={item.badge}
                      onNavigate={onClose}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-[var(--shell-sidebar-border)] p-3">
          <div className="flex items-center gap-2.5 rounded-[4px] px-2 py-1.5">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-[11px] font-semibold text-white"
              aria-hidden="true"
            >
              {initials(user.displayName)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-white">{user.displayName}</p>
              <p className="truncate text-[11px] text-[var(--shell-sidebar-fg-muted)]">{ROLE_LABELS[user.role]}</p>
            </div>
          </div>
          <p className="px-2 pt-2 text-[10.5px] text-[var(--shell-sidebar-fg-faint)]">v{APP_VERSION} · local server</p>
        </div>
      </aside>
    </>
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
