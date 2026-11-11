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
      className="group flex h-9 items-center gap-2.5 rounded-[4px] px-3 text-[13px] font-medium text-fg-inverse-muted transition-colors hover:bg-white/5 hover:text-fg-inverse"
      activeProps={{
        className:
          'bg-white/[0.07] text-white shadow-[inset_2px_0_0_0_var(--action-primary-bg)]',
      }}
    >
      <Icon size={18} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{label}</span>
      {badge !== undefined && badge > 0 ? (
        <span className="ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[2px] bg-[rgb(203_10_11_/_18%)] px-1 text-2xs font-semibold text-[#f19a97]">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </Link>
  )
}
