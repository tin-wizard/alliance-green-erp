import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { SALES_TAX_TABLE } from '@cls/pricing'
import { Button, Card, Field, Input, Select, Textarea } from '../../work-orders/components/ui'
import type { SiteLookupOption } from '../../work-orders/types'
import { createTjxQuoteFn } from '../server/quotes.functions'
import { TJX_GRID_LABELS, TJX_GRID_TYPES, TJX_PAYMENT_TERM_LABELS, TJX_PAYMENT_TERMS } from '../lib/lifecycle'
import { ErrorNote } from './master-ui'
import { TjxSitePicker } from './site-picker'

const PROVINCES = Object.keys(SALES_TAX_TABLE)

export function TjxQuoteNewForm() {
  const navigate = useNavigate()
  const [site, setSite] = useState<SiteLookupOption | null>(null)
  const [quoteType, setQuoteType] = useState<'Gen 1' | 'Gen 2'>('Gen 1')
  const [grid, setGrid] = useState<number | null>(null)
  const [paymentTerms, setPaymentTerms] = useState<number | null>(null)
  const [maintenance, setMaintenance] = useState(false)
  const [dueDate, setDueDate] = useState('')
  const [taxProvince, setTaxProvince] = useState('ON')
  const [appliedTaxRate, setAppliedTaxRate] = useState('')
  const [notes, setNotes] = useState('')
  const [pdfNotes, setPdfNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () => {
      if (!site) throw new Error('Choose a site for this quote.')
      return createTjxQuoteFn({
        data: {
          siteId: site.id,
          quoteType,
          ceilingGridType: grid,
          isTypeMaintenance: maintenance,
          paymentTermsCode: paymentTerms,
          dueDate: dueDate || null,
          taxProvince,
          appliedTaxRate: appliedTaxRate || null,
          shipToType: null,
          shipContactName: null,
          shipCompany: null,
          shipStreet1: null,
          shipStreet2: null,
          shipCity: null,
          shipProvince: null,
          shipPostalCode: null,
          shipPhone: null,
          shippingAddress: null,
          notes: notes.trim() || null,
          pdfNotes: pdfNotes.trim() || null,
        },
      })
    },
    onSuccess: (quote) => {
      void navigate({ to: '/tjx/quotes/$id', params: { id: String(quote.id) } })
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Could not create the quote.'),
  })

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        setError(null)
        create.mutate()
      }}
    >
      <ErrorNote message={error} />
      <Card title="Quote header">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Site" required>
            <TjxSitePicker
              selected={site}
              onSelect={(next) => {
                setSite(next)
                if (next?.province) setTaxProvince(next.province)
              }}
            />
          </Field>
          <Field label="Quote type">
            <Select
              value={quoteType}
              onChange={(event) => setQuoteType(event.target.value as 'Gen 1' | 'Gen 2')}
            >
              <option value="Gen 1">Gen 1</option>
              <option value="Gen 2">Gen 2</option>
            </Select>
          </Field>
          <Field label="Ceiling grid">
            <Select
              value={grid ?? ''}
              onChange={(event) => setGrid(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">Not set</option>
              {TJX_GRID_TYPES.map((value) => (
                <option key={value} value={value}>
                  {TJX_GRID_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Payment terms">
            <Select
              value={paymentTerms ?? ''}
              onChange={(event) =>
                setPaymentTerms(event.target.value ? Number(event.target.value) : null)
              }
            >
              <option value="">Not set</option>
              {TJX_PAYMENT_TERMS.map((value) => (
                <option key={value} value={value}>
                  {TJX_PAYMENT_TERM_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due date">
            <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </Field>
          <Field label="Tax province">
            <Select value={taxProvince} onChange={(event) => setTaxProvince(event.target.value)}>
              {PROVINCES.map((province) => (
                <option key={province} value={province}>
                  {province}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Applied tax rate"
            hint="Optional override, e.g. 0.13. Blank stores the province rate on the quote."
          >
            <Input
              value={appliedTaxRate}
              placeholder="0.13"
              onChange={(event) => setAppliedTaxRate(event.target.value)}
            />
          </Field>
          <label className="mt-6 flex items-center gap-2 text-[12.5px] text-fg-secondary">
            <input
              type="checkbox"
              checked={maintenance}
              onChange={(event) => setMaintenance(event.target.checked)}
            />
            Type maintenance (label only)
          </label>
        </div>
      </Card>

      <Card title="Notes">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Internal notes">
            <Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
          <Field label="Notes for the PDF">
            <Textarea
              rows={3}
              value={pdfNotes}
              onChange={(event) => setPdfNotes(event.target.value)}
            />
          </Field>
        </div>
      </Card>

      <div className="flex justify-end gap-2 border-t border-hair pt-4">
        <Button type="submit" variant="primary" disabled={create.isPending || !site}>
          {create.isPending ? 'Creating…' : 'Create quote'}
        </Button>
      </div>
    </form>
  )
}
