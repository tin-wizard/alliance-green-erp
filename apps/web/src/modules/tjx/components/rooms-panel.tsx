import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, X } from 'lucide-react'
import { Button, Card, Field, Input, Tag, Textarea } from '../../work-orders/components/ui'
import { listTjxRoomsFn, saveTjxRoomFn, setTjxRoomActiveFn } from '../server/masters.functions'
import type { TjxRoomRow } from '../types'
import { EmptyNote, ErrorNote } from './master-ui'

interface RoomForm {
  id?: number
  name: string
  description: string
  sortOrder: string
  isActive: boolean
}

const EMPTY: RoomForm = { name: '', description: '', sortOrder: '0', isActive: true }

function formFor(row: TjxRoomRow): RoomForm {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    sortOrder: String(row.sortOrder),
    isActive: row.isActive,
  }
}

export function RoomsPanel() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<RoomForm>(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const rooms = useQuery({
    queryKey: ['tjx', 'rooms'],
    queryFn: () => listTjxRoomsFn({ data: { active: 'all' } }),
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['tjx', 'rooms'] })
    void queryClient.invalidateQueries({ queryKey: ['tjx', 'templates'] })
  }

  const save = useMutation({
    mutationFn: () =>
      saveTjxRoomFn({
        data: {
          id: form.id,
          name: form.name,
          description: form.description.trim() || null,
          sortOrder: Number(form.sortOrder) || 0,
          isActive: form.isActive,
        },
      }),
    onSuccess: () => {
      setError(null)
      setForm(EMPTY)
      invalidate()
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Could not save the room.'),
  })

  const toggle = useMutation({
    mutationFn: (input: { id: number; isActive: boolean }) => setTjxRoomActiveFn({ data: input }),
    onSuccess: () => {
      setError(null)
      invalidate()
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Could not change the room.'),
  })

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card
        title="Rooms"
        action={
          <span className="text-[11.5px] text-fg-muted">
            {rooms.data?.length ?? 0} room{rooms.data?.length === 1 ? '' : 's'}
          </span>
        }
      >
        <ErrorNote message={error} />
        {rooms.isError ? <ErrorNote message={rooms.error.message} /> : null}
        {rooms.data?.length === 0 ? (
          <EmptyNote>No rooms yet. Add the first room on the right.</EmptyNote>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-[12.5px]">
              <thead className="border-b border-hair text-[10px] uppercase tracking-[0.1em] text-fg-muted">
                <tr>
                  <th className="px-2 py-2 font-semibold">Room</th>
                  <th className="px-2 py-2 font-semibold">Order</th>
                  <th className="px-2 py-2 font-semibold">Templates</th>
                  <th className="px-2 py-2 font-semibold">Status</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rooms.data?.map((row) => (
                  <tr key={row.id} className="border-b border-hair/60 last:border-0">
                    <td className="px-2 py-2">
                      <div className="font-medium text-fg">{row.name}</div>
                      {row.description ? (
                        <div className="text-[11.5px] text-fg-muted">{row.description}</div>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 tabular-nums text-fg-secondary">{row.sortOrder}</td>
                    <td className="px-2 py-2 text-fg-secondary">
                      {row.usedByTemplates.length ? row.usedByTemplates.join(', ') : '—'}
                    </td>
                    <td className="px-2 py-2">
                      <Tag tone={row.isActive ? 'info' : 'neutral'}>{row.isActive ? 'Active' : 'Inactive'}</Tag>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setForm(formFor(row))}>
                          <Pencil size={13} aria-hidden="true" /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={toggle.isPending}
                          onClick={() => toggle.mutate({ id: row.id, isActive: !row.isActive })}
                        >
                          {row.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={form.id ? 'Edit room' : 'New room'}>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            save.mutate()
          }}
        >
          <Field label="Name" required>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Sales floor"
              autoComplete="off"
            />
          </Field>
          <Field label="Description">
            <Textarea
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              rows={2}
              placeholder="Optional note"
            />
          </Field>
          <Field label="Sort order" hint="Lower numbers appear first.">
            <Input
              type="number"
              min={0}
              value={form.sortOrder}
              onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-[12.5px] text-fg-secondary">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
            />
            Active
          </label>
          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" variant="primary" disabled={save.isPending || !form.name.trim()}>
              {save.isPending ? 'Saving…' : form.id ? 'Save room' : 'Add room'}
            </Button>
            {form.id ? (
              <Button variant="ghost" onClick={() => setForm(EMPTY)}>
                <X size={13} aria-hidden="true" /> Cancel
              </Button>
            ) : null}
          </div>
        </form>
      </Card>
    </div>
  )
}
