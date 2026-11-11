import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, ErrorPanel, Input, Select } from '../../work-orders/components/ui'
import { listSuppliersFn } from '../../master-data/server/master-data.functions'
import { createPurchaseOrderFn, updatePurchaseOrderFn } from '../server/purchasing.functions'
import type { PurchaseOrderDetail } from '../types'

interface FormLine {
  partNo: string
  qty: string
  price: string
}

const TAX_PROVINCES = ['ON', 'BC', 'MB', 'QC', 'SK', 'AB', 'NB', 'NL', 'NS', 'PE']

export function PurchaseOrderForm({ existing }: { existing?: PurchaseOrderDetail }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [supplierSearch, setSupplierSearch] = useState('')
  const suppliers = useQuery({
    queryKey: ['suppliers', 'purchasing-picker', supplierSearch],
    queryFn: () =>
      listSuppliersFn({
        data: { search: supplierSearch || undefined, page: 1, pageSize: 50 },
      }),
  })

  const [supplierId, setSupplierId] = useState(existing?.supplierId ?? 0)
  const [shipmentType, setShipmentType] = useState(existing?.shipmentType ?? 'alliance')
  const [taxCode, setTaxCode] = useState(existing?.taxCode ?? 'ON')
  const [expectedDelivery, setExpectedDelivery] = useState(existing?.expectedDelivery ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [lines, setLines] = useState<FormLine[]>(
    existing?.lines.map((line) => ({ partNo: line.partNo, qty: line.qty, price: line.price })) ?? [
      { partNo: '', qty: '1.00', price: '0.00' },
    ],
  )

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        supplierId,
        shipmentType,
        taxCode,
        expectedDelivery: expectedDelivery || null,
        notes: notes || null,
        parts: lines
          .filter((line) => line.partNo.trim())
          .map((line) => ({ partNo: line.partNo.trim(), qty: line.qty, price: line.price })),
        specialParts: [],
      }
      if (existing) {
        return updatePurchaseOrderFn({
          data: { ...payload, id: existing.id, version: existing.version },
        })
      }
      return createPurchaseOrderFn({ data: payload })
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] })
      await navigate({ to: '/purchasing/$id', params: { id: String(result.id) } })
    },
  })

  const updateLine = (index: number, patch: Partial<FormLine>) => {
    setLines(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault()
        mutation.mutate()
      }}
    >
      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1 text-[12px] text-fg-secondary">
          <span>Supplier search</span>
          <Input
            aria-label="Supplier search"
            placeholder="Filter suppliers…"
            value={supplierSearch}
            onChange={(event) => setSupplierSearch(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-[12px] text-fg-secondary">
          <span>Supplier</span>
          <Select
            aria-label="Supplier"
            value={supplierId || ''}
            onChange={(event) => setSupplierId(Number(event.target.value))}
            required
          >
            <option value="">Choose a supplier…</option>
            {(suppliers.data?.rows ?? []).map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-[12px] text-fg-secondary">
          <span>Ship to</span>
          <Select
            aria-label="Ship to"
            value={shipmentType}
            onChange={(event) => setShipmentType(event.target.value)}
          >
            <option value="alliance">Alliance warehouse</option>
            <option value="customer">Customer site</option>
            <option value="subcontractor">Subcontractor</option>
          </Select>
        </label>
        <label className="space-y-1 text-[12px] text-fg-secondary">
          <span>Tax province</span>
          <Select aria-label="Tax province" value={taxCode} onChange={(event) => setTaxCode(event.target.value)}>
            {TAX_PROVINCES.map((province) => (
              <option key={province} value={province}>
                {province}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-[12px] text-fg-secondary">
          <span>Expected delivery</span>
          <Input
            aria-label="Expected delivery"
            type="date"
            value={expectedDelivery ?? ''}
            onChange={(event) => setExpectedDelivery(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-[12px] text-fg-secondary md:col-span-2">
          <span>Notes</span>
          <Input aria-label="Notes" value={notes ?? ''} onChange={(event) => setNotes(event.target.value)} />
        </label>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-fg">Part lines</h2>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setLines([...lines, { partNo: '', qty: '1.00', price: '0.00' }])}
          >
            Add line
          </Button>
        </div>
        {lines.map((line, index) => (
          <div key={index} className="grid gap-2 md:grid-cols-[2fr_100px_120px_auto]">
            <Input
              aria-label={`Part number ${index + 1}`}
              placeholder="Part number"
              value={line.partNo}
              onChange={(event) => updateLine(index, { partNo: event.target.value })}
            />
            <Input
              aria-label={`Quantity ${index + 1}`}
              value={line.qty}
              onChange={(event) => updateLine(index, { qty: event.target.value })}
            />
            <Input
              aria-label={`Price ${index + 1}`}
              value={line.price}
              onChange={(event) => updateLine(index, { price: event.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              onClick={() => setLines(lines.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
        ))}
      </div>

      {suppliers.error ? <ErrorPanel message={suppliers.error.message} /> : null}
      {mutation.error ? <ErrorPanel message={mutation.error.message} /> : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={mutation.isPending || supplierId === 0}>
          {mutation.isPending ? 'Saving…' : existing ? 'Save changes' : 'Create purchase order'}
        </Button>
      </div>
    </form>
  )
}
