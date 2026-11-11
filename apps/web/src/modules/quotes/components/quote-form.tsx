import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { SALES_TAX_TABLE } from '@cls/pricing'
import { Plus, Trash2 } from 'lucide-react'
import { Button, Card, Field, Input, Select, Textarea, formatMoney } from '../../work-orders/components/ui'
import { searchPartsFn, searchSitesFn } from '../../work-orders/server/work-orders.functions'
import type { SiteLookupOption } from '../../work-orders/types'
import { createQuoteFn, getQuoteFn, updateQuoteFn } from '../server/quotes.functions'
import { quoteTotals } from '../lib/rules'
import type {
  QuoteCreateInput,
  QuoteDetail,
  QuoteKind,
  QuotePartInput,
  QuoteSpecialInput,
} from '../types'

type HourState = NonNullable<QuoteCreateInput['hours']>[number]

const EMPTY_HOUR: HourState = { hours: '0', numTechs: 1, rate: '0', incurredRate: '', note: '' }

const PROVINCES = Object.keys(SALES_TAX_TABLE)

interface HeaderState {
  kind: QuoteKind
  siteId: number | null
  site: SiteLookupOption | null
  workOrderNumber: string
  dueDate: string
  isDueDateTbd: boolean
  taxCode: string
  appliedTaxRate: string
  manualTaxAmount: string
  report: string
  notes: string
  pdfNotes: string
  referenceWoNumber: string
  createdFromLocal: boolean
  saveAsSaved: boolean
}

function initialHeader(detail?: QuoteDetail): HeaderState {
  return {
    kind: detail?.kind ?? 'customer',
    siteId: detail?.siteId ?? null,
    site: detail?.siteName
      ? {
          id: detail.siteId,
          name: detail.siteName,
          customerId: detail.customerId ?? 0,
          customerName: detail.customerName ?? '',
          street: detail.shipStreet1 ?? '',
          city: detail.shipCity ?? '',
          province: detail.shipProvince ?? '',
          postalCode: detail.shipPostalCode ?? '',
        }
      : null,
    workOrderNumber: detail?.workOrderNumber ? String(detail.workOrderNumber) : '',
    dueDate: detail?.dueDate ?? '',
    isDueDateTbd: detail?.isDueDateTbd ?? false,
    taxCode: detail?.taxCode ?? 'ON',
    appliedTaxRate: detail?.appliedTaxRate ?? '',
    manualTaxAmount: detail?.manualTaxAmount ?? '',
    report: detail?.report ?? '',
    notes: detail?.notes ?? '',
    pdfNotes: detail?.pdfNotes ?? '',
    referenceWoNumber: detail?.referenceWoNumber ?? '',
    createdFromLocal: detail?.createdFromLocal ?? false,
    saveAsSaved: detail?.status === 2,
  }
}

export function QuoteForm({ mode, quoteId }: { mode: 'create' | 'edit'; quoteId?: number }) {
  const detail = useQuery({
    queryKey: ['quote', quoteId],
    queryFn: () => getQuoteFn({ data: { id: quoteId! } }),
    enabled: mode === 'edit' && Boolean(quoteId),
  })

  if (mode === 'edit') {
    if (detail.isPending) return <div className="h-[320px] animate-pulse rounded-[6px] bg-subtle" />
    if (detail.isError) return <p role="alert">{(detail.error as Error).message}</p>
    if (!detail.data) return null
    return (
      <QuoteFormFields
        key={detail.data.id}
        mode="edit"
        initial={detail.data}
      />
    )
  }
  return <QuoteFormFields mode="create" />
}

