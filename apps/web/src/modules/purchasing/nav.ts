import { ShoppingCart } from 'lucide-react'
import type { ModuleNav } from '../../shell/navigation'

export const nav: ModuleNav[] = [
  {
    group: 'Operations',
    order: 20,
    items: [
      {
        label: 'Purchasing',
        to: '/purchasing',
        icon: ShoppingCart,
        permission: 'purchasing:read',
      },
    ],
  },
]
