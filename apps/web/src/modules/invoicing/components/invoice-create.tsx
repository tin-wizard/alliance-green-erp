import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { createInvoiceFn } from '../server/invoicing.functions'
import { Button, Card, ErrorPanel, Field, Input } from '../../work-orders/components/ui'

export function InvoiceCreate() {
  const navigate = useNavigate()
  const [workOrderId, setWorkOrderId] = useState('')
  const create = useMutation({
    mutationFn: () =>
      createInvoiceFn({ data: { workOrderId: Number(workOrderId) } }),
    onSuccess: (result) => {
      void navigate({ to: '/invoicing/$id', params: { id: String(result.invoiceId) } })
    },
  })

  return (
    <Card title="Create from a work order">
      <form
        className="max-w-[420px] space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
      >
        <p className="text-[13px] text-fg-secondary">
          The invoice starts as a copy of the work order&apos;s invoice-ready snapshot. Totals are
          stored as posted; later recalculations replace the whole line set.
        </p>
        <Field label="Work order number" required>
          <Input
            inputMode="numeric"
            data-testid="invoice-wo"
            value={workOrderId}
            onChange={(event) => setWorkOrderId(event.target.value)}
            placeholder="e.g. 73850"
          />
        </Field>
        {create.isError ? <ErrorPanel message={create.error.message} /> : null}
        <Button type="submit" variant="primary" disabled={!workOrderId || create.isPending}>
          {create.isPending ? 'Creating…' : 'Create invoice'}
        </Button>
      </form>
    </Card>
  )
}
