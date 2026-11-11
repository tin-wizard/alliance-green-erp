import { PackageX } from 'lucide-react'
import type { ModuleNav } from '../../shell/navigation'

export const nav: ModuleNav = {
  group: 'Supply',
  order: 40,
  items: [
    { label: 'RGAs & warranties', to: '/rgas', icon: PackageX, permission: 'rga:read' },
  ],
}
