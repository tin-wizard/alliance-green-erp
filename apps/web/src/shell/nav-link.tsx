import { Link } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'

export function NavLink({
  to,
  label,
  icon: Icon,
  badge,
  onNavigate,
}: {
  to: string
  label: string
  icon: LucideIcon
  badge?: number
  onNavigate?: () => void
}) {
  return (
    <Link
      // The registry is data-driven, so the concrete route union is not known
      // here. Route existence is guaranteed by the module's file routes.
      to={to as '/'}
      onClick={onNavigate}
      activeOptions={{ exact: to === '/' }}
      className="group flex h-9 items-center gap-2.5 rounded-[4px] px-3 text-[13px] font-medium text-[var(--shell-sidebar-fg-muted)] transition-colors hover:bg-[var(--shell-sidebar-hover)] hover:text-[var(--shell-sidebar-fg)]"
      activeProps={{
        className:
          'bg-[var(--shell-sidebar-active-bg)] text-[var(--shell-sidebar-active-fg)] shadow-[inset_2px_0_0_0_var(--shell-sidebar-active-inset)]',
      }}
    >
      <Icon size={18} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{label}</span>
      {badge !== undefined && badge > 0 ? (
        <span className="nav-badge ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[2px] bg-white/20 px-1 text-2xs font-semibold text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </Link>
  )
}
