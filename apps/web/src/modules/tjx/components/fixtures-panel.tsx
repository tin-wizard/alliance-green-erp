import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, X } from 'lucide-react'
import { Button, Card, Field, Input, Select, Tag, Textarea } from '../../work-orders/components/ui'
import {
  getTjxFixtureFn,
  listTjxFixturesFn,
  saveTjxFixtureFn,
  searchTjxPartsFn,
  setTjxFixtureActiveFn,
} from '../server/masters.functions'
import type { TjxFixtureDetail } from '../types'
import { EmptyNote, ErrorNote } from './master-ui'

interface FixtureForm {
  name: string
  description: string
  sortOrder: string
  isActive: boolean
}

interface PartDraft {
  key: string
  partNo: string
  partType: 'Ballast' | 'Lamp' | ''
  markup: string
  ratioPerFixture: string
}

const EMPTY: FixtureForm = { name: '', description: '', sortOrder: '0', isActive: true }

function draft(partNo = ''): PartDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    partNo,
    partType: '',
    markup: '1',
    ratioPerFixture: '1',
  }
}

function initialForm(detail: TjxFixtureDetail | null): FixtureForm {
  return detail
    ? {
        name: detail.name,
        description: detail.description ?? '',
        sortOrder: String(detail.sortOrder),
        isActive: detail.isActive,
      }
    : EMPTY
}

function initialParts(detail: TjxFixtureDetail | null): PartDraft[] {
  return (
    detail?.parts.map((part) => ({
      key: `saved-${part.id}`,
      partNo: part.partNo,
      partType: part.partType as PartDraft['partType'],
      markup: part.markup,
      ratioPerFixture: part.ratioPerFixture,
    })) ?? []
  )
}

