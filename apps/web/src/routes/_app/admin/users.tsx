import { createFileRoute } from '@tanstack/react-router'
import { ROLES, ROLE_LABELS, PERMISSIONS } from '@cls/core'
import { PageHeader } from '../../../shell/page-header'

export const Route = createFileRoute('/_app/admin/users')({
  component: UsersPage,
})

function UsersPage() {
  const modules = [...new Set(PERMISSIONS.map((permission) => permission.module))]

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Users & roles"
        description="Four roles and a granular permission layer. The table below is the code-owned default grant matrix; per-user grants and expiries live in user_permissions."
      />

      <div className="rounded-[6px] border border-hair bg-canvas">
        <div className="flex flex-wrap items-center gap-3 border-b border-hair px-4 py-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-fg-muted">
            Default grants
          </p>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {ROLES.map((role) => (
              <span
                key={role}
                className="rounded-[2px] border border-hair px-2 py-0.5 text-[10.5px] font-medium text-fg-muted"
              >
                {ROLE_LABELS[role]}
              </span>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="bg-subtle text-left text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
                <th scope="col" className="px-4 py-2 font-semibold">Module</th>
                <th scope="col" className="px-4 py-2 font-semibold">Permission</th>
                <th scope="col" className="px-4 py-2 font-semibold">Key</th>
                <th scope="col" className="px-4 py-2 font-semibold">Default roles</th>
              </tr>
            </thead>
            <tbody>
              {modules.flatMap((module) =>
                PERMISSIONS.filter((permission) => permission.module === module).map(
                  (permission) => (
                    <tr key={permission.key} className="border-t border-hair">
                      <td className="px-4 py-2 text-fg-muted">{module}</td>
                      <td className="px-4 py-2 text-fg">{permission.label}</td>
                      <td className="px-4 py-2 font-mono text-[11.5px] text-fg-secondary">
                        {permission.key}
                      </td>
                      <td className="px-4 py-2 text-fg-secondary">
                        {permission.defaultRoles.map((role) => ROLE_LABELS[role]).join(', ') || '—'}
                      </td>
                    </tr>
                  ),
                ),
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-[6px] border border-hair bg-subtle p-4 text-[12.5px] text-fg-secondary">
        <p className="font-medium text-fg">User management UI is not built yet.</p>
        <p className="mt-1">
          Permissions and role grants are implemented and enforced. Credentials and sessions belong
          to Neon Auth; this page will link Neon identities to application roles. Creating users,
          linking identities and granting permissions land with the Admin module. Until then, set
          <code className="mx-1 font-mono text-[11.5px]">SEED_ADMIN_EMAIL</code> and run
          <code className="mx-1 font-mono text-[11.5px]">pnpm db:seed</code> for the bootstrap
          administrator.
        </p>
      </div>
    </div>
  )
}
