import { Layers } from 'lucide-react'
import type { ModuleNav } from '../../shell/navigation'

export const nav: ModuleNav = {
  group: 'Sales',
  order: 15,
  items: [{ label: 'TJX program', to: '/tjx', icon: Layers, permission: 'tjx:read' }],
}
