import { useMemo, useState } from 'react'
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Button, Card, ErrorPanel, Field, Input, Select, Textarea } from '../../../modules/work-orders/components/ui'
import { createRgaFn, getRgaFormOptionsFn } from '../../../modules/rga/server/rga.functions'
import { getSessionFn } from '../../../server/auth.functions'

export const Route = createFileRoute('/_app/rgas/new')({
  beforeLoad: async () => {
    const session = await getSessionFn()
    if (!session) throw redirect({ to: '/login', search: { redirect: '/rgas/new' } })
    return { session }
  },
  component: NewRgaPage,
})

interface PartLine {
  partNo: string
  description: string
  qty: string
  returnQty: string
  price: string
  reasonForReturn: string
  underWarranty: boolean
}

interface SpecialLine {
  name: string
  description: string
  qty: string
  returnQty: string
  price: string
  reasonForReturn: string
}

const emptyPart = (): PartLine => ({
  partNo: '',
  description: '',
  qty: '1',
  returnQty: '1',
  price: '0.00',
  reasonForReturn: '',
  underWarranty: false,
})

const emptySpecial = (): SpecialLine => ({
  name: '',
  description: '',
  qty: '1',
  returnQty: '1',
  price: '0.00',
  reasonForReturn: '',
})

function NewRgaPage() {
  const navigate = useNavigate()
  const [supplierId, setSupplierId] = useState('')
  const [workOrderId, setWorkOrderId] = useState('')
  const [poId, setPoId] = useState('')
  const [rgaType, setRgaType] = useState<'rga' | 'credit' | 'replacement'>('rga')
  const [replacementType, setReplacementType] = useState('')
  const [requestDate, setRequestDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [rgaNotes, setRgaNotes] = useState('')
  const [shippingAddress, setShippingAddress] = useState('')
  const [parts, setParts] = useState<PartLine[]>([emptyPart()])
  const [specials, setSpecials] = useState<SpecialLine[]>([])

  const options = useQuery({
    queryKey: ['rga-form-options'],
    queryFn: () => getRgaFormOptionsFn({ data: {} }),
  })

  const selectedPo = useMemo(
    () => options.data?.purchaseOrders.find((po) => String(po.id) === poId),
    [options.data?.purchaseOrders, poId],
  )

  const mutation = useMutation({
    mutationFn: () =>
      createRgaFn({
        data: {
          supplierId: supplierId ? Number(supplierId) : null,
          workOrderId: workOrderId ? Number(workOrderId) : null,
          poId: poId ? Number(poId) : null,
          rgaType,
          replacementType:
            (replacementType || null) as 'supplier' | 'subcontractor' | 'customer' | 'subcredit' | null,
          requestDate,
          rgaNotes: rgaNotes.trim() || null,
          shippingAddress: shippingAddress.trim() || null,
          parts: parts.map((line) => ({
            partNo: line.partNo.trim(),
            description: line.description.trim() || null,
            qty: line.qty,
            returnQty: line.returnQty,
            price: line.price,
            reasonForReturn: line.reasonForReturn.trim() || null,
            underWarranty: line.underWarranty,
          })),
          specialParts: specials.map((line) => ({
            name: line.name.trim(),
            description: line.description.trim() || null,
            qty: line.qty,
            returnQty: line.returnQty,
            price: line.price,
            reasonForReturn: line.reasonForReturn.trim() || null,
          })),
        },
      }),
    onSuccess: (row) => {
      void navigate({ to: '/rgas/$id', params: { id: String(row.id) } })
    },
  })

  const updatePart = (index: number, patch: Partial<PartLine>) =>
    setParts((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const updateSpecial = (index: number, patch: Partial<SpecialLine>) =>
    setSpecials((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hair pb-5 pt-2">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand">Supply</p>
          <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em] text-fg">Raise an RGA</h1>
          <p className="mt-1 max-w-[68ch] text-[13.5px] text-fg-secondary">
            Name the supplier and, where there is one, the purchase order and work order. Return
            quantities drive the credit; ordered quantities never change.
          </p>
        </div>
        <Link to="/rgas" className="text-[13px] text-brand underline">
          Back to RGAs
        </Link>
      </div>

      {mutation.isError ? (
        <ErrorPanel
          message={mutation.error instanceof Error ? mutation.error.message : 'Could not raise the RGA.'}
        />
      ) : null}

      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate()
        }}
      >
        <Card title="Header">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Supplier">
              <Select
                aria-label="Supplier"
                value={supplierId}
                onChange={(event) => setSupplierId(event.target.value)}
              >
                <option value="">Not set</option>
                {options.data?.suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Work order">
              <Select
                aria-label="Work order"
                value={workOrderId}
                onChange={(event) => setWorkOrderId(event.target.value)}
              >
                <option value="">Not set</option>
                {options.data?.workOrders.map((wo) => (
                  <option key={wo.id} value={wo.id}>
                    {wo.number}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Purchase order">
              <Select
                aria-label="Purchase order"
                value={poId}
                onChange={(event) => {
                  const next = event.target.value
                  setPoId(next)
                  const po = options.data?.purchaseOrders.find((row) => String(row.id) === next)
                  if (po) setSupplierId(String(po.supplierId))
                }}
              >
                <option value="">Not set</option>
                {options.data?.purchaseOrders.map((po) => (
                  <option key={po.id} value={po.id}>
                    {po.displayNumber ?? `PO ${po.id}`}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="RGA type">
              <Select
                aria-label="RGA type"
                value={rgaType}
                onChange={(event) => setRgaType(event.target.value as typeof rgaType)}
              >
                <option value="rga">Return goods authorization</option>
                <option value="credit">Credit request</option>
                <option value="replacement">Material replacement request</option>
              </Select>
            </Field>
            <Field label="Replacement type">
              <Select
                aria-label="Replacement type"
                value={replacementType}
                onChange={(event) => setReplacementType(event.target.value)}
              >
                <option value="">Not set</option>
                <option value="supplier">Return to supplier</option>
                <option value="subcontractor">Subcontractor replacement</option>
                <option value="customer">Customer replacement</option>
                <option value="subcredit">Subcontractor credit</option>
              </Select>
            </Field>
            <Field label="Request date">
              <Input
                aria-label="Request date"
                type="date"
                value={requestDate}
                onChange={(event) => setRequestDate(event.target.value)}
              />
            </Field>
          </div>
          {selectedPo && String(selectedPo.supplierId) !== supplierId ? (
            <p className="mt-3 text-[12px] text-fg-muted">
              The purchase order sets the supplier when you save.
            </p>
          ) : null}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Field label="Notes for the supplier">
              <Textarea
                aria-label="Notes for the supplier"
                rows={3}
                value={rgaNotes}
                onChange={(event) => setRgaNotes(event.target.value)}
              />
            </Field>
            <Field label="Return shipping address">
              <Textarea
                aria-label="Return shipping address"
                rows={3}
                value={shippingAddress}
                onChange={(event) => setShippingAddress(event.target.value)}
              />
            </Field>
          </div>
        </Card>

        <Card title="Parts">
          <div className="space-y-4">
            {parts.map((line, index) => (
              <div key={index} className="grid gap-3 rounded-[4px] border border-hair p-3 lg:grid-cols-[1.2fr_1.6fr_70px_70px_90px_1.4fr_auto]">
                <Field label="Part no.">
                  <Input
                    aria-label={`Part number ${index + 1}`}
                    required
                    value={line.partNo}
                    onChange={(event) => updatePart(index, { partNo: event.target.value })}
                  />
                </Field>
                <Field label="Description">
                  <Input
                    aria-label={`Part description ${index + 1}`}
                    value={line.description}
                    onChange={(event) => updatePart(index, { description: event.target.value })}
                  />
                </Field>
                <Field label="Qty">
                  <Input
                    aria-label={`Part quantity ${index + 1}`}
                    inputMode="decimal"
                    value={line.qty}
                    onChange={(event) => updatePart(index, { qty: event.target.value })}
                  />
                </Field>
                <Field label="Return">
                  <Input
                    aria-label={`Return quantity ${index + 1}`}
                    inputMode="decimal"
                    value={line.returnQty}
                    onChange={(event) => updatePart(index, { returnQty: event.target.value })}
                  />
                </Field>
                <Field label="Unit price">
                  <Input
                    aria-label={`Part price ${index + 1}`}
                    inputMode="decimal"
                    value={line.price}
                    onChange={(event) => updatePart(index, { price: event.target.value })}
                  />
                </Field>
                <Field label="Reason">
                  <Input
                    aria-label={`Reason for return ${index + 1}`}
                    value={line.reasonForReturn}
                    onChange={(event) => updatePart(index, { reasonForReturn: event.target.value })}
                  />
                </Field>
                <div className="flex items-end pb-1">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setParts((rows) => rows.filter((_, i) => i !== index))}
                    disabled={parts.length === 1 && specials.length === 0}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            <Button type="button" variant="secondary" onClick={() => setParts((rows) => [...rows, emptyPart()])}>
              Add part line
            </Button>
          </div>
        </Card>

        <Card title="Special parts">
          <div className="space-y-4">
            {specials.length === 0 ? (
              <p className="text-[13px] text-fg-muted">No special-part lines.</p>
            ) : null}
            {specials.map((line, index) => (
              <div key={index} className="grid gap-3 rounded-[4px] border border-hair p-3 lg:grid-cols-[1.2fr_1.6fr_70px_70px_90px_1.4fr_auto]">
                <Field label="Name">
                  <Input
                    aria-label={`Special part name ${index + 1}`}
                    required
                    value={line.name}
                    onChange={(event) => updateSpecial(index, { name: event.target.value })}
                  />
                </Field>
                <Field label="Description">
                  <Input
                    aria-label={`Special part description ${index + 1}`}
                    value={line.description}
                    onChange={(event) => updateSpecial(index, { description: event.target.value })}
                  />
                </Field>
                <Field label="Qty">
                  <Input
                    aria-label={`Special quantity ${index + 1}`}
                    inputMode="decimal"
                    value={line.qty}
                    onChange={(event) => updateSpecial(index, { qty: event.target.value })}
                  />
                </Field>
                <Field label="Return">
                  <Input
                    aria-label={`Special return quantity ${index + 1}`}
                    inputMode="decimal"
                    value={line.returnQty}
                    onChange={(event) => updateSpecial(index, { returnQty: event.target.value })}
                  />
                </Field>
                <Field label="Unit price">
                  <Input
                    aria-label={`Special price ${index + 1}`}
                    inputMode="decimal"
                    value={line.price}
                    onChange={(event) => updateSpecial(index, { price: event.target.value })}
                  />
                </Field>
                <Field label="Reason">
                  <Input
                    aria-label={`Special reason ${index + 1}`}
                    value={line.reasonForReturn}
                    onChange={(event) => updateSpecial(index, { reasonForReturn: event.target.value })}
                  />
                </Field>
                <div className="flex items-end pb-1">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setSpecials((rows) => rows.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              onClick={() => setSpecials((rows) => [...rows, emptySpecial()])}
            >
              Add special part
            </Button>
          </div>
        </Card>

        <div className="flex items-center justify-end gap-2">
          <Link to="/rgas" className="text-[13px] text-fg-muted underline">
            Cancel
          </Link>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Raising…' : 'Raise RGA'}
          </Button>
        </div>
      </form>
    </div>
  )
}
