import { ClipboardList, Wrench } from 'lucide-react'
import type { ModuleNav } from '../../shell/navigation'

/**
 * Work Orders navigation. The registry globs this file; no shared edit needed.
 * Both entries point at real route files, and both are permission-gated.
 */
export const nav: ModuleNav[] = [
  {
    group: 'Operations',
    order: 10,
    items: [
      {
        label: 'Work orders',
        to: '/work-orders',
        icon: ClipboardList,
        permission: 'workorder:read',
      },
    ],
  },
  {
    group: 'Operations',
    order: 20,
    items: [
      {
        label: 'Maintenance',
        to: '/maintenance/work-orders',
        icon: Wrench,
        permission: 'workorder:read',
      },
    ],
  },
]
