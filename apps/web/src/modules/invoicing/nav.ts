import { FileCheck2, ReceiptText } from 'lucide-react'
import type { ModuleNav } from '../../shell/navigation'

export const nav: ModuleNav[] = [
  {
    group: 'Sales',
    order: 20,
    items: [
      {
        label: 'Invoicing',
        to: '/invoicing',
        icon: ReceiptText,
        permission: 'invoice:read',
      },
      {
        label: 'Subcontractor invoices',
        to: '/invoicing/subcontractor',
        icon: FileCheck2,
        permission: 'invoice:write',
      },
    ],
  },
  {
    group: 'Subcontractor portal',
    order: 40,
    items: [
      {
        label: 'Your invoices',
        to: '/portal/sub/invoices',
        icon: ReceiptText,
        permission: 'invoice:read',
      },
    ],
  },
]
