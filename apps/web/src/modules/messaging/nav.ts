import { Mail } from 'lucide-react'
import type { ModuleNav } from '../../shell/navigation'

export const nav: ModuleNav[] = [
  {
    group: 'Admin',
    order: 70,
    items: [
      {
        label: 'Messages',
        to: '/messages',
        icon: Mail,
        permission: 'messages:read',
      },
    ],
  },
]
