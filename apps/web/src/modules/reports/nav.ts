import { BarChart3 } from 'lucide-react'
import type { ModuleNav } from '../../shell/navigation'

export const nav: ModuleNav[] = [
  {
    group: 'Reporting',
    order: 60,
    items: [
      {
        label: 'Reports',
        to: '/reports',
        icon: BarChart3,
        permission: 'reports:read',
      },
    ],
  },
]