function FixtureEditor({
  detail,
  onSaved,
}: {
  detail: TjxFixtureDetail | null
  onSaved: (id: number) => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FixtureForm>(() => initialForm(detail))
  const [parts, setParts] = useState<PartDraft[]>(() => initialParts(detail))
  const [partSearch, setPartSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isNew = detail === null

  const options = useQuery({
    queryKey: ['tjx', 'parts', partSearch],
    queryFn: () => searchTjxPartsFn({ data: { search: partSearch, limit: 20 } }),
    enabled: partSearch.trim().length > 0,
  })

  const save = useMutation({
    mutationFn: () =>
      saveTjxFixtureFn({
        data: {
          id: detail?.id,
          name: form.name,
          description: form.description.trim() || null,
          sortOrder: Number(form.sortOrder) || 0,
          isActive: form.isActive,
          parts: parts.map((part, index) => ({
            partNo: part.partNo,
            partType: part.partType,
            markup: part.markup,
            ratioPerFixture: part.ratioPerFixture,
            sortOrder: index,
          })),
        },
      }),
    onSuccess: (saved) => {
      setError(null)
      setForm({
        name: saved.name,
        description: saved.description ?? '',
        sortOrder: String(saved.sortOrder),
        isActive: saved.isActive,
      })
      setParts(initialParts(saved))
      void queryClient.invalidateQueries({ queryKey: ['tjx', 'fixtures'] })
      onSaved(saved.id)
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Could not save the fixture.'),
  })

  const addPart = (partNo: string) => {
    const normalized = partNo.trim().toUpperCase()
    if (!normalized) return
    if (parts.some((part) => part.partNo.toUpperCase() === normalized)) {
      setError(`Part ${normalized} is already in this fixture.`)
      return
    }
    setError(null)
    setParts((current) => [...current, draft(normalized)])
    setPartSearch('')
  }

  const updatePart = (key: string, change: Partial<PartDraft>) => {
    setParts((current) => current.map((part) => (part.key === key ? { ...part, ...change } : part)))
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <ErrorNote message={error} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px_140px]">
        <Field label="Fixture name" required>
          <Input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Highbay 2-lamp"
            autoComplete="off"
          />
        </Field>
        <Field label="Sort order">
          <Input
            type="number"
            min={0}
            value={form.sortOrder}
            onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
          />
        </Field>
        <Field label="Status">
          <label className="flex h-9 items-center gap-2 text-[12.5px] text-fg-secondary">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
            />
            Active
          </label>
        </Field>
      </div>
      <Field label="Description">
        <Textarea
          rows={2}
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
          placeholder="Optional note"
        />
      </Field>

      <div className="rounded-[4px] border border-hair">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hair px-3 py-2">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">
            Fixture parts
          </p>
          <Button size="sm" variant="ghost" onClick={() => setParts((current) => [...current, draft()])}>
            <Plus size={13} aria-hidden="true" /> Blank row
          </Button>
        </div>

        <div className="relative border-b border-hair px-3 py-2">
          <div className="flex items-center gap-2">
            <Search size={14} className="text-fg-muted" aria-hidden="true" />
            <Input
              value={partSearch}
              onChange={(event) => setPartSearch(event.target.value)}
              placeholder="Search part number or description to add…"
              autoComplete="off"
            />
          </div>
          {partSearch.trim() ? (
            <div className="absolute left-3 right-3 top-[46px] z-10 max-h-56 overflow-y-auto rounded-[4px] border border-hair bg-[var(--surface-canvas)] shadow-lg">
              {options.data?.length === 0 ? (
                <p className="px-3 py-2 text-[12px] text-fg-muted">No matching parts.</p>
              ) : (
                options.data?.map((option) => (
                  <button
                    key={option.partNumber}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[12px] hover:bg-[var(--surface-subtle)]"
                    onClick={() => addPart(option.partNumber)}
                  >
                    <span className="font-medium text-fg">{option.partNumber}</span>
                    <span className="truncate text-fg-muted">{option.name ?? '—'}</span>
                    <span className="tabular-nums text-fg-secondary">{option.sellPrice ?? '—'}</span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>

        {parts.length === 0 ? (
          <EmptyNote>Add at least one part.</EmptyNote>
        ) : (
          <div className="space-y-2 p-3">
            {parts.map((part, index) => (
              <div
                key={part.key}
                className="grid items-end gap-2 rounded-[4px] border border-hair p-2 sm:grid-cols-[minmax(140px,1fr)_110px_90px_90px_32px]"
              >
                <Field label="Part number">
                  <Input
                    value={part.partNo}
                    onChange={(event) =>
                      updatePart(part.key, { partNo: event.target.value.toUpperCase() })
                    }
                    placeholder="WIN-100"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Type">
                  <Select
                    value={part.partType}
                    onChange={(event) =>
                      updatePart(part.key, { partType: event.target.value as PartDraft['partType'] })
                    }
                  >
                    <option value="">—</option>
                    <option value="Ballast">Ballast</option>
                    <option value="Lamp">Lamp</option>
                  </Select>
                </Field>
                <Field label="Markup">
                  <Input
                    value={part.markup}
                    onChange={(event) => updatePart(part.key, { markup: event.target.value })}
                    inputMode="decimal"
                  />
                </Field>
                <Field label="Ratio / fixture">
                  <Input
                    value={part.ratioPerFixture}
                    onChange={(event) =>
                      updatePart(part.key, { ratioPerFixture: event.target.value })
                    }
                    inputMode="decimal"
                  />
                </Field>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove ${part.partNo || `row ${index + 1}`}`}
                  onClick={() => setParts((current) => current.filter((row) => row.key !== part.key))}
                >
                  <X size={14} aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={save.isPending || !form.name.trim()}>
          {save.isPending ? 'Saving…' : isNew ? 'Create fixture' : 'Save fixture'}
        </Button>
        {parts.length === 0 ? (
          <span className="text-[11.5px] text-fg-muted">A fixture needs at least one part.</span>
        ) : null}
      </div>
    </form>
  )
}

export function FixturesPanel() {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fixtures = useQuery({
    queryKey: ['tjx', 'fixtures'],
    queryFn: () => listTjxFixturesFn({ data: { active: 'all' } }),
  })
  const detail = useQuery({
    queryKey: ['tjx', 'fixtures', selectedId],
    queryFn: () => getTjxFixtureFn({ data: { id: selectedId as number } }),
    enabled: !creating && selectedId !== null,
  })

  const toggle = useMutation({
    mutationFn: (input: { id: number; isActive: boolean }) => setTjxFixtureActiveFn({ data: input }),
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['tjx', 'fixtures'] })
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Could not change the fixture.'),
  })

  const selectedFixture = fixtures.data?.find((row) => row.id === selectedId)
  const editor =
    creating || (detail.data && detail.data.id === selectedId) ? (
      <FixtureEditor
        key={creating ? 'new' : `fixture-${detail.data!.id}`}
        detail={creating ? null : detail.data!}
        onSaved={(id) => {
          setCreating(false)
          setSelectedId(id)
        }}
      />
    ) : null

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
      <Card
        title="Fixtures"
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
        <ErrorNote message={error ?? (fixtures.isError ? fixtures.error.message : null)} />
        {fixtures.data?.length === 0 ? <EmptyNote>No fixtures yet.</EmptyNote> : null}
        <div className="space-y-1">
          {fixtures.data?.map((row) => (
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
                  {row.partCount} part{row.partCount === 1 ? '' : 's'}
                </span>
              </span>
              {!row.isActive ? <Tag>Inactive</Tag> : null}
            </button>
          ))}
        </div>
      </Card>

      <Card
        title={creating ? 'New fixture' : selectedFixture?.name ?? 'Fixture'}
        action={
          !creating && selectedId ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={toggle.isPending}
              onClick={() => toggle.mutate({ id: selectedId, isActive: !selectedFixture?.isActive })}
            >
              {selectedFixture?.isActive ? 'Deactivate' : 'Activate'}
            </Button>
          ) : null
        }
      >
        <ErrorNote message={detail.isError ? detail.error.message : null} />
        {editor ? editor : <EmptyNote>Select a fixture, or create a new one.</EmptyNote>}
      </Card>
    </div>
  )
}
