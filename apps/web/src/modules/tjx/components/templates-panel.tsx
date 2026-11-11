import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Plus, Star, Trash2, X } from 'lucide-react'
import { Button, Card, Field, Input, Tag, Textarea } from '../../work-orders/components/ui'
import { listTjxRoomsFn } from '../server/masters.functions'
import {
  deleteTjxTemplateFn,
  getTjxTemplateFn,
  listTjxTemplatesFn,
  saveTjxTemplateFn,
  setDefaultTjxTemplateFn,
} from '../server/masters.functions'
import type { TjxRoomRow, TjxTemplateDetail } from '../types'
import { EmptyNote, ErrorNote } from './master-ui'

interface TemplateForm {
  name: string
  notes: string
  isDefault: boolean
}

const EMPTY: TemplateForm = { name: '', notes: '', isDefault: false }

function initialForm(detail: TjxTemplateDetail | null): TemplateForm {
  return detail
    ? { name: detail.name, notes: detail.notes ?? '', isDefault: detail.isDefault }
    : EMPTY
}

function TemplateEditor({
  detail,
  rooms,
  onSaved,
}: {
  detail: TjxTemplateDetail | null
  rooms: TjxRoomRow[]
  onSaved: (id: number) => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<TemplateForm>(() => initialForm(detail))
  const [orderedRoomIds, setOrderedRoomIds] = useState<number[]>(
    () => detail?.rooms.map((row) => row.roomId) ?? [],
  )
  const [error, setError] = useState<string | null>(null)
  const isNew = detail === null

  const save = useMutation({
    mutationFn: () =>
      saveTjxTemplateFn({
        data: {
          id: detail?.id,
          name: form.name,
          notes: form.notes.trim() || null,
          isDefault: form.isDefault,
          roomIds: orderedRoomIds,
        },
      }),
    onSuccess: (saved) => {
      setError(null)
      setForm({ name: saved.name, notes: saved.notes ?? '', isDefault: saved.isDefault })
      setOrderedRoomIds(saved.rooms.map((row) => row.roomId))
      void queryClient.invalidateQueries({ queryKey: ['tjx', 'templates'] })
      void queryClient.invalidateQueries({ queryKey: ['tjx', 'rooms'] })
      onSaved(saved.id)
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Could not save the template.'),
  })

  const roomName = (id: number) => rooms.find((room) => room.id === id)?.name ?? `Room ${id}`

  const toggleRoom = (roomId: number) => {
    setOrderedRoomIds((current) =>
      current.includes(roomId) ? current.filter((id) => id !== roomId) : [...current, roomId],
    )
  }

  const move = (roomId: number, direction: -1 | 1) => {
    setOrderedRoomIds((current) => {
      const index = current.indexOf(roomId)
      const next = index + direction
      if (index < 0 || next < 0 || next >= current.length) return current
      const copy = [...current]
      ;[copy[index], copy[next]] = [copy[next]!, copy[index]!]
      return copy
    })
  }

  return (
    <form
      className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_330px]"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <div className="lg:col-span-2">
        <ErrorNote message={error} />
      </div>
      <div className="space-y-3">
        <Field label="Template name" required>
          <Input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Default Room Template"
            autoComplete="off"
          />
        </Field>
        <Field label="Notes">
          <Textarea
            rows={2}
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
            placeholder="Optional"
          />
        </Field>
        <label className="flex items-center gap-2 text-[12.5px] text-fg-secondary">
          <input
            type="checkbox"
            checked={form.isDefault}
            onChange={(event) => setForm({ ...form, isDefault: event.target.checked })}
          />
          Use this template for new quotes
        </label>

        <div>
          <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">
            Room order
          </p>
          {orderedRoomIds.length === 0 ? (
            <EmptyNote>Choose rooms on the right.</EmptyNote>
          ) : (
            <ol className="space-y-1">
              {orderedRoomIds.map((roomId, index) => (
                <li
                  key={roomId}
                  className="flex items-center justify-between gap-2 rounded-[4px] border border-hair px-2.5 py-1.5"
                >
                  <span className="text-[12.5px] text-fg">
                    <span className="mr-2 tabular-nums text-fg-muted">{index + 1}.</span>
                    {roomName(roomId)}
                  </span>
                  <span className="flex gap-0.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Move ${roomName(roomId)} up`}
                      disabled={index === 0}
                      onClick={() => move(roomId, -1)}
                    >
                      <ArrowUp size={13} aria-hidden="true" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Move ${roomName(roomId)} down`}
                      disabled={index === orderedRoomIds.length - 1}
                      onClick={() => move(roomId, 1)}
                    >
                      <ArrowDown size={13} aria-hidden="true" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${roomName(roomId)}`}
                      onClick={() => toggleRoom(roomId)}
                    >
                      <X size={13} aria-hidden="true" />
                    </Button>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className="rounded-[4px] border border-hair p-3">
        <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">
          Available rooms
        </p>
        {rooms.length === 0 ? (
          <EmptyNote>No active rooms. Add rooms first.</EmptyNote>
        ) : (
          <div className="max-h-[420px] space-y-1 overflow-y-auto">
            {rooms.map((room) => (
              <label
                key={room.id}
                className="flex items-center gap-2 rounded-[3px] px-1.5 py-1 text-[12.5px] text-fg-secondary hover:bg-[var(--surface-subtle)]"
              >
                <input
                  type="checkbox"
                  checked={orderedRoomIds.includes(room.id)}
                  onChange={() => toggleRoom(room.id)}
                />
                {room.name}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 lg:col-span-2">
        <Button type="submit" variant="primary" disabled={save.isPending || !form.name.trim()}>
          {save.isPending ? 'Saving…' : isNew ? 'Create template' : 'Save template'}
        </Button>
      </div>
    </form>
  )
}

export function TemplatesPanel() {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const templates = useQuery({
    queryKey: ['tjx', 'templates'],
    queryFn: () => listTjxTemplatesFn({ data: {} }),
  })
  const rooms = useQuery({
    queryKey: ['tjx', 'rooms'],
    queryFn: () => listTjxRoomsFn({ data: { active: 'all' } }),
  })
  const detail = useQuery({
    queryKey: ['tjx', 'templates', selectedId],
    queryFn: () => getTjxTemplateFn({ data: { id: selectedId as number } }),
    enabled: !creating && selectedId !== null,
  })

  const makeDefault = useMutation({
    mutationFn: (id: number) => setDefaultTjxTemplateFn({ data: { id } }),
    onSuccess: (saved) => {
      setError(null)
      setSelectedId(saved.id)
      void queryClient.invalidateQueries({ queryKey: ['tjx', 'templates'] })
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Could not set the default.'),
  })

  const remove = useMutation({
    mutationFn: (id: number) => deleteTjxTemplateFn({ data: { id } }),
    onSuccess: () => {
      setError(null)
      setSelectedId(null)
      void queryClient.invalidateQueries({ queryKey: ['tjx', 'templates'] })
      void queryClient.invalidateQueries({ queryKey: ['tjx', 'rooms'] })
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Could not delete the template.'),
  })

  const selectedTemplate = templates.data?.find((row) => row.id === selectedId)
  const editor =
    creating || (detail.data && detail.data.id === selectedId) ? (
      <TemplateEditor
        key={creating ? 'new' : `template-${detail.data!.id}`}
        detail={creating ? null : detail.data!}
        rooms={rooms.data ?? []}
        onSaved={(id) => {
          setCreating(false)
          setSelectedId(id)
        }}
      />
    ) : null

  return (
    <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
      <Card
        title="Templates"
        action={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setCreating(true)
              setSelectedId(null)
              setError(null)
            }}
          >
            <Plus size={13} aria-hidden="true" /> New
          </Button>
        }
      >
        <ErrorNote
          message={error ?? (templates.isError ? templates.error.message : null)}
        />
        {templates.data?.length === 0 ? <EmptyNote>No templates yet.</EmptyNote> : null}
        <div className="space-y-1">
          {templates.data?.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => {
                setCreating(false)
                setSelectedId(row.id)
                setError(null)
              }}
              className={`flex w-full items-start justify-between gap-2 rounded-[4px] border px-2.5 py-2 text-left transition-colors ${
                !creating && row.id === selectedId
                  ? 'border-[var(--action-primary-bg)] bg-[var(--surface-subtle)]'
                  : 'border-transparent hover:bg-[var(--surface-subtle)]'
              }`}
            >
              <span>
                <span className="block text-[12.5px] font-medium text-fg">{row.name}</span>
                <span className="block text-[11px] text-fg-muted">
                  {row.roomCount} room{row.roomCount === 1 ? '' : 's'}
                </span>
              </span>
              {row.isDefault ? <Tag tone="info">Default</Tag> : null}
            </button>
          ))}
        </div>
      </Card>

      <Card
        title={creating ? 'New template' : selectedTemplate?.name ?? 'Template'}
        action={
          !creating && selectedId ? (
            <div className="flex gap-1">
              {!selectedTemplate?.isDefault ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={makeDefault.isPending}
                  onClick={() => makeDefault.mutate(selectedId)}
                >
                  <Star size={13} aria-hidden="true" /> Make default
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                disabled={remove.isPending || selectedTemplate?.isDefault}
                onClick={() => {
                  if (window.confirm('Delete this template? Quotes already created from it are not affected.')) {
                    remove.mutate(selectedId)
                  }
                }}
              >
                <Trash2 size={13} aria-hidden="true" /> Delete
              </Button>
            </div>
          ) : null
        }
      >
        <ErrorNote message={detail.isError ? detail.error.message : null} />
        {editor ? (
          editor
        ) : (
          <EmptyNote>Select a template, or create a new one.</EmptyNote>
        )}
      </Card>
    </div>
  )
}
