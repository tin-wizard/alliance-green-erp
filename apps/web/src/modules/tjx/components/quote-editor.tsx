import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import {
  Button,
  Card,
  Field,
  Input,
  Select,
  Tag,
  Textarea,
  formatMoney,
} from '../../work-orders/components/ui'
import type { SiteLookupOption } from '../../work-orders/types'
import {
  calculateTjxQuote,
  format as formatDecimal,
  salesTaxRate,
  SALES_TAX_TABLE,
} from '@cls/pricing'
import {
  getTjxFixtureFn,
  listTjxFixturesFn,
  listTjxRoomsFn,
} from '../server/masters.functions'
import { saveTjxQuoteFn } from '../server/quotes.functions'
import {
  TJX_GRID_LABELS,
  TJX_GRID_TYPES,
  TJX_PAYMENT_TERM_LABELS,
  TJX_PAYMENT_TERMS,
} from '../lib/lifecycle'
import type { TjxQuoteDetail } from '../types'
import { EmptyNote, ErrorNote } from './master-ui'
import { TjxSitePicker } from './site-picker'

const PROVINCES = Object.keys(SALES_TAX_TABLE)

interface EditPart {
  key: string
  partNo: string
  partType: string
  markup: string
  ratioPerFixture: string
}

interface EditFixture {
  key: string
  fixtureId: number | null
  fixtureName: string
  quantity: string
  parts: EditPart[]
}

interface EditRoom {
  key: string
  roomId: number | null
  roomName: string
  fixtures: EditFixture[]
}

interface EditSpecial {
  key: string
  name: string
  quantity: string
  unitPrice: string
}

let localKey = 0
function key(prefix: string): string {
  localKey += 1
  return `${prefix}-${localKey}`
}

function initialRooms(quote: TjxQuoteDetail): EditRoom[] {
  return quote.rooms.map((room) => ({
    key: key('room'),
    roomId: room.roomId,
    roomName: room.roomName,
    fixtures: room.fixtures.map((fixture) => ({
      key: key('fixture'),
      fixtureId: fixture.fixtureId,
      fixtureName: fixture.fixtureName,
      quantity: fixture.quantity,
      parts: fixture.parts.map((part) => ({
        key: key('part'),
        partNo: part.partNo,
        partType: part.partType,
        markup: part.markup,
        ratioPerFixture: part.ratioPerFixture,
      })),
    })),
  }))
}

function initialSpecials(quote: TjxQuoteDetail): EditSpecial[] {
  return quote.specialParts.map((part) => ({
    key: key('special'),
    name: part.name,
    quantity: part.quantity,
    unitPrice: part.unitPrice,
  }))
}

function priceMapFrom(quote: TjxQuoteDetail): Record<string, string> {
  return Object.fromEntries(quote.prices.map((price) => [price.partNo, price.price]))
}

function siteFromQuote(quote: TjxQuoteDetail): SiteLookupOption | null {
  if (quote.siteId === null) return null
  return {
    id: quote.siteId,
    name: quote.siteName ?? `Site ${quote.siteId}`,
    street: quote.shipStreet1 ?? '',
    city: quote.shipCity ?? '',
    province: quote.shipProvince ?? '',
    postalCode: quote.shipPostalCode,
    customerId: quote.customerId ?? 0,
    customerName: quote.customerName ?? '',
  }
}

