/**
 * Platform vocabulary: permissions and default role grants.
 *
 * Lives in `@cls/core` so both the auth package (evaluation) and the database
 * seed (catalogue) can import it without creating a cycle.
 *
 * Adding a permission:
 *   1. add an entry here with the roles that get it by default,
 *   2. run `pnpm db:seed` to upsert `permission_definitions` + `role_permissions`,
 *   3. guard the server function with `requirePermission('<key>')`.
 */

export type Role = 'admin' | 'technician' | 'subcontractor' | 'supplier'

export const ROLES: readonly Role[] = ['admin', 'technician', 'subcontractor', 'supplier']

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrator',
  technician: 'Technician',
  subcontractor: 'Subcontractor',
  supplier: 'Supplier',
}

export interface PermissionDefinition {
  key: string
  module: string
  label: string
  description: string
  defaultRoles: readonly Role[]
}

export const PERMISSIONS = [
  {
    key: 'workorder:read',
    module: 'workorder',
    label: 'View work orders',
    description: 'See work order lists and details, including revisions and parts.',
    defaultRoles: ['admin', 'technician', 'subcontractor'],
  },
  {
    key: 'workorder:write',
    module: 'workorder',
    label: 'Edit work orders',
    description: 'Create and change work orders, revisions, hours and parts.',
    defaultRoles: ['admin', 'technician'],
  },
  {
    key: 'workorder:approve',
    module: 'workorder',
    label: 'Approve work orders',
    description: 'Move a work order through approval and sign-off transitions.',
    defaultRoles: ['admin'],
  },
  {
    key: 'workorder:override_wsib_hold',
    module: 'workorder',
    label: 'Override WSIB/insurance hold',
    description:
      'Process a work order for a subcontractor whose WSIB or insurance document has lapsed. Mirrors the legacy user_permissions_without_wsib_insurance table.',
    defaultRoles: ['admin'],
  },
  {
    key: 'quote:read',
    module: 'quote',
    label: 'View quotes',
    description: 'See customer, subcontractor, standalone and TJX quotes.',
    defaultRoles: ['admin', 'technician', 'subcontractor'],
  },
  {
    key: 'quote:write',
    module: 'quote',
    label: 'Edit quotes',
    description: 'Create and change quotes and their line items.',
    defaultRoles: ['admin', 'technician'],
  },
  {
    key: 'quote:approve',
    module: 'quote',
    label: 'Approve quotes',
    description: 'Approve or reject a quote for sending.',
    defaultRoles: ['admin'],
  },
  {
    key: 'purchasing:read',
    module: 'purchasing',
    label: 'View purchasing',
    description: 'See purchase orders, receipts, RGAs and supplier records.',
    defaultRoles: ['admin', 'technician', 'supplier'],
  },
  {
    key: 'purchasing:write',
    module: 'purchasing',
    label: 'Edit purchasing',
    description: 'Create and change purchase orders, receipts and RGAs.',
    defaultRoles: ['admin', 'technician'],
  },
  {
    key: 'purchasing:approve',
    module: 'purchasing',
    label: 'Approve purchase orders',
    description: 'Approve purchase orders before they are sent to a supplier.',
    defaultRoles: ['admin'],
  },
  {
    key: 'po.approve',
    module: 'purchasing',
    label: 'Approve a purchase order',
    description:
      'Reserved for the purchasing module: approve a specific PO. Replaces the legacy per-username PO approval checks.',
    defaultRoles: [],
  },
  {
    key: 'po.issue',
    module: 'purchasing',
    label: 'Issue a purchase order',
    description:
      'Reserved for the purchasing module: issue a PO to a supplier. Replaces the legacy per-username PO issue checks.',
    defaultRoles: [],
  },
  {
    key: 'inventory:read',
    module: 'inventory',
    label: 'View inventory',
    description: 'See parts, stock levels, price history and movements.',
    defaultRoles: ['admin', 'technician', 'supplier'],
  },
  {
    key: 'inventory:write',
    module: 'inventory',
    label: 'Edit inventory',
    description: 'Create and change parts, prices and reorder points.',
    defaultRoles: ['admin'],
  },
  {
    key: 'inventory:adjust',
    module: 'inventory',
    label: 'Adjust stock',
    description: 'Post stock adjustments and corrections.',
    defaultRoles: ['admin'],
  },
  {
    key: 'inventory:edit_price',
    module: 'inventory',
    label: 'Edit part prices',
    description:
      'Change selling prices in the parts price editor. Mirrors the legacy user_permissions_price_management grant table.',
    defaultRoles: ['admin'],
  },
  {
    key: 'invoice:read',
    module: 'invoice',
    label: 'View invoices',
    description: 'See subcontractor, PO and project invoices.',
    defaultRoles: ['admin', 'technician', 'subcontractor'],
  },
  {
    key: 'invoice:write',
    module: 'invoice',
    label: 'Edit invoices',
    description: 'Create and change invoices and invoice lines.',
    defaultRoles: ['admin'],
  },
  {
    key: 'invoice:issue',
    module: 'invoice',
    label: 'Issue invoices',
    description: 'Finalise and issue an invoice to the customer or Sage.',
    defaultRoles: ['admin'],
  },
  {
    key: 'invoice.calculate',
    module: 'invoice',
    label: 'Calculate invoice amounts',
    description:
      'Run the invoice calculator that computes billable lines, rates and totals before an invoice is issued. Replaces the legacy hard-coded username gate (carmen, ASzpytka).',
    defaultRoles: ['admin'],
  },
  {
    key: 'invoice.post_sage',
    module: 'invoice',
    label: 'Post invoice to Sage',
    description:
      'Reserved for the invoice module: transfer a calculated invoice into Sage 50. Replaces the legacy ASzpytka-only Sage transfer buttons.',
    defaultRoles: [],
  },
  {
    key: 'tjx:read',
    module: 'tjx',
    label: 'View TJX program',
    description: 'See TJX fixtures, rooms, quotes and invoices.',
    defaultRoles: ['admin', 'technician'],
  },
  {
    key: 'tjx:write',
    module: 'tjx',
    label: 'Edit TJX program',
    description: 'Create and change TJX fixtures, rooms, quotes and invoices.',
    defaultRoles: ['admin', 'technician'],
  },
  {
    key: 'compliance:read',
    module: 'compliance',
    label: 'View compliance documents',
    description: 'See WSIB and insurance documents and their expiry state.',
    defaultRoles: ['admin', 'technician'],
  },
  {
    key: 'compliance:write',
    module: 'compliance',
    label: 'Manage compliance documents',
    description: 'Upload, replace and expire compliance documents.',
    defaultRoles: ['admin'],
  },
  {
    key: 'customer:read',
    module: 'customer',
    label: 'View customers and sites',
    description: 'See customer and site records.',
    defaultRoles: ['admin', 'technician', 'subcontractor'],
  },
  {
    key: 'customer:write',
    module: 'customer',
    label: 'Edit customers and sites',
    description: 'Create and change customer and site records.',
    defaultRoles: ['admin'],
  },
  {
    key: 'subcontractor:read',
    module: 'customer',
    label: 'View subcontractors',
    description:
      'Find and view subcontractor profiles, contacts, labour rates and compliance state. New capability: the legacy system had no subcontractor permission table.',
    defaultRoles: ['admin', 'technician'],
  },
  {
    key: 'subcontractor:write',
    module: 'customer',
    label: 'Edit subcontractors',
    description:
      'Create and change subcontractor profiles, contacts and labour rates. New capability, not a replaced legacy key.',
    defaultRoles: ['admin'],
  },
  {
    key: 'supplier:read',
    module: 'purchasing',
    label: 'View suppliers',
    description:
      'Find and view suppliers, the Sage vendor link and PO flags. New capability: the legacy system had no supplier permission table.',
    defaultRoles: ['admin'],
  },
  {
    key: 'supplier:write',
    module: 'purchasing',
    label: 'Edit suppliers',
    description:
      'Create and change supplier profiles and PO flags. New capability; never granted to the supplier role.',
    defaultRoles: ['admin'],
  },
  {
    key: 'reports:read',
    module: 'reports',
    label: 'View reports',
    description: 'Run and export operational and financial reports.',
    defaultRoles: ['admin', 'technician'],
  },
  {
    key: 'report.download_rates',
    module: 'reports',
    label: 'Download rate reports',
    description:
      'Reserved for the reports module: download subcontractor and customer rate sheets. Replaces the legacy username gate on the rate download screens.',
    defaultRoles: [],
  },
  {
    key: 'pma.certificate.download',
    module: 'compliance',
    label: 'Download PMA certificate',
    description:
      'Reserved for the compliance module: download a PMA certificate. Replaces the legacy per-username certificate gate.',
    defaultRoles: [],
  },
  {
    key: 'subcontractor.rates.download',
    module: 'customer',
    label: 'Download subcontractor rates',
    description:
      'Reserved for the subcontractor module: download a vendor rate sheet. Replaces the legacy username gate, including the always-true check in editsubcontractor.php.',
    defaultRoles: [],
  },
  {
    key: 'admin:users',
    module: 'admin',
    label: 'Manage users and roles',
    description: 'Invite users, change roles and grant permissions.',
    defaultRoles: ['admin'],
  },
  {
    key: 'admin:audit',
    module: 'admin',
    label: 'View audit log',
    description: 'Read the immutable audit trail.',
    defaultRoles: ['admin'],
  },
  {
    key: 'admin:settings',
    module: 'admin',
    label: 'Manage settings',
    description: 'Change application and integration settings.',
    defaultRoles: ['admin'],
  },
  {
    key: 'sage:read',
    module: 'sage',
    label: 'Read from Sage 50',
    description: 'Run read-only Sage synchronisation.',
    defaultRoles: ['admin'],
  },
  {
    key: 'sage:sync',
    module: 'sage',
    label: 'Sync with Sage 50',
    description: 'Push and pull customers, vendors, projects and invoices.',
    defaultRoles: ['admin'],
  },
  {
    key: 'sage:write',
    module: 'sage',
    label: 'Write to Sage 50',
    description: 'Create or change records in the Sage company database.',
    defaultRoles: ['admin'],
  },
  {
    key: 'workorder:create',
    module: 'workorder',
    label: 'Create work orders',
    description:
      'Open a new work order and allocate its number. Field roles capture against assigned work orders instead.',
    defaultRoles: ['admin'],
  },
  {
    key: 'workorder:dispatch',
    module: 'workorder',
    label: 'Dispatch work orders',
    description:
      'Assign a subcontractor and move a work order to Dispatched. Replaces the legacy access > 5 page guard.',
    defaultRoles: ['admin'],
  },
  {
    key: 'workorder:capture',
    module: 'workorder',
    label: 'Capture field data',
    description:
      'Add labour, parts, the service report, photos and local time/signatures. For technicians and subcontractors the server scopes this to their own assigned work orders.',
    defaultRoles: ['admin', 'technician', 'subcontractor'],
  },
] as const satisfies readonly PermissionDefinition[]

export type PermissionKey = (typeof PERMISSIONS)[number]['key']

export const PERMISSION_KEYS: readonly string[] = PERMISSIONS.map((p) => p.key)

export function isPermissionKey(value: string): value is PermissionKey {
  return PERMISSION_KEYS.includes(value)
}

export function defaultGrantedPermissions(role: Role): PermissionKey[] {
  return PERMISSIONS.filter((p) => (p.defaultRoles as readonly Role[]).includes(role)).map(
    (p) => p.key as PermissionKey,
  )
}

/** Wildcard grant used by tests and the seed to enumerate everything. */
export const ALL_PERMISSIONS: readonly PermissionKey[] = PERMISSIONS.map(
  (p) => p.key as PermissionKey,
)
