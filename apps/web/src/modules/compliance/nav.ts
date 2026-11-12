import { ShieldCheck } from 'lucide-react'
import type { ModuleNav } from '../../shell/navigation'

export const nav: ModuleNav[] = [
  {
    group: 'Operations',
    order: 25,
    items: [
      {
        label: 'Compliance',
        to: '/compliance',
        icon: ShieldCheck,
        permission: 'compliance:read',
      },
    ],
  },
]
