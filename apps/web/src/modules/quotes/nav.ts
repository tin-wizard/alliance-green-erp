import { FileText } from 'lucide-react'
import type { ModuleNav } from '../../shell/navigation'

export const nav: ModuleNav[] = [
  {
    group: 'Sales',
    order: 10,
    items: [
      {
        label: 'Quotes',
        to: '/quotes',
        icon: FileText,
        permission: 'quote:read',
      },
    ],
  },
]
