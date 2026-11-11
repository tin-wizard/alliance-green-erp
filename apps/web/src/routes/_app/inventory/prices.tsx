import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Lock, LockOpen, Search } from 'lucide-react'
import {
  Button,
  Card,
  ErrorPanel,
  Field,
  Input,
  formatDateTime,
} from '../../../modules/work-orders/components/ui'
import {
  acquirePriceLockFn,
  getPartPriceEditorFn,
  getPriceLockStateFn,
  refreshPriceLockFn,
  releasePriceLockFn,
  savePricesFn,
  searchPricePartsFn,
} from '../../../modules/inventory/server/inventory.functions'
import { getSessionFn } from '../../../server/auth.functions'

export const Route = createFileRoute('/_app/inventory/prices')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/inventory/prices' } })
    return { session }
  },
  component: PriceEditorPage,
})

interface PriceForm {
  cost: string
  sellPrice: string
  installPrice: string
  recyclePrice: string
}

interface RateForm {
  id: string
  costPrice: string
  sellPrice: string
  installPrice: string
  recyclePrice: string
  markup: string
}

function toRateForm(row: {
  id: string
  costPrice?: string | null
  sellPrice?: string | null
  installPrice?: string | null
  recyclePrice?: string | null
  markup?: string | null
}): RateForm {
  return {
    id: row.id,
    costPrice: row.costPrice ?? '',
    sellPrice: row.sellPrice ?? '',
    installPrice: row.installPrice ?? '',
    recyclePrice: row.recyclePrice ?? '',
    markup: row.markup ?? '',
  }
}

