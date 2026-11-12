import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Field, Input, Select } from '../../work-orders/components/ui'
import {
  convertTjxQuoteFn,
  linkTjxWorkOrderFn,
  listTjxWorkOrderLookupsFn,
  unlinkTjxWorkOrderFn,
} from '../server/quotes.functions'
import type { TjxQuoteDetail } from '../types'
import { EmptyNote, ErrorNote } from './master-ui'

export function TjxQuoteWorkOrders({ quote }: { quote: TjxQuoteDetail }) {
  const queryClient = useQueryClient()
  const [serviceTypeId, setServiceTypeId] = useState('')
  const [priorityId, setPriorityId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [serviceRequired, setServiceRequired] = useState(
    `TJX fixture installation — TJX-${quote.id}`,
  )
  const [attachId, setAttachId] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const lookups = useQuery({
    queryKey: ['tjx', 'work-order-lookups'],
    queryFn: () => listTjxWorkOrderLookupsFn(),
  })

  const refresh = (saved: TjxQuoteDetail) => {
    queryClient.setQueryData(['tjx', 'quote', saved.id], saved)
    void queryClient.invalidateQueries({ queryKey: ['tjx', 'quotes'] })
  }

  const convert = useMutation({
    mutationFn: () =>
      convertTjxQuoteFn({
        data: {
          quoteId: quote.id,
          version: quote.version,
          serviceTypeId: Number(serviceTypeId),
          priorityId: Number(priorityId),
          categoryId: categoryId ? Number(categoryId) : null,
          serviceRequired: serviceRequired.trim(),
        },
      }),
    onSuccess: (result) => {
      setError(null)
      setMessage(
        result.created
          ? `Created work order ${result.workOrderId}.`
          : `Quote is already linked to work order ${result.workOrderId}.`,
      )
      refresh(result.quote)
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Conversion failed.'),
  })

  const link = useMutation({
    mutationFn: () =>
      linkTjxWorkOrderFn({
        data: {
          quoteId: quote.id,
          version: quote.version,
          workOrderId: Number(attachId),
        },
      }),
    onSuccess: (saved) => {
      setError(null)
      setMessage('Work order linked.')
      setAttachId('')
      refresh(saved)
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Link failed.'),
  })

  const unlink = useMutation({
    mutationFn: (workOrderId: number) =>
      unlinkTjxWorkOrderFn({
        data: { quoteId: quote.id, version: quote.version, workOrderId },
      }),
    onSuccess: (saved) => {
      setError(null)
      setMessage('Work order unlinked.')
      refresh(saved)
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Unlink failed.'),
  })

  const primary = quote.workOrders.find((link) => link.isPrimary)
  const busy = convert.isPending || link.isPending || unlink.isPending

  return (
    <Card title="Work orders">
      <div className="space-y-4">
        {primary ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-hair px-3 py-2">
              <span>
                <Link
                  to="/work-orders/$id"
                  params={{ id: String(primary.workOrderId) }}
                  className="text-[13px] font-medium text-brand hover:underline"
                >
                  Work order {primary.workOrderId}
                </Link>
                <span className="ml-2 text-[11.5px] text-fg-muted">Primary</span>
              </span>
            </div>
            {quote.workOrders.filter((row) => !row.isPrimary).length ? (
              <div className="space-y-1">
                {quote.workOrders
                  .filter((row) => !row.isPrimary)
                  .map((row) => (
                    <div
                      key={row.workOrderId}
                      className="flex items-center justify-between gap-2 rounded-[4px] border border-hair px-3 py-1.5"
                    >
                      <Link
                        to="/work-orders/$id"
                        params={{ id: String(row.workOrderId) }}
                        className="text-[12.5px] text-brand hover:underline"
                      >
                        Work order {row.workOrderId}
                      </Link>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => unlink.mutate(row.workOrderId)}
                      >
                        Unlink
                      </Button>
                    </div>
                  ))}
              </div>
            ) : null}
            <div className="flex flex-wrap items-end gap-2 rounded-[4px] border border-hair p-3">
              <Field label="Attach an existing work order">
                <Input
                  value={attachId}
                  inputMode="numeric"
                  placeholder="Work order number"
                  onChange={(event) => setAttachId(event.target.value.replace(/\D/g, ''))}
                  className="w-[190px]"
                />
              </Field>
              <Button
                disabled={busy || !attachId}
                onClick={() => link.mutate()}
              >
                Attach
              </Button>
              <span className="pb-2 text-[11.5px] text-fg-muted">
                Extra work orders are links only; the primary is the one created here.
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[12.5px] text-fg-secondary">
              This quote has no work order. Conversion uses Work Orders' shared core with the
              project and TJX flags; it never inserts a work order directly.
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Service type" required>
                <Select
                  value={serviceTypeId}
                  onChange={(event) => setServiceTypeId(event.target.value)}
                >
                  <option value="">Choose…</option>
                  {lookups.data?.serviceTypes.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Priority" required>
                <Select
                  value={priorityId}
                  onChange={(event) => setPriorityId(event.target.value)}
                >
                  <option value="">Choose…</option>
                  {lookups.data?.priorities.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Category">
                <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                  <option value="">Not set</option>
                  {lookups.data?.categories.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Service required" required>
              <Input
                value={serviceRequired}
                onChange={(event) => setServiceRequired(event.target.value)}
              />
            </Field>
            <Button
              variant="primary"
              disabled={busy || !serviceTypeId || !priorityId || !serviceRequired.trim()}
              onClick={() => convert.mutate()}
            >
              {convert.isPending ? 'Creating work order…' : 'Create work order'}
            </Button>
            {lookups.isError ? <ErrorNote message={lookups.error.message} /> : null}
            {!lookups.isPending && lookups.data?.serviceTypes.length === 0 ? (
              <EmptyNote>No service types are configured in Work Orders.</EmptyNote>
            ) : null}
          </div>
        )}

        <ErrorNote message={error} />
        {message ? (
          <p className="rounded-[4px] border border-brand/30 bg-brand/5 px-3 py-2 text-[12.5px] text-fg-secondary" role="status">
            {message}
          </p>
        ) : null}
      </div>
    </Card>
  )
}
