import { useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { Button, Field, Input, Select, Textarea } from './ui'
import {
  captureHoursFn,
  captureLocalHoursFn,
  capturePartsFn,
  captureReportFn,
  captureSpecialPartsFn,
  captureSignatureFn,
  searchPartsFn,
  uploadDocumentFn,
} from '../server/work-orders.functions'
import type { WorkOrderDetail } from '../types'

export function HoursForm({ detail, onDone }: { detail: WorkOrderDetail; onDone: () => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [hours, setHours] = useState('')
  const [rate, setRate] = useState('')
  const [rateCode, setRateCode] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: () =>
      captureHoursFn({
        data: {
          workOrderId: detail.id,
          lines: [
            {
              lineDate: date,
              hours,
              rateCode,
              hourlyRate: rate,
              techUserId: null,
            },
          ],
        },
      }),
    onSuccess: () => {
      setHours('')
      onDone()
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  })

  return (
    <form
      className="grid gap-3 sm:grid-cols-5"
      onSubmit={(event) => {
        event.preventDefault()
        setError(null)
        mutation.mutate()
      }}
    >
      <Field label="Date">
        <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
      </Field>
      <Field label="Hours">
        <Input
          inputMode="decimal"
          placeholder="0.00"
          value={hours}
          onChange={(event) => setHours(event.target.value)}
          required
        />
      </Field>
      <Field label="Rate">
        <Input
          inputMode="decimal"
          placeholder="0.00"
          value={rate}
          onChange={(event) => setRate(event.target.value)}
          required
        />
      </Field>
      <Field label="Rate code">
        <Select value={rateCode} onChange={(event) => setRateCode(Number(event.target.value))}>
          <option value={1}>1 — Interior</option>
          <option value={2}>2 — Exterior</option>
          <option value={3}>3 — Other</option>
        </Select>
      </Field>
      <div className="flex items-end">
        <Button type="submit" variant="primary" className="w-full" disabled={mutation.isPending}>
          Add labour
        </Button>
      </div>
      {error ? (
        <p role="alert" className="sm:col-span-5 text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </form>
  )
}

export function PartsForm({ detail, onDone }: { detail: WorkOrderDetail; onDone: () => void }) {
  const [partNo, setPartNo] = useState('')
  const [description, setDescription] = useState('')
  const [qty, setQty] = useState('1')
  const [price, setPrice] = useState('')
  const [error, setError] = useState<string | null>(null)
  const parts = useQueryParts(partNo)

  const mutation = useMutation({
    mutationFn: () =>
      capturePartsFn({
        data: {
          workOrderId: detail.id,
          lines: [{ partNo, description: description || null, qty, price }],
        },
      }),
    onSuccess: () => {
      setPartNo('')
      setDescription('')
      setQty('1')
      setPrice('')
      onDone()
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  })

  return (
    <form
      className="grid gap-3 sm:grid-cols-6"
      onSubmit={(event) => {
        event.preventDefault()
        setError(null)
        mutation.mutate()
      }}
    >
      <div className="sm:col-span-2">
        <Field label="Part">
          <div className="relative">
            <Input
              value={partNo}
              placeholder="Part number"
              list="part-options"
              onChange={(event) => setPartNo(event.target.value)}
              required
            />
            <datalist id="part-options">
              {(parts.data ?? []).map((part) => (
                <option key={part.partNo} value={part.partNo}>
                  {part.description}
                </option>
              ))}
            </datalist>
          </div>
        </Field>
      </div>
      <Field label="Qty">
        <Input inputMode="decimal" value={qty} onChange={(event) => setQty(event.target.value)} required />
      </Field>
      <Field label="Price">
        <Input
          inputMode="decimal"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          required
        />
      </Field>
      <Field label="Description">
        <Input value={description} onChange={(event) => setDescription(event.target.value)} />
      </Field>
      <div className="flex items-end">
        <Button type="submit" variant="primary" className="w-full" disabled={mutation.isPending}>
          Add part
        </Button>
      </div>
      {error ? (
        <p role="alert" className="sm:col-span-6 text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </form>
  )
}

export function SpecialPartsForm({
  detail,
  onDone,
}: {
  detail: WorkOrderDetail
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [qty, setQty] = useState('1')
  const [price, setPrice] = useState('')
  const [emergency, setEmergency] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: () =>
      captureSpecialPartsFn({
        data: {
          workOrderId: detail.id,
          lines: [{ name, qty, price, isEmergencyLighting: emergency }],
        },
      }),
    onSuccess: () => {
      setName('')
      setQty('1')
      setPrice('')
      setEmergency(false)
      onDone()
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  })

  return (
    <form
      className="grid gap-3 sm:grid-cols-5"
      onSubmit={(event) => {
        event.preventDefault()
        setError(null)
        mutation.mutate()
      }}
    >
      <div className="sm:col-span-2">
        <Field label="Special-order description">
          <Input value={name} onChange={(event) => setName(event.target.value)} required />
        </Field>
      </div>
      <Field label="Qty">
        <Input inputMode="decimal" value={qty} onChange={(event) => setQty(event.target.value)} required />
      </Field>
      <Field label="Price">
        <Input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} required />
      </Field>
      <div className="flex items-end gap-2">
        <label className="flex items-center gap-1.5 pb-2 text-[11.5px] text-fg-secondary">
          <input
            type="checkbox"
            checked={emergency}
            onChange={(event) => setEmergency(event.target.checked)}
          />
          Emergency
        </label>
        <Button type="submit" variant="primary" className="flex-1" disabled={mutation.isPending}>
          Add
        </Button>
      </div>
      {error ? (
        <p role="alert" className="sm:col-span-5 text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </form>
  )
}

export function ReportForm({ detail, onDone }: { detail: WorkOrderDetail; onDone: () => void }) {
  const [report, setReport] = useState(detail.report)
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: () => captureReportFn({ data: { workOrderId: detail.id, report } }),
    onSuccess: onDone,
    onError: (mutationError: Error) => setError(mutationError.message),
  })
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        setError(null)
        mutation.mutate()
      }}
    >
      <Textarea
        className="min-h-[160px]"
        aria-label="Service report"
        value={report}
        onChange={(event) => setReport(event.target.value)}
        placeholder="What was found and what was done."
      />
      {error ? (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="primary" disabled={mutation.isPending}>
        Save report
      </Button>
    </form>
  )
}

export function LocalHoursForm({
  detail,
  onDone,
}: {
  detail: WorkOrderDetail
  onDone: () => void
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [timeIn, setTimeIn] = useState('')
  const [timeOut, setTimeOut] = useState('')
  const [hours, setHours] = useState('')
  const [headcount, setHeadcount] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: () =>
      captureLocalHoursFn({
        data: {
          workOrderId: detail.id,
          lines: [
            {
              lineDate: date,
              timeIn: timeIn || null,
              timeOut: timeOut || null,
              hours,
              headcount,
            },
          ],
        },
      }),
    onSuccess: () => {
      setTimeIn('')
      setTimeOut('')
      setHours('')
      onDone()
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  })
  return (
    <form
      className="grid gap-3 sm:grid-cols-6"
      onSubmit={(event) => {
        event.preventDefault()
        setError(null)
        mutation.mutate()
      }}
    >
      <Field label="Date">
        <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
      </Field>
      <Field label="Time in">
        <Input type="time" value={timeIn} onChange={(event) => setTimeIn(event.target.value)} />
      </Field>
      <Field label="Time out">
        <Input type="time" value={timeOut} onChange={(event) => setTimeOut(event.target.value)} />
      </Field>
      <Field label="Hours">
        <Input inputMode="decimal" value={hours} onChange={(event) => setHours(event.target.value)} required />
      </Field>
      <Field label="Headcount">
        <Input
          type="number"
          min={1}
          max={50}
          value={headcount}
          onChange={(event) => setHeadcount(Number(event.target.value))}
        />
      </Field>
      <div className="flex items-end">
        <Button type="submit" variant="primary" className="w-full" disabled={mutation.isPending}>
          Add time
        </Button>
      </div>
      {error ? (
        <p role="alert" className="sm:col-span-6 text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </form>
  )
}

export function UploadForm({
  detail,
  defaultKind = 'photo',
  onDone,
}: {
  detail: WorkOrderDetail
  defaultKind?: 'photo' | 'document' | 'service_report' | 'other'
  onDone: () => void
}) {
  const [kind, setKind] = useState(defaultKind)
  const [caption, setCaption] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a file first.')
      const buffer = await file.arrayBuffer()
      let binary = ''
      const bytes = new Uint8Array(buffer)
      for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
      }
      return uploadDocumentFn({
        data: {
          workOrderId: detail.id,
          kind,
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          caption: caption || null,
          dataBase64: btoa(binary),
        },
      })
    },
    onSuccess: () => {
      setFile(null)
      setCaption('')
      if (input.current) input.current.value = ''
      onDone()
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  })

  return (
    <form
      className="grid gap-3 sm:grid-cols-4"
      onSubmit={(event) => {
        event.preventDefault()
        setError(null)
        mutation.mutate()
      }}
    >
      <Field label="Type">
        <Select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
          <option value="photo">Photo</option>
          <option value="document">Document</option>
          <option value="service_report">Service report</option>
          <option value="other">Other</option>
        </Select>
      </Field>
      <Field label="File" hint="Up to 18 MB.">
        <Input
          ref={input}
          type="file"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </Field>
      <Field label="Caption">
        <Input value={caption} onChange={(event) => setCaption(event.target.value)} />
      </Field>
      <div className="flex items-end">
        <Button type="submit" variant="primary" className="w-full" disabled={mutation.isPending || !file}>
          <Upload size={14} aria-hidden="true" /> Upload
        </Button>
      </div>
      {error ? (
        <p role="alert" className="sm:col-span-4 text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </form>
  )
}

export function SignatureForm({ detail, onDone }: { detail: WorkOrderDetail; onDone: () => void }) {
  const [signerName, setSignerName] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Choose a signature image.')
      const buffer = await file.arrayBuffer()
      let binary = ''
      const bytes = new Uint8Array(buffer)
      for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
      }
      return captureSignatureFn({
        data: {
          workOrderId: detail.id,
          signerName,
          note: note || null,
          dataBase64: btoa(binary),
          contentType: file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
        },
      })
    },
    onSuccess: () => {
      setSignerName('')
      setNote('')
      setFile(null)
      onDone()
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  })
  return (
    <form
      className="grid gap-3 sm:grid-cols-4"
      onSubmit={(event) => {
        event.preventDefault()
        setError(null)
        mutation.mutate()
      }}
    >
      <Field label="Signer name">
        <Input value={signerName} onChange={(event) => setSignerName(event.target.value)} required />
      </Field>
      <Field label="Signature image">
        <Input type="file" accept="image/png,image/jpeg" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      </Field>
      <Field label="Note">
        <Input value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <div className="flex items-end">
        <Button type="submit" variant="primary" className="w-full" disabled={mutation.isPending || !file}>
          Capture signature
        </Button>
      </div>
      {error ? (
        <p role="alert" className="sm:col-span-4 text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </form>
  )
}

function useQueryParts(term: string) {
  return useQuery({
    queryKey: ['parts', term],
    queryFn: () => searchPartsFn({ data: { search: term, limit: 12 } }),
    enabled: term.trim().length >= 2,
    staleTime: 60_000,
  })
}
