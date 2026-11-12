import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button, Card, ErrorPanel, Field, Input, Tag } from '../../../modules/work-orders/components/ui'
import { PageHeader } from '../../../shell/page-header'
import { listSettingsFn, saveSettingFn } from '../../../modules/admin/server/admin.functions'

export const Route = createFileRoute('/_app/admin/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => listSettingsFn() })
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (input: { key: string; value: string }) => saveSettingFn({ data: input }),
    onSuccess: async (_result, variables) => {
      setError(null)
      setSavedKey(variables.key)
      setDrafts((current) => {
        const next = { ...current }
        delete next[variables.key]
        return next
      })
      await queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] })
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : String(cause)),
  })

  if (query.isPending) {
    return <p className="p-6 text-[13px] text-fg-muted">Loading settings…</p>
  }
  if (query.isError) {
    return <ErrorPanel message={query.error instanceof Error ? query.error.message : String(query.error)} />
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        description="Typed configuration shared by every module. Defaults live in code; an override is stored in app.settings with the administrator and time it changed."
      />
      {error ? <ErrorPanel message={error} /> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {query.data.map((setting) => {
          const draft = drafts[setting.key]
          const value = draft ?? String(setting.value)
          const changed = draft !== undefined && draft !== String(setting.value)
          return (
            <Card
              key={setting.key}
              title={
                <span className="flex items-center gap-2">
                  {setting.label}
                  {setting.isDefault ? <Tag>Default</Tag> : <Tag tone="info">Stored</Tag>}
                </span>
              }
              action={
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!changed || save.isPending}
                  onClick={() => save.mutate({ key: setting.key, value })}
                >
                  {save.isPending && save.variables?.key === setting.key ? 'Saving…' : 'Save'}
                </Button>
              }
            >
              <Field
                label={setting.type === 'number' ? 'Number' : 'Value'}
                hint={setting.description}
              >
                <Input
                  type={setting.type === 'number' ? 'number' : 'text'}
                  value={value}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [setting.key]: event.target.value }))
                  }
                />
              </Field>
              <p className="mt-2 font-mono text-[10.5px] text-fg-faint">{setting.key}</p>
              <p className="mt-1 text-[11.5px] text-fg-muted">
                {setting.updatedAt
                  ? `Changed ${new Date(setting.updatedAt).toLocaleString('en-CA')}`
                  : 'Never changed'}
                {savedKey === setting.key ? ' · Saved' : ''}
              </p>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