function QuoteFormFields({ mode, initial }: { mode: 'create' | 'edit'; initial?: QuoteDetail }) {
  const navigate = useNavigate()
  const [header, setHeader] = useState<HeaderState>(() => initialHeader(initial))
  const [hours, setHours] = useState<HourState[]>(() =>
    initial?.hours.length
      ? initial.hours.map((line) => ({
          hours: line.hours,
          numTechs: line.numTechs,
          rate: line.rate,
          incurredRate: line.incurredRate ?? '',
          note: line.note ?? '',
          lineDate: line.lineDate ?? '',
        }))
      : [{ ...EMPTY_HOUR }],
  )
  const [parts, setParts] = useState<QuotePartInput[]>(() =>
    initial?.parts.length
      ? initial.parts.map((line) => ({
          partNo: line.partNo,
          description: line.description ?? '',
          qty: line.qty,
          price: line.price,
          costPrice: line.costPrice ?? '',
          isUnderWarranty: line.isUnderWarranty,
        }))
      : [],
  )
  const [specialParts, setSpecialParts] = useState<QuoteSpecialInput[]>(() =>
    initial?.specialParts.length
      ? initial.specialParts.map((line) => ({
          name: line.name,
          qty: line.qty,
          price: line.price,
          costPrice: line.costPrice ?? '',
          isEmergencyLighting: line.isEmergencyLighting,
        }))
      : [],
  )
  const [error, setError] = useState<string | null>(null)

  const totals = quoteTotals({
    taxCode: header.taxCode,
    appliedTaxRate: header.appliedTaxRate || null,
    manualTaxAmount: header.manualTaxAmount || null,
    hours: hours.map((line, index) => ({
      id: index,
      lineDate: line.lineDate ?? null,
      hours: line.hours ?? '0',
      numTechs: line.numTechs ?? 1,
      rateCode: null,
      rate: line.rate ?? '0',
      incurredHours: null,
      incurredRate: line.incurredRate ?? null,
      note: line.note ?? null,
      sortOrder: index,
    })),
    parts: parts.map((line, index) => ({
      id: index,
      partNo: line.partNo,
      description: line.description ?? null,
      qty: line.qty,
      price: line.price,
      costPrice: line.costPrice ?? null,
      isUnderWarranty: Boolean(line.isUnderWarranty),
      sortOrder: index,
    })),
    specialParts: specialParts.map((line, index) => ({
      id: index,
      name: line.name,
      qty: line.qty,
      price: line.price,
      costPrice: line.costPrice ?? null,
      isEmergencyLighting: Boolean(line.isEmergencyLighting),
      sortOrder: index,
    })),
  })

  const save = useMutation({
    mutationFn: async () => {
      if (!header.siteId) throw new Error('Choose a site for this quote.')
      const common = {
        kind: header.kind,
        siteId: header.siteId,
        workOrderNumber: header.workOrderNumber ? Number(header.workOrderNumber) : null,
        dueDate: header.dueDate || null,
        isDueDateTbd: header.isDueDateTbd,
        taxCode: header.taxCode,
        appliedTaxRate: header.appliedTaxRate || null,
        manualTaxAmount: header.manualTaxAmount || null,
        report: header.report,
        notes: header.notes,
        pdfNotes: header.pdfNotes || null,
        referenceWoNumber: header.referenceWoNumber || null,
        createdFromLocal: header.createdFromLocal,
        saveAsSaved: header.kind === 'standalone' && header.saveAsSaved,
        hours: hours.map((line) => ({
          ...line,
          hours: line.hours || '0',
          rate: line.rate || '0',
          numTechs: line.numTechs ?? 1,
          incurredRate: line.incurredRate || null,
          note: line.note || null,
        })),
        parts: parts.map((line) => ({
          ...line,
          price: line.price || '0',
          costPrice: line.costPrice || null,
          description: line.description || null,
        })),
        specialParts: specialParts.map((line) => ({
          ...line,
          price: line.price || '0',
          costPrice: line.costPrice || null,
        })),
      }
      if (mode === 'edit' && initial) {
        return updateQuoteFn({ data: { ...common, id: initial.id, version: initial.version } })
      }
      return createQuoteFn({ data: common })
    },
    onSuccess: (result) => {
      navigate({ to: '/quotes/$id', params: { id: String(result.id) } })
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  })

  const patchHour = (index: number, patch: Partial<HourState>) =>
    setHours((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  const patchPart = (index: number, patch: Partial<QuotePartInput>) =>
    setParts((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  const patchSpecial = (index: number, patch: Partial<QuoteSpecialInput>) =>
    setSpecialParts((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)))

  return (
    <div className="space-y-5">
      <div className="border-b border-hair pb-5 pt-2">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">Sales</p>
        <h1 className="font-serif text-[30px] leading-tight text-fg">
          {mode === 'create' ? 'New quote' : `Edit quote #${initial?.numberLabel ?? ''}`}
        </h1>
        <p className="mt-1 text-[13px] text-fg-secondary">
          Customer quotes reserve a work-order number. Standalone quotes keep their own quote number
          until they are converted.
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-[4px] border border-danger bg-[var(--status-rejected-bg)] p-3 text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      <Card title="Quote header">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Quote type">
            <Select
              value={header.kind}
              disabled={mode === 'edit'}
              onChange={(event) =>
                setHeader((current) => ({ ...current, kind: event.target.value as QuoteKind }))
              }
            >
              <option value="customer">Customer quote</option>
              <option value="standalone">Standalone quote</option>
            </Select>
          </Field>
          <Field label="Site" required>
            <SitePicker
              selected={header.site}
              onSelect={(site) =>
                setHeader((current) => ({
                  ...current,
                  site,
                  siteId: site?.id ?? null,
                  taxCode: site?.province || current.taxCode,
                }))
              }
            />
          </Field>
          <Field
            label="Work-order number"
            hint={
              header.kind === 'customer'
                ? 'Leave blank to reserve the next number from the Work Orders series.'
                : 'Optional reference to an existing work order.'
            }
          >
            <Input
              value={header.workOrderNumber}
              inputMode="numeric"
              onChange={(event) =>
                setHeader((current) => ({ ...current, workOrderNumber: event.target.value.replace(/\D/g, '') }))
              }
            />
          </Field>
          <Field label="Due date" hint="Tick TBD when the date is deliberately undefined.">
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={header.dueDate}
                disabled={header.isDueDateTbd}
                onChange={(event) => setHeader((current) => ({ ...current, dueDate: event.target.value }))}
              />
              <label className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-fg-secondary">
                <input
                  type="checkbox"
                  checked={header.isDueDateTbd}
                  onChange={(event) =>
                    setHeader((current) => ({ ...current, isDueDateTbd: event.target.checked }))
                  }
                />
                TBD
              </label>
            </div>
          </Field>
          <Field label="Tax province">
            <Select
              value={header.taxCode}
              onChange={(event) => setHeader((current) => ({ ...current, taxCode: event.target.value }))}
            >
              {PROVINCES.map((province) => (
                <option key={province} value={province}>
                  {province}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Applied tax rate" hint="Optional override, e.g. 0.13. Blank uses the province table.">
            <Input
              value={header.appliedTaxRate}
              placeholder="0.13"
              onChange={(event) =>
                setHeader((current) => ({ ...current, appliedTaxRate: event.target.value }))
              }
            />
          </Field>
          <Field label="Manual tax amount" hint="Printed exactly as typed, like the legacy quote PDF.">
            <Input
              value={header.manualTaxAmount}
              placeholder="0.00"
              onChange={(event) =>
                setHeader((current) => ({ ...current, manualTaxAmount: event.target.value }))
              }
            />
          </Field>
          {header.kind === 'standalone' ? (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[12.5px] text-fg-secondary">
                <input
                  type="checkbox"
                  checked={header.saveAsSaved}
                  onChange={(event) =>
                    setHeader((current) => ({ ...current, saveAsSaved: event.target.checked }))
                  }
                />
                Save as draft (status 2)
              </label>
              <label className="flex items-center gap-2 text-[12.5px] text-fg-secondary">
                <input
                  type="checkbox"
                  checked={header.createdFromLocal}
                  onChange={(event) =>
                    setHeader((current) => ({ ...current, createdFromLocal: event.target.checked }))
                  }
                />
                Created from local work
              </label>
            </div>
          ) : null}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Scope / report">
            <Textarea
              rows={3}
              value={header.report}
              onChange={(event) => setHeader((current) => ({ ...current, report: event.target.value }))}
            />
          </Field>
          <Field label="Internal notes">
            <Textarea
              rows={3}
              value={header.notes}
              onChange={(event) => setHeader((current) => ({ ...current, notes: event.target.value }))}
            />
          </Field>
          <Field label="Notes for the customer PDF">
            <Textarea
              rows={2}
              value={header.pdfNotes}
              onChange={(event) => setHeader((current) => ({ ...current, pdfNotes: event.target.value }))}
            />
          </Field>
        </div>
      </Card>

      <Card title="Labour">
        <div className="space-y-2">
          {hours.map((line, index) => (
            <div key={index} className="grid items-end gap-2 md:grid-cols-[130px_repeat(4,1fr)_40px]">
              <Field label="Date">
                <Input
                  type="date"
                  value={line.lineDate ?? ''}
                  onChange={(event) => patchHour(index, { lineDate: event.target.value })}
                />
              </Field>
              <Field label="Hours">
                <Input value={line.hours ?? '0'} onChange={(event) => patchHour(index, { hours: event.target.value })} />
              </Field>
              <Field label="Techs">
                <Input
                  type="number"
                  min={1}
                  value={line.numTechs ?? 1}
                  onChange={(event) => patchHour(index, { numTechs: Number(event.target.value) })}
                />
              </Field>
              <Field label="Rate">
                <Input value={line.rate ?? '0'} onChange={(event) => patchHour(index, { rate: event.target.value })} />
              </Field>
              <Field label="Incurred rate">
                <Input
                  value={line.incurredRate ?? ''}
                  onChange={(event) => patchHour(index, { incurredRate: event.target.value })}
                />
              </Field>
              <Button
                variant="ghost"
                aria-label="Remove labour line"
                onClick={() => setHours((current) => current.filter((_, i) => i !== index))}
              >
                <Trash2 size={14} aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button size="sm" onClick={() => setHours((current) => [...current, { ...EMPTY_HOUR }])}>
            <Plus size={13} aria-hidden="true" /> Add labour
          </Button>
        </div>
      </Card>

      <Card title="Parts">
        <div className="space-y-2">
          {parts.map((line, index) => (
            <div key={index} className="grid items-end gap-2 md:grid-cols-[1fr_2fr_90px_110px_110px_40px]">
              <Field label="Part">
                <PartInput
                  value={line.partNo}
                  onValue={(value) => patchPart(index, { partNo: value })}
                  onPick={(part) =>
                    patchPart(index, {
                      partNo: part.partNo,
                      description: line.description || part.description,
                      price: part.price ?? line.price,
                    })
                  }
                />
              </Field>
              <Field label="Description">
                <Input
                  value={line.description ?? ''}
                  onChange={(event) => patchPart(index, { description: event.target.value })}
                />
              </Field>
              <Field label="Qty">
                <Input
                  type="number"
                  value={line.qty}
                  onChange={(event) => patchPart(index, { qty: Number(event.target.value) })}
                />
              </Field>
              <Field label="Price">
                <Input value={line.price} onChange={(event) => patchPart(index, { price: event.target.value })} />
              </Field>
              <Field label="Incurred price">
                <Input
                  value={line.costPrice ?? ''}
                  onChange={(event) => patchPart(index, { costPrice: event.target.value })}
                />
              </Field>
              <Button
                variant="ghost"
                aria-label="Remove part line"
                onClick={() => setParts((current) => current.filter((_, i) => i !== index))}
              >
                <Trash2 size={14} aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            onClick={() =>
              setParts((current) => [
                ...current,
                { partNo: '', description: '', qty: 1, price: '0.00', costPrice: '' },
              ])
            }
          >
            <Plus size={13} aria-hidden="true" /> Add part
          </Button>
        </div>
      </Card>

      <Card title="Special-order parts">
        <div className="space-y-2">
          {specialParts.map((line, index) => (
            <div key={index} className="grid items-end gap-2 md:grid-cols-[2fr_90px_110px_110px_40px]">
              <Field label="Description">
                <Input
                  value={line.name}
                  onChange={(event) => patchSpecial(index, { name: event.target.value })}
                />
              </Field>
              <Field label="Qty">
                <Input
                  type="number"
                  value={line.qty}
                  onChange={(event) => patchSpecial(index, { qty: Number(event.target.value) })}
                />
              </Field>
              <Field label="Price">
                <Input value={line.price} onChange={(event) => patchSpecial(index, { price: event.target.value })} />
              </Field>
              <Field label="Incurred price">
                <Input
                  value={line.costPrice ?? ''}
                  onChange={(event) => patchSpecial(index, { costPrice: event.target.value })}
                />
              </Field>
              <Button
                variant="ghost"
                aria-label="Remove special part line"
                onClick={() => setSpecialParts((current) => current.filter((_, i) => i !== index))}
              >
                <Trash2 size={14} aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            onClick={() =>
              setSpecialParts((current) => [
                ...current,
                { name: '', qty: 1, price: '0.00', costPrice: '' },
              ])
            }
          >
            <Plus size={13} aria-hidden="true" /> Add special-order part
          </Button>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="text-[12px] text-fg-muted">
          Incurred columns are cost only; they never enter the customer subtotal. Margin is shown for
          internal pricing.
        </div>
        <Card title="Preview totals">
          <dl className="space-y-1 text-[13px]">
            <Row label="Labour" value={formatMoney(totals.labour)} />
            <Row label="Material" value={formatMoney(totals.material)} />
            <Row label="Subtotal" value={formatMoney(totals.subtotal)} />
            <Row label={`Tax (${totals.taxProvince})`} value={formatMoney(totals.tax)} />
            <div className="flex justify-between border-t border-strong pt-1 text-[15px] font-semibold">
              <dt>Total</dt>
              <dd>{formatMoney(totals.total)}</dd>
            </div>
            <Row label="Incurred" value={formatMoney(totals.incurredSubtotal)} />
            <Row label={`Margin (${totals.marginPercent}%)`} value={formatMoney(totals.margin)} />
          </dl>
        </Card>
      </div>

      <div className="flex justify-end gap-2 border-t border-hair pt-4">
        <Button
          variant="primary"
          disabled={save.isPending}
          onClick={() => {
            setError(null)
            save.mutate()
          }}
        >
          {save.isPending ? 'Saving…' : mode === 'create' ? 'Create quote' : 'Save quote'}
        </Button>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-fg-secondary">{label}</dt>
      <dd className="tabular-nums text-fg">{value}</dd>
    </div>
  )
}

function SitePicker({
  selected,
  onSelect,
}: {
  selected: SiteLookupOption | null
  onSelect: (site: SiteLookupOption | null) => void
}) {
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const results = useQuery({
    queryKey: ['quote-site-search', term],
    queryFn: () => searchSitesFn({ data: { search: term, limit: 10 } }),
    enabled: open,
  })
  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-[4px] border border-hair bg-subtle px-3 py-2">
        <div>
          <p className="text-[13px] font-medium">{selected.name}</p>
          <p className="text-[11.5px] text-fg-muted">
            {selected.customerName || 'No billing customer'} · {selected.city}, {selected.province}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>
          Change
        </Button>
      </div>
    )
  }
  return (
    <div className="relative">
      <Input
        placeholder="Search sites or customers…"
        value={term}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setTerm(event.target.value)
          setOpen(true)
        }}
      />
      {open ? (
        <div className="absolute z-20 mt-1 max-h-[240px] w-full overflow-y-auto rounded-[4px] border border-hair bg-canvas shadow-md">
          {results.isPending ? (
            <p className="px-3 py-2 text-[12px] text-fg-muted">Searching…</p>
          ) : (results.data ?? []).length === 0 ? (
            <p className="px-3 py-2 text-[12px] text-fg-muted">No sites match.</p>
          ) : (
            (results.data ?? []).map((site) => (
              <button
                key={site.id}
                type="button"
                className="block w-full border-b border-hair px-3 py-2 text-left last:border-0 hover:bg-subtle"
                onClick={() => {
                  onSelect(site)
                  setOpen(false)
                }}
              >
                <span className="block text-[12.5px] font-medium">{site.name}</span>
                <span className="block text-[11.5px] text-fg-muted">
                  {site.customerName || 'No billing customer'} · {site.city}, {site.province}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

function PartInput({
  value,
  onValue,
  onPick,
}: {
  value: string
  onValue: (value: string) => void
  onPick: (part: { partNo: string; description: string; price: string | null }) => void
}) {
  const [term, setTerm] = useState(value)
  const [open, setOpen] = useState(false)
  const results = useQuery({
    queryKey: ['quote-part-search', term],
    queryFn: () => searchPartsFn({ data: { search: term, limit: 8 } }),
    enabled: open,
  })
  return (
    <div className="relative">
      <Input
        value={term}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setTerm(event.target.value)
          onValue(event.target.value)
          setOpen(true)
        }}
      />
      {open ? (
        <div className="absolute z-20 mt-1 max-h-[220px] w-full overflow-y-auto rounded-[4px] border border-hair bg-canvas shadow-md">
          {(results.data ?? []).map((part) => (
            <button
              key={part.partNo}
              type="button"
              className="block w-full border-b border-hair px-3 py-2 text-left last:border-0 hover:bg-subtle"
              onClick={() => {
                setTerm(part.partNo)
                onPick(part)
                setOpen(false)
              }}
            >
              <span className="block text-[12px] font-medium">{part.partNo}</span>
              <span className="block text-[11px] text-fg-muted">
                {part.description} {part.price ? `· $${part.price}` : ''}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
