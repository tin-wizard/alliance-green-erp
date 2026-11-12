import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { PERMISSIONS, ROLES, ROLE_LABELS, type Role } from '@cls/core'
import {
  Button,
  Card,
  ErrorPanel,
  Field,
  Input,
  Select,
  Tag,
  formatDateTime,
} from '../../../modules/work-orders/components/ui'
import { PageHeader } from '../../../shell/page-header'
import {
  forcePasswordResetFn,
  grantPermissionFn,
  inviteUserFn,
  listAdminUsersFn,
  revokePermissionFn,
  updateUserFn,
} from '../../../modules/admin/server/admin.functions'

export const Route = createFileRoute('/_app/admin/users')({
  component: UsersPage,
})

function UsersPage() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['admin', 'users'], queryFn: () => listAdminUsersFn() })
  const [invite, setInvite] = useState({ email: '', displayName: '', role: 'technician' as Role })
  const [grant, setGrant] = useState({ userId: '', permissionKey: '', note: '', expiresAt: '' })
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
  const fail = (cause: unknown) => {
    setNotice(null)
    setError(cause instanceof Error ? cause.message : String(cause))
  }

  const create = useMutation({
    mutationFn: () => inviteUserFn({ data: invite }),
    onSuccess: async () => {
      setError(null)
      setNotice(`Invitation sent to ${invite.email}.`)
      setInvite({ email: '', displayName: '', role: 'technician' })
      await refresh()
    },
    onError: fail,
  })

  const update = useMutation({
    mutationFn: (input: { id: string; role?: Role; isEnabled?: boolean }) =>
      updateUserFn({ data: input }),
    onSuccess: async () => {
      setError(null)
      setNotice(null)
      await refresh()
    },
    onError: fail,
  })

  const reset = useMutation({
    mutationFn: (id: string) => forcePasswordResetFn({ data: { id } }),
    onSuccess: async () => {
      setError(null)
      setNotice('Password reset email requested.')
      await refresh()
    },
    onError: fail,
  })

  const addGrant = useMutation({
    mutationFn: () =>
      grantPermissionFn({
        data: {
          userId: grant.userId,
          permissionKey: grant.permissionKey,
          ...(grant.note ? { note: grant.note } : {}),
          ...(grant.expiresAt ? { expiresAt: grant.expiresAt } : {}),
        },
      }),
    onSuccess: async () => {
      setError(null)
      setNotice('Override granted.')
      setGrant({ userId: '', permissionKey: '', note: '', expiresAt: '' })
      await refresh()
    },
    onError: fail,
  })

  const removeGrant = useMutation({
    mutationFn: (input: { userId: string; permissionKey: string }) =>
      revokePermissionFn({ data: input }),
    onSuccess: async () => {
      setError(null)
      setNotice('Override revoked.')
      await refresh()
    },
    onError: fail,
  })

  const modules = [...new Set(PERMISSIONS.map((permission) => permission.module))]

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Users & roles"
        description="Credentials and sessions belong to Neon Auth; this page links identities to application roles. Invitations create the identity, send a reset link and add the role row."
      />

      {error ? <ErrorPanel message={error} /> : null}
      {notice ? (
        <div className="rounded-[6px] border border-[var(--status-approved-bd)] bg-[var(--status-approved-bg)] px-4 py-3 text-[12.5px] text-[var(--status-approved-fg)]">
          {notice}
        </div>
      ) : null}

      <Card title="Invite a user">
        <form
          className="grid items-end gap-3 md:grid-cols-[1fr_1fr_180px_auto]"
          onSubmit={(event) => {
            event.preventDefault()
            create.mutate()
          }}
        >
          <Field label="Email" required>
            <Input
              type="email"
              required
              value={invite.email}
              onChange={(event) => setInvite({ ...invite, email: event.target.value })}
            />
          </Field>
          <Field label="Display name" required>
            <Input
              required
              value={invite.displayName}
              onChange={(event) => setInvite({ ...invite, displayName: event.target.value })}
            />
          </Field>
          <Field label="Role">
            <Select
              value={invite.role}
              onChange={(event) => setInvite({ ...invite, role: event.target.value as Role })}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="primary" disabled={create.isPending}>
            {create.isPending ? 'Inviting…' : 'Invite'}
          </Button>
        </form>
        <p className="mt-3 text-[11.5px] text-fg-muted">
          Neon Auth sends a password reset link, which expires after 15 minutes. An account that
          already exists in the identity provider is reported instead of duplicated.
        </p>
      </Card>

      <Card title="Users" padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]" data-testid="admin-users">
            <thead>
              <tr className="bg-subtle text-left text-[10.5px] uppercase tracking-[0.08em] text-fg-muted">
                <th scope="col" className="px-4 py-2 font-semibold">User</th>
                <th scope="col" className="px-4 py-2 font-semibold">Role</th>
                <th scope="col" className="px-4 py-2 font-semibold">Status</th>
                <th scope="col" className="px-4 py-2 font-semibold">Overrides</th>
                <th scope="col" className="px-4 py-2 font-semibold">Last sign-in</th>
                <th scope="col" className="px-4 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {query.isPending ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-fg-muted">Loading users…</td>
                </tr>
              ) : query.isError ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6">
                    <ErrorPanel message={query.error instanceof Error ? query.error.message : String(query.error)} />
                  </td>
                </tr>
              ) : query.data.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-fg-muted">No users yet.</td>
                </tr>
              ) : (
                query.data.map((user) => (
                  <tr key={user.id} className="border-t border-hair align-top" data-testid="admin-user-row">
                    <td className="px-4 py-3">
                      <p className="font-medium text-fg">{user.displayName}</p>
                      <p className="text-[11.5px] text-fg-muted">{user.email}</p>
                      {user.subcontractor ? (
                        <p className="text-[11.5px] text-fg-muted">{user.subcontractor}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <Select
                        aria-label={`Role for ${user.displayName}`}
                        value={user.role}
                        disabled={update.isPending}
                        onChange={(event) =>
                          update.mutate({ id: user.id, role: event.target.value as Role })
                        }
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-4 py-3">
                      {user.isEnabled ? <Tag tone="info">Enabled</Tag> : <Tag tone="danger">Disabled</Tag>}
                    </td>
                    <td className="px-4 py-3">
                      {user.grants.length === 0 ? (
                        <span className="text-fg-faint">None</span>
                      ) : (
                        <ul className="space-y-1">
                          {user.grants.map((grantItem) => (
                            <li key={grantItem.key} className="flex items-start gap-1.5 font-mono text-[10.5px] text-fg-secondary">
                              <span>
                                {grantItem.key}
                                {grantItem.note ? <span className="font-sans text-fg-muted"> · {grantItem.note}</span> : null}
                              </span>
                              <button
                                type="button"
                                className="font-sans text-[10.5px] text-danger underline-offset-2 hover:underline"
                                disabled={removeGrant.isPending}
                                onClick={() =>
                                  removeGrant.mutate({ userId: user.id, permissionKey: grantItem.key })
                                }
                              >
                                Revoke
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-3 text-fg-muted">
                      {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          size="sm"
                          disabled={update.isPending}
                          onClick={() =>
                            update.mutate({ id: user.id, isEnabled: !user.isEnabled })
                          }
                        >
                          {user.isEnabled ? 'Disable' : 'Enable'}
                        </Button>
                        <Button
                          size="sm"
                          disabled={reset.isPending}
                          onClick={() => reset.mutate(user.id)}
                        >
                          Force reset
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Grant a permission override">
        <form
          className="grid items-end gap-3 md:grid-cols-[1fr_1fr_1fr_170px_auto]"
          onSubmit={(event) => {
            event.preventDefault()
            addGrant.mutate()
          }}
        >
          <Field label="User" required>
            <Select
              required
              value={grant.userId}
              onChange={(event) => setGrant({ ...grant, userId: event.target.value })}
            >
              <option value="">Choose a user…</option>
              {(query.data ?? []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Permission" required>
            <Select
              required
              value={grant.permissionKey}
              onChange={(event) => setGrant({ ...grant, permissionKey: event.target.value })}
            >
              <option value="">Choose a permission…</option>
              {PERMISSIONS.map((permission) => (
                <option key={permission.key} value={permission.key}>
                  {permission.label} ({permission.key})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason" hint="Recorded in the audit log.">
            <Input
              value={grant.note}
              onChange={(event) => setGrant({ ...grant, note: event.target.value })}
            />
          </Field>
          <Field label="Expires" hint="Blank never expires.">
            <Input
              type="date"
              value={grant.expiresAt}
              onChange={(event) => setGrant({ ...grant, expiresAt: event.target.value })}
            />
          </Field>
          <Button type="submit" variant="primary" disabled={addGrant.isPending}>
            {addGrant.isPending ? 'Granting…' : 'Grant'}
          </Button>
        </form>
        <p className="mt-3 text-[11.5px] text-fg-muted">
          Overrides sit on top of the role defaults. A grant can be scoped to one subcontractor for
          the WSIB override; scope is set by the module that needs it.
        </p>
      </Card>

      <Card title="Default grant matrix" padded={false}>
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
      </Card>
    </div>
  )
}
