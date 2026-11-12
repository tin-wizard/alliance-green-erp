import {
  LayoutDashboard,
  ScrollText,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { PermissionKey } from '@cls/core'

/**
 * Navigation registry.
 *
 * Modules register themselves by adding `src/modules/<module>/nav.ts` that
 * exports `nav` (single object or array). This file globs them at build time,
 * so parallel module agents never edit a shared array. See ADR 0007.
 */
export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  permission?: PermissionKey
  /** Only counts that need attention, never a total record count. */
  badge?: number
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export interface ModuleNav {
  group: string
  /** Lower sorts first inside the group. */
  order?: number
  items: NavItem[]
}

export const GROUP_ORDER = [
  'Overview',
  'Operations',
  'Supply',
  'Finance',
  'Network',
  'Admin',
] as const

const CORE_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', to: '/', icon: LayoutDashboard }],
  },
  {
    label: 'Admin',
    items: [
      { label: 'Users & roles', to: '/admin/users', icon: Users, permission: 'admin:users' },
      { label: 'Audit log', to: '/admin/audit', icon: ScrollText, permission: 'admin:audit' },
      { label: 'Settings', to: '/admin/settings', icon: Settings, permission: 'admin:settings' },
    ],
  },
]

const discovered = import.meta.glob<{ nav: ModuleNav | ModuleNav[] }>('../modules/*/nav.ts', {
  eager: true,
})

function moduleNavs(): ModuleNav[] {
  const out: ModuleNav[] = []
  for (const mod of Object.values(discovered)) {
    const value = mod.nav
    if (Array.isArray(value)) out.push(...value)
    else out.push(value)
  }
  return out
}

function groupRank(label: string): number {
  const index = GROUP_ORDER.indexOf(label as (typeof GROUP_ORDER)[number])
  return index === -1 ? GROUP_ORDER.length : index
}

export function getNavigation(grantedKeys: readonly string[]): NavGroup[] {
  const requested: ModuleNav[] = [
    ...CORE_GROUPS.map((group) => ({ group: group.label, items: group.items })),
    ...moduleNavs(),
  ]

  const groups = new Map<string, NavItem[]>()
  for (const group of requested) {
    const items = group.items
      .filter((item) => !item.permission || grantedKeys.includes(item.permission))
      .sort((a, b) => a.label.localeCompare(b.label))
    if (items.length === 0) continue
    const existing = groups.get(group.group) ?? []
    groups.set(group.group, [...existing, ...items])
  }

  return [...groups.entries()]
    .map(([label, items]) => ({ label, items }))
    .sort((a, b) => groupRank(a.label) - groupRank(b.label) || a.label.localeCompare(b.label))
}
