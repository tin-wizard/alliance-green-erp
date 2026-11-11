import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { Button, Card, Field, Input, Select, Tag, Textarea, formatDate } from './ui'
import {
  createWorkOrderFn,
  listLookupsFn,
  searchSitesFn,
  searchSubcontractorsFn,
  updateWorkOrderFn,
} from '../server/work-orders.functions'
import type {
  SiteLookupOption,
  SubcontractorLookupOption,
  WorkOrderCreateInput,
  WorkOrderDetail,
  WorkOrderSeries,
} from '../types'

interface FormValues {
  siteId: number | null
  serviceTypeId: number
  priorityId: number
  categoryId: number | null
  expectedCompletion: string
  dateTaken: string
  serviceRequired: string
  notes: string
  subcontractorId: number | null
  securityCode: string
  customerPo: string
  isLocal: boolean
  isProject: boolean
  isTjxQuote: boolean
  isPmaOrder: boolean
  wsibOverride: boolean
}

function initialValues(detail: WorkOrderDetail | undefined): FormValues {
  return {
    siteId: detail?.siteId ?? null,
    serviceTypeId: detail?.serviceTypeId ?? 1,
    priorityId: detail?.priorityId ?? 3,
    categoryId: detail?.categoryId ?? null,
    expectedCompletion: detail?.expectedCompletion ?? '',
    dateTaken: detail?.dateTaken ?? new Date().toISOString().slice(0, 10),
    serviceRequired: detail?.serviceRequired ?? '',
    notes: detail?.notes ?? '',
    subcontractorId: detail?.subcontractor?.id ?? null,
    securityCode: '',
    customerPo: detail?.customerPo ?? '',
    isLocal: detail?.isLocal ?? false,
    isProject: detail?.isProject ?? false,
    isTjxQuote: detail?.isTjxQuote ?? false,
    isPmaOrder: detail?.isPmaOrder ?? false,
    wsibOverride: false,
  }
}

