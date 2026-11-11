import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, X } from 'lucide-react'
import { Button, Card, Field, Input, Select } from '../../work-orders/components/ui'
import {
  listTjxSubcontractorOptionsFn,
  searchTjxPartsFn,
} from '../server/masters.functions'
import { listTjxRatesFn, saveTjxRatesFn } from '../server/rates.functions'
import type { TjxRateRow } from '../types'
import { EmptyNote, ErrorNote } from './master-ui'

interface RateDraft {
  key: string
  partNo: string
  installCostPerUnit: string
}

function draftFromRow(row: TjxRateRow, index: number): RateDraft {
  return {
    key: `saved-${row.partNo}-${index}`,
    partNo: row.partNo,
    installCostPerUnit: row.installCostPerUnit,
  }
}

function RatesEditor({
  subcontractorId,
  initialRates,
}: {
  subcontractorId: number
  initialRates: TjxRateRow[]
}) {
  const queryClient = useQueryClient()
  const [rates, setRates] = useState<RateDraft[]>(() => initialRates.map(draftFromRow))
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const options = useQuery({
    queryKey: ['tjx', 'parts', search],
    queryFn: () => searchTjxPartsFn({ data: { search, limit: 20 } }),
    enabled: search.trim().length > 0,
  })

  const save = useMutation({
    mutationFn: () =>
      saveTjxRatesFn({
        data: {
          subcontractorId,
          rates: rates.map((row) => ({
            partNo: row.partNo,
            installCostPerUnit: row.installCostPerUnit.trim() || '0',
          })),
        },
      }),
    onSuccess: (rows) => {
      setError(null)
      setRates(rows.map(draftFromRow))
      setSavedAt(new Date().toLocaleTimeString())
      void queryClient.invalidateQueries({ queryKey: ['tjx', 'rates', subcontractorId] })
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : 'Could not save the rates.'),
  })

  const addPart = (partNo: string) => {
    const normalized = partNo.trim().toUpperCase()
    if (!normalized) return
    if (rates.some((row) => row.partNo.toUpperCase() === normalized)) {
      setError(`Part ${normalized} already has a rate.`)
      return
    }
    setError(null)
    setRates((current) => [
      ...current,
      {
        key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        partNo: normalized,
        installCostPerUnit: '0.00',
      },
    ])
    setSearch('')
  }

  const update = (key: string, change: Partial<RateDraft>) => {
    setRates((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)))
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

      <div className="rounded-[4px] border border-hair">
        <div className="border-b border-hair px-3 py-2">
          <div className="flex items-center gap-2">
            <Search size={14} className="text-fg-muted" aria-hidden="true" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Add a part by number or description…"
              autoComplete="off"
            />
          </div>
          {search.trim() ? (
            <div className="mt-2 max-h-56 space-y-0.5 overflow-y-auto">
              {options.data?.length === 0 ? (
                <p className="px-1 py-2 text-[12px] text-fg-muted">No matching parts.</p>
              ) : (
                options.data?.map((option) => (
                  <button
                    key={option.partNumber}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 rounded-[3px] px-1.5 py-1.5 text-left text-[12px] hover:bg-[var(--surface-subtle)]"
                    onClick={() => addPart(option.partNumber)}
                  >
                    <span className="font-medium text-fg">{option.partNumber}</span>
                    <span className="truncate text-fg-muted">{option.name ?? '—'}</span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>

        {rates.length === 0 ? (
          <EmptyNote>No rates for this subcontractor yet.</EmptyNote>
        ) : (
          <div className="divide-y divide-[var(--hairline)]">
            {rates.map((row) => (
              <div
                key={row.key}
                className="grid items-end gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_160px_32px]"
              >
                <p className="pb-2 text-[12.5px] font-medium text-fg">{row.partNo}</p>
                <Field label="Install cost per unit">
                  <Input
                    value={row.installCostPerUnit}
                    onChange={(event) =>
                      update(row.key, { installCostPerUnit: event.target.value })
                    }
                    inputMode="decimal"
                  />
                </Field>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove rate for ${row.partNo}`}
                  onClick={() => setRates((current) => current.filter((item) => item.key !== row.key))}
                >
                  <X size={14} aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save rates'}
        </Button>
        {savedAt ? <span className="text-[11.5px] text-fg-muted">Saved at {savedAt}</span> : null}
      </div>
    </form>
  )
}

export function RatesPanel() {
  const [subcontractorId, setSubcontractorId] = useState<number | null>(null)

  const subcontractors = useQuery({
    queryKey: ['tjx', 'subcontractors'],
    queryFn: () => listTjxSubcontractorOptionsFn(),
  })
  const saved = useQuery({
    queryKey: ['tjx', 'rates', subcontractorId],
    queryFn: () => listTjxRatesFn({ data: { subcontractorId: subcontractorId as number } }),
    enabled: subcontractorId !== null,
  })

  return (
    <Card title="Subcontractor parts rates">
      <div className="space-y-4">
        <Field label="Subcontractor" required>
          <Select
            value={subcontractorId === null ? '' : String(subcontractorId)}
            onChange={(event) =>
              setSubcontractorId(event.target.value ? Number(event.target.value) : null)
            }
          >
            <option value="">Choose a subcontractor…</option>
            {subcontractors.data?.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </Select>
        </Field>

        {subcontractors.isError ? <ErrorNote message={subcontractors.error.message} /> : null}
        {subcontractorId === null ? (
          <EmptyNote>Choose a subcontractor to view their TJX parts rates.</EmptyNote>
        ) : saved.isPending ? (
          <EmptyNote>Loading rates…</EmptyNote>
        ) : saved.isError ? (
          <ErrorNote message={saved.error.message} />
        ) : (
          <RatesEditor
            key={subcontractorId}
            subcontractorId={subcontractorId}
            initialRates={saved.data ?? []}
          />
        )}
      </div>
    </Card>
  )
}