function remainingText(expiresAt: string | null, now: number): string {
  if (!expiresAt) return 'no expiry'
  const seconds = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

type EditorData = Awaited<ReturnType<typeof getPartPriceEditorFn>>

function PriceEditorForm({ data, heldByMe }: { data: EditorData; heldByMe: boolean }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<PriceForm>({
    cost: data.part.cost ?? '',
    sellPrice: data.part.sellPrice ?? '',
    installPrice: data.part.installPrice ?? '',
    recyclePrice: data.part.recyclePrice ?? '',
  })
  const [supplierRates, setSupplierRates] = useState<RateForm[]>(data.supplierRates.map(toRateForm))
  const [sellingRates, setSellingRates] = useState<RateForm[]>(data.sellingRates.map(toRateForm))
  const [saved, setSaved] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () =>
      savePricesFn({
        data: {
          partId: data.part.id,
          fields: {
            cost: form.cost || null,
            sellPrice: form.sellPrice || null,
            installPrice: form.installPrice || null,
            recyclePrice: form.recyclePrice || null,
          },
          supplierRates: supplierRates.map((row) => ({
            id: row.id,
            costPrice: row.costPrice || null,
            sellPrice: row.sellPrice || null,
            installPrice: row.installPrice || null,
            recyclePrice: row.recyclePrice || null,
            markup: row.markup || null,
          })),
          sellingRates: sellingRates.map((row) => ({
            id: row.id,
            sellPrice: row.sellPrice || null,
            installPrice: row.installPrice || null,
            recyclePrice: row.recyclePrice || null,
          })),
        },
      }),
    onSuccess: (result) => {
      setSaved(`Saved ${result.changed} price field${result.changed === 1 ? '' : 's'}.`)
      void queryClient.invalidateQueries({ queryKey: ['price-editor', data.part.id] })
      void queryClient.invalidateQueries({ queryKey: ['price-parts'] })
    },
  })

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Cost">
          <Input
            data-testid="price-cost"
            inputMode="decimal"
            value={form.cost}
            onChange={(event) => setForm({ ...form, cost: event.target.value })}
          />
        </Field>
        <Field label="Selling price">
          <Input
            data-testid="price-sell"
            inputMode="decimal"
            value={form.sellPrice}
            onChange={(event) => setForm({ ...form, sellPrice: event.target.value })}
          />
        </Field>
        <Field label="Install price">
          <Input
            data-testid="price-install"
            inputMode="decimal"
            value={form.installPrice}
            onChange={(event) => setForm({ ...form, installPrice: event.target.value })}
          />
        </Field>
        <Field label="Recycle price">
          <Input
            data-testid="price-recycle"
            inputMode="decimal"
            value={form.recyclePrice}
            onChange={(event) => setForm({ ...form, recyclePrice: event.target.value })}
          />
        </Field>
      </div>

      {supplierRates.length > 0 ? (
        <div>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted">
            Supplier rate cards
          </h3>
          <div className="space-y-2">
            {supplierRates.map((row, index) => (
              <div key={row.id} className="grid gap-2 sm:grid-cols-5">
                <Input
                  aria-label={`Supplier cost ${index + 1}`}
                  placeholder="Cost"
                  value={row.costPrice}
                  onChange={(event) =>
                    setSupplierRates(
                      supplierRates.map((item, at) =>
                        at === index ? { ...item, costPrice: event.target.value } : item,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={`Supplier sell ${index + 1}`}
                  placeholder="Sell"
                  value={row.sellPrice}
                  onChange={(event) =>
                    setSupplierRates(
                      supplierRates.map((item, at) =>
                        at === index ? { ...item, sellPrice: event.target.value } : item,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={`Supplier install ${index + 1}`}
                  placeholder="Install"
                  value={row.installPrice}
                  onChange={(event) =>
                    setSupplierRates(
                      supplierRates.map((item, at) =>
                        at === index ? { ...item, installPrice: event.target.value } : item,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={`Supplier recycle ${index + 1}`}
                  placeholder="Recycle"
                  value={row.recyclePrice}
                  onChange={(event) =>
                    setSupplierRates(
                      supplierRates.map((item, at) =>
                        at === index ? { ...item, recyclePrice: event.target.value } : item,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={`Supplier markup ${index + 1}`}
                  placeholder="Markup"
                  value={row.markup}
                  onChange={(event) =>
                    setSupplierRates(
                      supplierRates.map((item, at) =>
                        at === index ? { ...item, markup: event.target.value } : item,
                      ),
                    )
                  }
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {sellingRates.length > 0 ? (
        <div>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted">
            Selling rate cards
          </h3>
          <div className="space-y-2">
            {sellingRates.map((row, index) => (
              <div key={row.id} className="grid gap-2 sm:grid-cols-3">
                <Input
                  aria-label={`Selling price ${index + 1}`}
                  placeholder="Sell"
                  value={row.sellPrice}
                  onChange={(event) =>
                    setSellingRates(
                      sellingRates.map((item, at) =>
                        at === index ? { ...item, sellPrice: event.target.value } : item,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={`Selling install ${index + 1}`}
                  placeholder="Install"
                  value={row.installPrice}
                  onChange={(event) =>
                    setSellingRates(
                      sellingRates.map((item, at) =>
                        at === index ? { ...item, installPrice: event.target.value } : item,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={`Selling recycle ${index + 1}`}
                  placeholder="Recycle"
                  value={row.recyclePrice}
                  onChange={(event) =>
                    setSellingRates(
                      sellingRates.map((item, at) =>
                        at === index ? { ...item, recyclePrice: event.target.value } : item,
                      ),
                    )
                  }
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {save.error ? <ErrorPanel message={save.error.message} /> : null}
      {saved ? (
        <p data-testid="price-save-result" className="text-[12.5px] text-emerald-700">
          {saved}
        </p>
      ) : null}
      <Button data-testid="price-save" type="submit" disabled={!heldByMe || save.isPending}>
        {save.isPending ? 'Saving…' : 'Save prices'}
      </Button>
      {!heldByMe ? (
        <p className="text-[12px] text-fg-muted">
          Acquire the lock to enable saving. Another editor cannot save while you hold it.
        </p>
      ) : null}
    </form>
  )
}

function PriceEditorPage() {
  const queryClient = useQueryClient()
  const [term, setTerm] = useState('')
  const [search, setSearch] = useState('')
  const [partId, setPartId] = useState<number | null>(null)
  const [lockError, setLockError] = useState<string | null>(null)
  const [takeoverReason, setTakeoverReason] = useState('')
  const [now, setNow] = useState(() => Date.now())

  const searchQuery = useQuery({
    queryKey: ['price-parts', search],
    queryFn: () => searchPricePartsFn({ data: { search } }),
  })
  const lockQuery = useQuery({
    queryKey: ['price-lock'],
    queryFn: () => getPriceLockStateFn({ data: {} }),
    refetchInterval: 15_000,
  })
  const editorQuery = useQuery({
    queryKey: ['price-editor', partId],
    queryFn: () => getPartPriceEditorFn({ data: { partId: partId! } }),
    enabled: partId !== null,
  })

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])

  const locallyExpired = Boolean(
    lockQuery.data?.expiresAt && new Date(lockQuery.data.expiresAt).getTime() <= now,
  )
  const heldByMe = Boolean(lockQuery.data?.heldByMe && !locallyExpired)
  const exhausted = Boolean(lockQuery.data?.isLocked && (lockQuery.data.expired || locallyExpired))

  useEffect(() => {
    if (!heldByMe) return
    const timer = setInterval(() => {
      void refreshPriceLockFn({ data: {} })
        .then((state) => queryClient.setQueryData(['price-lock'], state))
        .catch(() => void queryClient.invalidateQueries({ queryKey: ['price-lock'] }))
    }, 60_000)
    return () => clearInterval(timer)
  }, [heldByMe, queryClient])

  const acquire = useMutation({
    mutationFn: (takeOver: boolean) =>
      acquirePriceLockFn({
        data: { takeOver, reason: takeOver ? takeoverReason.trim() : null },
      }),
    onSuccess: (state) => {
      queryClient.setQueryData(['price-lock'], state)
      setLockError(null)
      setTakeoverReason('')
    },
    onError: (error: Error) => setLockError(error.message),
  })

  const release = useMutation({
    mutationFn: () => releasePriceLockFn({ data: {} }),
    onSuccess: (state) => {
      queryClient.setQueryData(['price-lock'], state)
    },
    onError: (error: Error) => setLockError(error.message),
  })

  const lockMessage = useMemo(() => {
    const lock = lockQuery.data
    if (!lock) return 'Checking lock…'
    if (lock.isLocked && lock.heldByMe && !locallyExpired)
      return `You hold the editor lock · ${remainingText(lock.expiresAt, now)} left`
    if (lock.isLocked && lock.heldByMe && locallyExpired)
      return `Your price lock expired at ${lock.expiresAt ?? 'an unknown time'}. Acquire it again; it was not renewed silently.`
    if (lock.isLocked) {
      return `${lock.lockedByName ?? lock.lockedBy} holds the editor lock · ${
        exhausted ? 'expired' : `${remainingText(lock.expiresAt, now)} left`
      }`
    }
    return 'Editor unlocked'
  }, [lockQuery.data, now, locallyExpired, exhausted])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hair pb-5 pt-2">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">
            Inventory
          </p>
          <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">
            Price editor
          </h1>
          <p className="mt-1 max-w-[70ch] text-[13.5px] text-fg-secondary">
            One global editor lock covers every price field. The lock expires visibly after 15
            minutes; keep this page open to renew it, and take it over explicitly when it lapses.
          </p>
        </div>
        <Link to="/inventory" className="text-[13px] text-brand underline">
          Back to stock
        </Link>
      </div>

      <div
        data-testid="price-lock-panel"
        className="flex flex-wrap items-center gap-2 rounded-[5px] border border-hair bg-surface px-3 py-2"
      >
        {heldByMe ? (
          <Lock size={15} className="text-emerald-700" aria-hidden="true" />
        ) : (
          <LockOpen size={15} className="text-fg-muted" aria-hidden="true" />
        )}
        <span data-testid="price-lock-status" className="text-[13px] font-medium text-fg">
          {lockMessage}
        </span>
        {heldByMe ? (
          <Button
            data-testid="price-lock-release"
            variant="ghost"
            onClick={() => release.mutate()}
            disabled={release.isPending}
          >
            Release lock
          </Button>
        ) : (
          <Button
            data-testid="price-lock-acquire"
            onClick={() => acquire.mutate(false)}
            disabled={acquire.isPending || (lockQuery.data?.isLocked === true && !exhausted)}
          >
            Acquire lock
          </Button>
        )}
        {lockQuery.data?.isLocked && !heldByMe && !lockQuery.data.heldByMe && exhausted ? (
          <>
            <Input
              data-testid="price-takeover-reason"
              aria-label="Takeover reason"
              placeholder="Why are you taking over?"
              value={takeoverReason}
              onChange={(event) => setTakeoverReason(event.target.value)}
              className="max-w-[260px]"
            />
            <Button
              data-testid="price-lock-takeover"
              onClick={() => acquire.mutate(true)}
              disabled={acquire.isPending}
            >
              Take over expired lock
            </Button>
          </>
        ) : null}
      </div>
      {lockError ? <ErrorPanel message={lockError} /> : null}

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card title="Choose a part">
          <form
            className="mb-3 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              setSearch(term.trim())
            }}
          >
            <Input
              data-testid="price-part-search"
              aria-label="Search parts to price"
              placeholder="Part number…"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />
            <Button type="submit" aria-label="Search">
              <Search size={14} aria-hidden="true" />
            </Button>
          </form>
          {searchQuery.isPending ? <p className="text-[12.5px] text-fg-muted">Searching…</p> : null}
          {searchQuery.error ? <ErrorPanel message={searchQuery.error.message} /> : null}
          <ul className="max-h-[420px] divide-y divide-hair overflow-auto">
            {(searchQuery.data ?? []).map((part) => (
              <li key={part.id}>
                <button
                  type="button"
                  data-testid={`price-part-${part.partNumber}`}
                  onClick={() => setPartId(part.id)}
                  className={`w-full px-1 py-2 text-left text-[12.5px] ${
                    partId === part.id ? 'font-semibold text-brand' : 'text-fg'
                  }`}
                >
                  <span className="font-mono">{part.partNumber}</span>
                  {part.name && part.name !== part.partNumber ? (
                    <span className="ml-2 text-fg-muted">{part.name}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          {searchQuery.data?.length === 0 ? (
            <p className="text-[12.5px] text-fg-muted">No matching parts.</p>
          ) : null}
        </Card>

        <Card title={editorQuery.data ? `Prices · ${editorQuery.data.part.partNumber}` : 'Prices'}>
          {partId === null ? (
            <p className="text-[13px] text-fg-muted">Choose a part to edit its prices.</p>
          ) : null}
          {editorQuery.isPending && partId !== null ? (
            <p className="text-[13px] text-fg-muted">Loading prices…</p>
          ) : null}
          {editorQuery.error ? <ErrorPanel message={editorQuery.error.message} /> : null}
          {editorQuery.data ? (
            <PriceEditorForm
              key={`${partId}:${editorQuery.data.part.updatedAt}`}
              data={editorQuery.data}
              heldByMe={heldByMe}
            />
          ) : null}

          {editorQuery.data && editorQuery.data.history.length > 0 ? (
            <div className="mt-5 border-t border-hair pt-3">
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted">
                Price history
              </h3>
              <ul className="space-y-1 text-[12px]">
                {editorQuery.data.history.slice(0, 12).map((row) => (
                  <li key={row.id} className="flex gap-2">
                    <span className="text-fg-muted">{formatDateTime(row.changedAt)}</span>
                    <span className="font-medium">{row.fieldName}</span>
                    <span>
                      {row.lastValue ?? '—'} → {row.newValue ?? '—'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  )
}