export function TjxQuoteEditor({ quote }: { quote: TjxQuoteDetail }) {
  const queryClient = useQueryClient()
  const editable = quote.canEdit

  const [version, setVersion] = useState(quote.version)
  const [site, setSite] = useState<SiteLookupOption | null>(() => siteFromQuote(quote))
  const [quoteType, setQuoteType] = useState(quote.quoteType)
  const [grid, setGrid] = useState<number | null>(quote.ceilingGridType)
  const [paymentTerms, setPaymentTerms] = useState<number | null>(quote.paymentTermsCode)
  const [maintenance, setMaintenance] = useState(quote.isTypeMaintenance)
  const [dueDate, setDueDate] = useState(quote.dueDate ?? '')
  const [taxProvince, setTaxProvince] = useState(quote.taxProvince ?? quote.shipProvince ?? 'ON')
  const [appliedTaxRate, setAppliedTaxRate] = useState(quote.appliedTaxRate ?? '')
  const [notes, setNotes] = useState(quote.notes ?? '')
  const [pdfNotes, setPdfNotes] = useState(quote.pdfNotes ?? '')
  const [shipContactName, setShipContactName] = useState(quote.shipContactName ?? '')
  const [shipStreet1, setShipStreet1] = useState(quote.shipStreet1 ?? '')
  const [shipCity, setShipCity] = useState(quote.shipCity ?? '')
  const [shipProvince, setShipProvince] = useState(quote.shipProvince ?? '')
  const [shipPostalCode, setShipPostalCode] = useState(quote.shipPostalCode ?? '')

  const [rooms, setRooms] = useState<EditRoom[]>(() => initialRooms(quote))
  const [specialParts, setSpecialParts] = useState<EditSpecial[]>(() => initialSpecials(quote))
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>(() => priceMapFrom(quote))
  const [baselinePrices, setBaselinePrices] = useState<Record<string, string>>(() =>
    priceMapFrom(quote),
  )
  const [roomChoice, setRoomChoice] = useState('')
  const [fixtureChoice, setFixtureChoice] = useState<Record<string, string>>({})
  const [busyRoom, setBusyRoom] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [savedTotals, setSavedTotals] = useState<{
    total: string
    withoutMarkupTotal: string
  } | null>(null)

  const roomOptions = useQuery({
    queryKey: ['tjx', 'rooms', 'active'],
    queryFn: () => listTjxRoomsFn({ data: { active: 'active' } }),
  })
  const fixtureOptions = useQuery({
    queryKey: ['tjx', 'fixtures', 'active'],
    queryFn: () => listTjxFixturesFn({ data: { active: 'active' } }),
  })

  const allPartNumbers = useMemo(() => {
    const set = new Set<string>()
    for (const room of rooms) {
      for (const fixture of room.fixtures) {
        for (const part of fixture.parts) {
          const partNo = part.partNo.trim().toUpperCase()
          if (partNo) set.add(partNo)
        }
      }
    }
    return [...set].sort()
  }, [rooms])

  const preview = useMemo(() => {
    if (allPartNumbers.length === 0 && specialParts.length === 0) {
      return { calculation: null, error: null }
    }
    const prices: Record<string, string> = {}
    for (const partNo of allPartNumbers) {
      const price = priceInputs[partNo]?.trim()
      if (!price) {
        return {
          calculation: null,
          error: `No price for ${partNo} yet. Enter one below; the server will also use the part's sell price if present.`,
        }
      }
      prices[partNo] = price
    }
    const province = taxProvince || site?.province || 'ON'
    const rate = appliedTaxRate.trim() || formatDecimal(salesTaxRate(province).rate, 5)
    try {
      return {
        calculation: calculateTjxQuote({
          taxRate: rate,
          fixtures: rooms.flatMap((room) =>
            room.fixtures.map((fixture) => ({
              quantity: fixture.quantity,
              parts: fixture.parts.map((part) => ({
                partNo: part.partNo,
                markup: part.markup,
                ratioPerFixture: part.ratioPerFixture,
              })),
            })),
          ),
          specialParts: specialParts.map((part) => ({
            name: part.name,
            quantity: part.quantity,
            unitPrice: part.unitPrice,
          })),
          prices,
        }),
        error: null,
      }
    } catch (cause) {
      return {
        calculation: null,
        error: cause instanceof Error ? cause.message : 'The preview could not be calculated.',
      }
    }
  }, [allPartNumbers, appliedTaxRate, priceInputs, rooms, site?.province, specialParts, taxProvince])

  const updateRoom = (roomKey: string, change: Partial<EditRoom>) => {
    setRooms((current) => current.map((room) => (room.key === roomKey ? { ...room, ...change } : room)))
  }
  const updateFixture = (roomKey: string, fixtureKey: string, change: Partial<EditFixture>) => {
    setRooms((current) =>
      current.map((room) =>
        room.key === roomKey
          ? {
              ...room,
              fixtures: room.fixtures.map((fixture) =>
                fixture.key === fixtureKey ? { ...fixture, ...change } : fixture,
              ),
            }
          : room,
      ),
    )
  }
  const updatePart = (
    roomKey: string,
    fixtureKey: string,
    partKey: string,
    change: Partial<EditPart>,
  ) => {
    setRooms((current) =>
      current.map((room) =>
        room.key === roomKey
          ? {
              ...room,
              fixtures: room.fixtures.map((fixture) =>
                fixture.key === fixtureKey
                  ? {
                      ...fixture,
                      parts: fixture.parts.map((part) =>
                        part.key === partKey ? { ...part, ...change } : part,
                      ),
                    }
                  : fixture,
              ),
            }
          : room,
      ),
    )
  }

  const addRoom = () => {
    const room = roomOptions.data?.find((row) => String(row.id) === roomChoice)
    if (!room) return
    setRooms((current) => [
      ...current,
      { key: key('room'), roomId: room.id, roomName: room.name, fixtures: [] },
    ])
    setRoomChoice('')
  }

  const addFixture = async (roomKey: string) => {
    const fixtureId = Number(fixtureChoice[roomKey] ?? '')
    if (!fixtureId) return
    setBusyRoom(roomKey)
    setError(null)
    try {
      const fixture = await queryClient.fetchQuery({
        queryKey: ['tjx', 'fixtures', fixtureId],
        queryFn: () => getTjxFixtureFn({ data: { id: fixtureId } }),
      })
      if (!fixture) throw new Error('That fixture no longer exists.')
      setRooms((current) =>
        current.map((room) =>
          room.key === roomKey
            ? {
                ...room,
                fixtures: [
                  ...room.fixtures,
                  {
                    key: key('fixture'),
                    fixtureId: fixture.id,
                    fixtureName: fixture.name,
                    quantity: '1',
                    parts: fixture.parts.map((part) => ({
                      key: key('part'),
                      partNo: part.partNo,
                      partType: part.partType,
                      markup: part.markup,
                      ratioPerFixture: part.ratioPerFixture,
                    })),
                  },
                ],
              }
            : room,
        ),
      )
      setFixtureChoice((current) => ({ ...current, [roomKey]: '' }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the fixture.')
    } finally {
      setBusyRoom(null)
    }
  }

  const save = useMutation({
    mutationFn: () => {
      if (!site) throw new Error('Choose a site for this quote.')
      const priceOverrides = Object.entries(priceInputs)
        .filter(([partNo, value]) => {
          const text = value.trim()
          return Boolean(text) && text !== (baselinePrices[partNo] ?? '').trim()
        })
        .map(([partNo, price]) => ({ partNo, price: price.trim() }))

      return saveTjxQuoteFn({
        data: {
          id: quote.id,
          version,
          siteId: site.id,
          quoteType,
          ceilingGridType: grid,
          isTypeMaintenance: maintenance,
          paymentTermsCode: paymentTerms,
          dueDate: dueDate || null,
          taxProvince,
          appliedTaxRate: appliedTaxRate.trim() || null,
          shipToType: quote.shipToType,
          shipContactName: shipContactName.trim() || null,
          shipCompany: quote.shipCompany,
          shipStreet1: shipStreet1.trim() || null,
          shipStreet2: quote.shipStreet2,
          shipCity: shipCity.trim() || null,
          shipProvince: shipProvince.trim() || null,
          shipPostalCode: shipPostalCode.trim() || null,
          shipPhone: quote.shipPhone,
          shippingAddress: quote.shippingAddress,
          notes: notes.trim() || null,
          pdfNotes: pdfNotes.trim() || null,
          revisionNotes: null,
          rooms: rooms.map((room) => ({
            roomId: room.roomId,
            roomName: room.roomName,
            fixtures: room.fixtures.map((fixture) => ({
              fixtureId: fixture.fixtureId,
              fixtureName: fixture.fixtureName,
              quantity: fixture.quantity,
              parts: fixture.parts.map((part) => ({
                partNo: part.partNo,
                partType: part.partType,
                markup: part.markup,
                ratioPerFixture: part.ratioPerFixture,
              })),
            })),
          })),
          specialParts: specialParts.map((part) => ({
            name: part.name,
            quantity: part.quantity,
            unitPrice: part.unitPrice,
          })),
          priceOverrides,
        },
      })
    },
    onSuccess: (saved) => {
      setError(null)
      setVersion(saved.version)
      setSavedAt(new Date().toLocaleTimeString())
      setSavedTotals({ total: saved.total, withoutMarkupTotal: saved.withoutMarkupTotal })
      const prices = priceMapFrom(saved)
      setBaselinePrices(prices)
      setPriceInputs((current) => ({ ...prices, ...current }))
      void queryClient.invalidateQueries({ queryKey: ['tjx', 'quotes'] })
      void queryClient.invalidateQueries({ queryKey: ['tjx', 'quote', quote.id] })
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Could not save the quote.'),
  })

  const shownTotals = preview.calculation
    ? {
        total: preview.calculation.total,
        withoutMarkupTotal: preview.calculation.withoutMarkupTotal,
        subtotal: preview.calculation.subtotal,
        tax: preview.calculation.tax,
        withoutMarkupSubtotal: preview.calculation.withoutMarkupSubtotal,
        withoutMarkupTax: preview.calculation.withoutMarkupTax,
      }
    : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone={editable ? 'info' : 'neutral'}>{quote.statusLabel}</Tag>
          <span className="text-[12px] text-fg-muted">Revision {quote.revisionNo}</span>
          <span className="text-[12px] text-fg-muted">Version {version}</span>
          {savedAt ? <span className="text-[12px] text-fg-muted">Saved at {savedAt}</span> : null}
        </div>
        {editable ? (
          <Button
            variant="primary"
            disabled={save.isPending}
            onClick={() => {
              setError(null)
              save.mutate()
            }}
          >
            {save.isPending ? 'Saving…' : 'Save quote'}
          </Button>
        ) : (
          <Tag>Read-only</Tag>
        )}
      </div>

      <ErrorNote message={error} />
      {!editable ? (
        <p className="rounded-[4px] border border-hair bg-subtle px-3 py-2 text-[12.5px] text-fg-secondary">
          This quote is approved or cancelled and cannot be edited. Its totals and snapshots stay as
          approved.
        </p>
      ) : null}
      {savedTotals ? (
        <p className="rounded-[4px] border border-brand/30 bg-brand/5 px-3 py-2 text-[12.5px] text-fg-secondary">
          Server saved {formatMoney(savedTotals.total)} with markup and{' '}
          {formatMoney(savedTotals.withoutMarkupTotal)} without.
        </p>
      ) : null}

      <fieldset disabled={!editable} className="space-y-4">
        <Card title="Quote header">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Site" required>
              <TjxSitePicker
                selected={site}
                onSelect={(next) => {
                  setSite(next)
                  if (next?.province) {
                    setTaxProvince(next.province)
                    setShipProvince(next.province)
                  }
                }}
              />
            </Field>
            <Field label="Quote type">
              <Select
                value={quoteType}
                onChange={(event) =>
                  setQuoteType(event.target.value as 'Gen 1' | 'Gen 2')
                }
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
              <Input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
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
              hint="Blank stores the province rate on save so later table changes cannot rewrite this quote."
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

        <Card title="Ship to">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Contact">
              <Input
                value={shipContactName}
                onChange={(event) => setShipContactName(event.target.value)}
              />
            </Field>
            <Field label="Street">
              <Input value={shipStreet1} onChange={(event) => setShipStreet1(event.target.value)} />
            </Field>
            <Field label="City">
              <Input value={shipCity} onChange={(event) => setShipCity(event.target.value)} />
            </Field>
            <Field label="Province">
              <Input value={shipProvince} onChange={(event) => setShipProvince(event.target.value)} />
            </Field>
            <Field label="Postal code">
              <Input
                value={shipPostalCode}
                onChange={(event) => setShipPostalCode(event.target.value)}
              />
            </Field>
          </div>
        </Card>

        <Card
          title="Rooms and fixtures"
          action={
            <div className="flex items-center gap-2">
              <Select
                aria-label="Add room"
                value={roomChoice}
                onChange={(event) => setRoomChoice(event.target.value)}
                className="w-[180px]"
              >
                <option value="">Choose a room…</option>
                {roomOptions.data?.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="ghost" disabled={!roomChoice} onClick={addRoom}>
                <Plus size={13} aria-hidden="true" /> Add room
              </Button>
            </div>
          }
        >
          {rooms.length === 0 ? (
            <EmptyNote>No rooms yet. Add one, or copy a template on a new quote.</EmptyNote>
          ) : (
            <div className="space-y-4">
              {rooms.map((room) => (
                <div key={room.key} className="rounded-[4px] border border-hair">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hair px-3 py-2">
                    <p className="text-[13px] font-semibold text-fg">{room.roomName}</p>
                    <div className="flex items-center gap-2">
                      <Select
                        aria-label={`Add fixture to ${room.roomName}`}
                        value={fixtureChoice[room.key] ?? ''}
                        onChange={(event) =>
                          setFixtureChoice((current) => ({
                            ...current,
                            [room.key]: event.target.value,
                          }))
                        }
                        className="w-[190px]"
                      >
                        <option value="">Choose a fixture…</option>
                        {fixtureOptions.data?.map((fixture) => (
                          <option key={fixture.id} value={fixture.id}>
                            {fixture.name}
                          </option>
                        ))}
                      </Select>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!fixtureChoice[room.key] || busyRoom === room.key}
                        onClick={() => void addFixture(room.key)}
                      >
                        <Plus size={13} aria-hidden="true" /> Add fixture
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove ${room.roomName}`}
                        onClick={() =>
                          setRooms((current) => current.filter((row) => row.key !== room.key))
                        }
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </Button>
                    </div>
                  </div>

                  {room.fixtures.length === 0 ? (
                    <EmptyNote>No fixtures in this room.</EmptyNote>
                  ) : (
                    <div className="divide-y divide-[var(--hairline)]">
                      {room.fixtures.map((fixture) => (
                        <div key={fixture.key} className="space-y-2 p-3">
                          <div className="flex flex-wrap items-end gap-2">
                            <Field label="Fixture">
                              <Input
                                value={fixture.fixtureName}
                                onChange={(event) =>
                                  updateFixture(room.key, fixture.key, {
                                    fixtureName: event.target.value,
                                  })
                                }
                                className="w-[220px]"
                              />
                            </Field>
                            <Field label="Quantity">
                              <Input
                                value={fixture.quantity}
                                inputMode="decimal"
                                onChange={(event) =>
                                  updateFixture(room.key, fixture.key, {
                                    quantity: event.target.value,
                                  })
                                }
                                className="w-[100px]"
                              />
                            </Field>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="mb-0.5"
                              aria-label={`Remove ${fixture.fixtureName}`}
                              onClick={() =>
                                updateRoom(room.key, {
                                  fixtures: room.fixtures.filter((row) => row.key !== fixture.key),
                                })
                              }
                            >
                              <Trash2 size={13} aria-hidden="true" /> Remove fixture
                            </Button>
                          </div>

                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[720px] text-[12px]">
                              <thead>
                                <tr className="text-left text-[10px] uppercase tracking-[0.08em] text-fg-muted">
                                  <th className="py-1 pr-2 font-semibold">Part</th>
                                  <th className="py-1 pr-2 font-semibold">Type</th>
                                  <th className="py-1 pr-2 font-semibold">Markup</th>
                                  <th className="py-1 pr-2 font-semibold">Ratio / fixture</th>
                                  <th className="py-1 font-semibold" />
                                </tr>
                              </thead>
                              <tbody>
                                {fixture.parts.map((part) => (
                                  <tr key={part.key}>
                                    <td className="py-1 pr-2">
                                      <Input
                                        value={part.partNo}
                                        onChange={(event) =>
                                          updatePart(room.key, fixture.key, part.key, {
                                            partNo: event.target.value.toUpperCase(),
                                          })
                                        }
                                        className="w-[150px]"
                                      />
                                    </td>
                                    <td className="py-1 pr-2">
                                      <Select
                                        value={part.partType}
                                        onChange={(event) =>
                                          updatePart(room.key, fixture.key, part.key, {
                                            partType: event.target.value,
                                          })
                                        }
                                        className="w-[100px]"
                                      >
                                        <option value="">—</option>
                                        <option value="Ballast">Ballast</option>
                                        <option value="Lamp">Lamp</option>
                                      </Select>
                                    </td>
                                    <td className="py-1 pr-2">
                                      <Input
                                        value={part.markup}
                                        inputMode="decimal"
                                        onChange={(event) =>
                                          updatePart(room.key, fixture.key, part.key, {
                                            markup: event.target.value,
                                          })
                                        }
                                        className="w-[90px]"
                                      />
                                    </td>
                                    <td className="py-1 pr-2">
                                      <Input
                                        value={part.ratioPerFixture}
                                        inputMode="decimal"
                                        onChange={(event) =>
                                          updatePart(room.key, fixture.key, part.key, {
                                            ratioPerFixture: event.target.value,
                                          })
                                        }
                                        className="w-[90px]"
                                      />
                                    </td>
                                    <td className="py-1">
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        aria-label={`Remove ${part.partNo}`}
                                        onClick={() =>
                                          updateFixture(room.key, fixture.key, {
                                            parts: fixture.parts.filter(
                                              (row) => row.key !== part.key,
                                            ),
                                          })
                                        }
                                      >
                                        <Trash2 size={12} aria-hidden="true" />
                                      </Button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Special parts"
          action={
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setSpecialParts((current) => [
                  ...current,
                  { key: key('special'), name: '', quantity: '1', unitPrice: '0.00' },
                ])
              }
            >
              <Plus size={13} aria-hidden="true" /> Add special part
            </Button>
          }
        >
          {specialParts.length === 0 ? (
            <EmptyNote>No special parts.</EmptyNote>
          ) : (
            <div className="space-y-2">
              {specialParts.map((part) => (
                <div key={part.key} className="grid items-end gap-2 sm:grid-cols-[1fr_100px_120px_32px]">
                  <Field label="Name">
                    <Input
                      value={part.name}
                      onChange={(event) =>
                        setSpecialParts((current) =>
                          current.map((row) =>
                            row.key === part.key ? { ...row, name: event.target.value } : row,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field label="Quantity">
                    <Input
                      value={part.quantity}
                      inputMode="decimal"
                      onChange={(event) =>
                        setSpecialParts((current) =>
                          current.map((row) =>
                            row.key === part.key ? { ...row, quantity: event.target.value } : row,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field label="Unit price">
                    <Input
                      value={part.unitPrice}
                      inputMode="decimal"
                      onChange={(event) =>
                        setSpecialParts((current) =>
                          current.map((row) =>
                            row.key === part.key ? { ...row, unitPrice: event.target.value } : row,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${part.name || 'special part'}`}
                    onClick={() =>
                      setSpecialParts((current) => current.filter((row) => row.key !== part.key))
                    }
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Part price overrides">
          <p className="mb-3 text-[12px] text-fg-muted">
            Prices are snapshotted per quote. A blank price falls back to the part sell price on the
            first save; after that the quote snapshot is authoritative.
          </p>
          {allPartNumbers.length === 0 ? (
            <EmptyNote>No fixture parts yet.</EmptyNote>
          ) : (
            <div className="space-y-2">
              {allPartNumbers.map((partNo) => {
                const price = quote.prices.find((row) => row.partNo === partNo)
                return (
                  <div
                    key={partNo}
                    className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_160px_160px]"
                  >
                    <div>
                      <p className="text-[12.5px] font-medium text-fg">{partNo}</p>
                      <p className="text-[11px] text-fg-muted">
                        {price
                          ? `${price.source}${price.previousPrice ? ` · was ${price.previousPrice}` : ''}`
                          : 'No snapshot yet'}
                      </p>
                    </div>
                    <Field label="Quote price">
                      <Input
                        value={priceInputs[partNo] ?? ''}
                        placeholder={price?.price ?? 'Master price on save'}
                        inputMode="decimal"
                        onChange={(event) =>
                          setPriceInputs((current) => ({ ...current, [partNo]: event.target.value }))
                        }
                      />
                    </Field>
                    <span className="text-right text-[11.5px] text-fg-muted">
                      {price ? `Snapshot ${price.price}` : 'Resolved on save'}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
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
      </fieldset>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Preview — with markup">
          <dl className="space-y-1 text-[13px]">
            <Row label="Subtotal" value={formatMoney(shownTotals?.subtotal ?? quote.subtotal)} />
            <Row label="Tax" value={formatMoney(shownTotals?.tax ?? quote.tax)} />
            <div className="flex justify-between border-t border-strong pt-1 text-[15px] font-semibold">
              <dt>Total</dt>
              <dd>{formatMoney(shownTotals?.total ?? quote.total)}</dd>
            </div>
          </dl>
        </Card>
        <Card title="Internal — without markup">
          <dl className="space-y-1 text-[13px]">
            <Row
              label="Subtotal"
              value={formatMoney(shownTotals?.withoutMarkupSubtotal ?? quote.withoutMarkupSubtotal)}
            />
            <Row
              label="Tax"
              value={formatMoney(shownTotals?.withoutMarkupTax ?? quote.withoutMarkupTax)}
            />
            <div className="flex justify-between border-t border-strong pt-1 text-[15px] font-semibold">
              <dt>Total</dt>
              <dd>
                {formatMoney(shownTotals?.withoutMarkupTotal ?? quote.withoutMarkupTotal)}
              </dd>
            </div>
          </dl>
        </Card>
      </div>
      {preview.error ? (
        <p className="text-[12px] text-fg-muted">
          Live preview paused: {preview.error} The saved totals above remain the last server values.
        </p>
      ) : (
        <p className="text-[12px] text-fg-muted">
          The preview uses the calculator locally. Saving recalculates both triplets on the server;
          posted totals are never trusted.
        </p>
      )}
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
