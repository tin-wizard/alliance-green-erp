import { Users, MapPin, HardHat, Truck, Package } from 'lucide-react'
import type { ModuleNav } from '../../shell/navigation'

/**
 * Master Data navigation. Supply holds billing/site and catalogue records;
 * Network holds the vendors work orders draw from. Every entry is gated by the
 * read key its screens already enforce.
 */
export const nav: ModuleNav[] = [
  {
    group: 'Supply',
    order: 10,
    items: [
      { label: 'Customers', to: '/master-data/customers', icon: Users, permission: 'customer:read' },
      { label: 'Sites', to: '/master-data/sites', icon: MapPin, permission: 'customer:read' },
      { label: 'Parts catalogue', to: '/master-data/parts', icon: Package, permission: 'inventory:read' },
      { label: 'Sage reconciliation', to: '/master-data/import', icon: Truck, permission: 'customer:write' },
    ],
  },
  {
    group: 'Network',
    order: 10,
    items: [
      {
        label: 'Subcontractors',
        to: '/master-data/subcontractors',
        icon: HardHat,
        permission: 'subcontractor:read',
      },
      { label: 'Suppliers', to: '/master-data/suppliers', icon: Truck, permission: 'supplier:read' },
    ],
  },
]