export function WorkOrderForm({
  mode,
  series = 1,
  detail,
  onSaved,
  onCancel,
}: {
  mode: 'create' | 'edit'
  series?: WorkOrderSeries
  detail?: WorkOrderDetail
  onSaved: (id: number) => void
  onCancel?: () => void
}) {
  const [site, setSite] = useState<SiteLookupOption | null>(
    detail?.site
      ? {
          id: detail.site.id,
          name: detail.site.name,
          street: detail.site.street,
          city: detail.site.city,
          province: detail.site.province,
          postalCode: detail.site.postalCode,
          customerId: detail.site.customerId ?? 0,
          customerName: detail.site.customerName ?? '',
        }
      : null,
  )
  const [subcontractor, setSubcontractor] = useState<SubcontractorLookupOption | null>(
    detail?.subcontractor
      ? {
          id: detail.subcontractor.id,
          name: detail.subcontractor.name,
          city: null,
          province: null,
          email: null,
          wsibValid: detail.wsib.valid,
          wsibExpirationDate: detail.wsib.expirationDate,
        }
      : null,
  )
  const [error, setError] = useState<string | null>(null)

  const lookups = useQuery({
    queryKey: ['work-order-lookups'],
    queryFn: () => listLookupsFn(),
    staleTime: 120_000,
  })

  const create = useMutation({
    mutationFn: (value: FormValues) => {
      const input: WorkOrderCreateInput = {
        series,
        siteId: value.siteId as number,
        serviceTypeId: value.serviceTypeId,
        priorityId: value.priorityId,
        categoryId: value.categoryId ?? null,
        expectedCompletion: value.expectedCompletion || null,
        dateTaken: value.dateTaken || null,
        serviceRequired: value.serviceRequired,
        notes: value.notes || null,
        subcontractorId: value.subcontractorId ?? null,
        securityCode: value.securityCode || null,
        customerPo: value.customerPo || null,
        isLocal: value.isLocal,
        isProject: value.isProject,
        isTjxQuote: value.isTjxQuote,
        isPmaOrder: value.isPmaOrder,
        wsibOverride: value.wsibOverride,
      }
      return createWorkOrderFn({ data: input })
    },
    onSuccess: (result) => onSaved(result.id),
    onError: (mutationError: Error) => setError(mutationError.message),
  })

  const update = useMutation({
    mutationFn: (value: FormValues) => {
      if (!detail) throw new Error('Missing work order.')
      return updateWorkOrderFn({
        data: {
          id: detail.id,
          version: detail.version,
          siteId: value.siteId as number,
          serviceTypeId: value.serviceTypeId,
          priorityId: value.priorityId,
          categoryId: value.categoryId ?? null,
          expectedCompletion: value.expectedCompletion || null,
          dateTaken: value.dateTaken || undefined,
          serviceRequired: value.serviceRequired,
          notes: value.notes || null,
          subcontractorId: value.subcontractorId ?? null,
          securityCode: value.securityCode || null,
          customerPo: value.customerPo || null,
          isLocal: value.isLocal,
          isProject: value.isProject,
          isTjxQuote: value.isTjxQuote,
          isPmaOrder: value.isPmaOrder,
          wsibOverride: value.wsibOverride,
        },
      })
    },
    onSuccess: () => onSaved(detail!.id),
    onError: (mutationError: Error) => setError(mutationError.message),
  })

  const form = useForm({
    defaultValues: initialValues(detail),
    onSubmit: async ({ value }) => {
      setError(null)
      if (!value.siteId) {
        setError('Choose a site before saving.')
        return
      }
      if (mode === 'create') await create.mutateAsync(value)
      else await update.mutateAsync(value)
    },
  })

  const submitting = create.isPending || update.isPending

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
      className="space-y-5"
    >
      {error ? (
        <div
          role="alert"
          className="rounded-[4px] border border-[var(--status-rejected-bd)] bg-[var(--status-rejected-bg)] px-3 py-2 text-[12.5px] text-[var(--status-rejected-fg)]"
        >
          {error}
        </div>
      ) : null}

      <Card title="Site and job">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <form.Field name="siteId">
              {(field) => (
                <Field
                  label="Site"
                  required
                  hint="Work orders belong to a service site, not a billing customer."
                >
                  <SitePicker
                    selected={site}
                    onSelect={(next) => {
                      setSite(next)
                      field.handleChange(next?.id ?? null)
                    }}
                  />
                </Field>
              )}
            </form.Field>
          </div>

          <form.Field name="serviceTypeId">
            {(field) => (
              <Field label="Service type" required>
                <Select
                  value={field.state.value}
                  onChange={(event) => field.handleChange(Number(event.target.value))}
                >
                  {(lookups.data?.serviceTypes ?? []).map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </form.Field>

          <form.Field name="priorityId">
            {(field) => (
              <Field label="Priority" required>
                <Select
                  value={field.state.value}
                  onChange={(event) => field.handleChange(Number(event.target.value))}
                >
                  {(lookups.data?.priorities ?? []).map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </form.Field>

          <form.Field name="categoryId">
            {(field) => (
              <Field label="Category">
                <Select
                  value={field.state.value ?? ''}
                  onChange={(event) =>
                    field.handleChange(event.target.value ? Number(event.target.value) : null)
                  }
                >
                  <option value="">No category</option>
                  {(lookups.data?.categories ?? []).map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </form.Field>

          <form.Field name="dateTaken">
            {(field) => (
              <Field label="Date taken">
                <Input
                  type="date"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="expectedCompletion">
            {(field) => (
              <Field label="Expected completion">
                <Input
                  type="date"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>

          <form.Field name="customerPo">
            {(field) => (
              <Field label="Customer PO">
                <Input
                  value={field.state.value}
                  placeholder="PO reference"
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>

          <div className="md:col-span-2">
            <form.Field name="serviceRequired">
              {(field) => (
                <Field label="Service required" required>
                  <Textarea
                    value={field.state.value}
                    placeholder="What the site needs, including access notes."
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </Field>
              )}
            </form.Field>
          </div>

          <form.Field name="notes">
            {(field) => (
              <Field label="Internal notes" className="md:col-span-2">
                <Textarea
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
        </div>
      </Card>

      <Card title="Assignment">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <form.Field name="subcontractorId">
              {(field) => (
                <Field
                  label="Subcontractor"
                  hint="Dispatch requires an assigned subcontractor with valid WSIB/insurance."
                >
                  <SubcontractorPicker
                    selected={subcontractor}
                    onSelect={(next) => {
                      setSubcontractor(next)
                      field.handleChange(next?.id ?? null)
                    }}
                  />
                </Field>
              )}
            </form.Field>
          </div>
          <div className="space-y-3">
            <form.Field name="securityCode">
              {(field) => (
                <Field label="Site security code">
                  <Input
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </Field>
              )}
            </form.Field>
            <form.Field name="wsibOverride">
              {(field) => (
                <label className="flex items-start gap-2 text-[12.5px] text-fg-secondary">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={field.state.value}
                    onChange={(event) => field.handleChange(event.target.checked)}
                  />
                  <span>
                    Assign without a valid WSIB document. Requires the scoped
                    <code className="mx-1 font-mono text-[11.5px]">workorder:override_wsib_hold</code>
                    permission.
                  </span>
                </label>
              )}
            </form.Field>
          </div>
        </div>
      </Card>

      <Card title="Flags">
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ['isLocal', 'Local work order', 'In-house technicians, local time and signatures.'],
              ['isProject', 'Project work order', 'Sage project accounting flavour.'],
              ['isTjxQuote', 'TJX quote', 'Generated from a TJX fixture quote.'],
              ['isPmaOrder', 'PMA order', 'Preventive-maintenance agreement.'],
            ] as const
          ).map(([name, label, hint]) => (
            <form.Field key={name} name={name}>
              {(field) => (
                <label className="flex items-start gap-2 rounded-[4px] border border-hair px-3 py-2 text-[12.5px]">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={field.state.value}
                    onChange={(event) => field.handleChange(event.target.checked)}
                  />
                  <span>
                    <span className="block font-medium text-fg">{label}</span>
                    <span className="block text-[11.5px] text-fg-muted">{hint}</span>
                  </span>
                </label>
              )}
            </form.Field>
          ))}
        </div>
      </Card>

      <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-hair bg-app/95 py-3 backdrop-blur">
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Saving…' : mode === 'create' ? 'Create work order' : 'Save changes'}
        </Button>
      </div>
    </form>
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
    queryKey: ['site-search', term],
    queryFn: () => searchSitesFn({ data: { search: term, limit: 10 } }),
    enabled: open,
  })

  return (
    <div className="relative">
      {selected ? (
        <div className="flex items-center justify-between gap-2 rounded-[4px] border border-hair bg-subtle px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-fg">{selected.name}</p>
            <p className="truncate text-[11.5px] text-fg-muted">
              {selected.customerName} · {selected.street}, {selected.city} {selected.province}
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>
            Change
          </Button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint"
              aria-hidden="true"
            />
            <Input
              className="pl-8"
              placeholder="Search sites or customers…"
              value={term}
              onFocus={() => setOpen(true)}
              onChange={(event) => {
                setTerm(event.target.value)
                setOpen(true)
              }}
            />
          </div>
          {open ? (
            <div className="absolute z-20 mt-1 max-h-[260px] w-full overflow-y-auto rounded-[4px] border border-hair bg-canvas shadow-md">
              {results.isPending ? (
                <p className="px-3 py-2 text-[12px] text-fg-muted">Searching…</p>
              ) : (results.data ?? []).length === 0 ? (
                <p className="px-3 py-2 text-[12px] text-fg-muted">
                  No sites match. Master data has not been loaded into this environment yet.
                </p>
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
                    <span className="block text-[12.5px] font-medium text-fg">{site.name}</span>
                    <span className="block text-[11.5px] text-fg-muted">
                      {site.customerName} · {site.street}, {site.city} {site.province}
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function SubcontractorPicker({
  selected,
  onSelect,
}: {
  selected: SubcontractorLookupOption | null
  onSelect: (subcontractor: SubcontractorLookupOption | null) => void
}) {
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const results = useQuery({
    queryKey: ['subcontractor-search', term],
    queryFn: () => searchSubcontractorsFn({ data: { search: term, limit: 10 } }),
    enabled: open,
  })

  return (
    <div className="relative">
      {selected ? (
        <div className="flex items-center justify-between gap-2 rounded-[4px] border border-hair bg-subtle px-3 py-2">
          <div>
            <p className="text-[13px] font-medium text-fg">{selected.name}</p>
            <div className="mt-1 flex items-center gap-2">
              {selected.wsibValid ? (
                <Tag tone="info">WSIB valid</Tag>
              ) : (
                <Tag tone="danger">WSIB missing or expired</Tag>
              )}
              {selected.wsibExpirationDate ? (
                <span className="text-[11px] text-fg-muted">
                  Expires {formatDate(selected.wsibExpirationDate)}
                </span>
              ) : null}
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>
            Change
          </Button>
        </div>
      ) : (
        <>
          <Input
            placeholder="Search subcontractors…"
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
                <p className="px-3 py-2 text-[12px] text-fg-muted">No subcontractors match.</p>
              ) : (
                (results.data ?? []).map((subcontractor) => (
                  <button
                    key={subcontractor.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-2 border-b border-hair px-3 py-2 text-left last:border-0 hover:bg-subtle"
                    onClick={() => {
                      onSelect(subcontractor)
                      setOpen(false)
                    }}
                  >
                    <span className="text-[12.5px] text-fg">{subcontractor.name}</span>
                    {subcontractor.wsibValid ? (
                      <Tag tone="info">WSIB</Tag>
                    ) : (
                      <Tag tone="danger">No WSIB</Tag>
                    )}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
