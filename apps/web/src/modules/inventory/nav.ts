import { Boxes, ClipboardList, Tags } from 'lucide-react'
import type { ModuleNav } from '../../shell/navigation'

export const nav: ModuleNav[] = [
  {
    group: 'Operations',
    order: 30,
    items: [
      {
        label: 'Inventory',
        to: '/inventory',
        icon: Boxes,
        permission: 'inventory:read',
      },
      {
        label: 'Price editor',
        to: '/inventory/prices',
        icon: Tags,
        permission: 'inventory:read',
      },
      {
        label: 'Stock movements',
        to: '/inventory/movements',
        icon: ClipboardList,
        permission: 'inventory:read',
      },
    ],
  },
]
