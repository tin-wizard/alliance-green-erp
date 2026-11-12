/** @jsxRuntime automatic */
/**
 * Internal TJX order sheet. Customer-facing never uses this kind: it exposes
 * both money triplets and the fixture scope the customer PDF omits.
 */
import { StyleSheet, Text, View } from '@react-pdf/renderer'
import { AddressBlock } from '../components/AddressBlock'
import { DocumentShell } from '../components/DocumentShell'
import type { BrandHeaderMeta } from '../components/BrandHeader'
import { LineTable, type LineTableColumn, type LineTableRow } from '../components/LineTable'
import { Notes, type NotesSection } from '../components/Notes'
import { Totals, type TotalsRow } from '../components/Totals'
import { formatIsoDate } from '../format'
import { COLORS, FONT_BODY, FONT_SIZE } from '../theme'
import type { TjxOrderSheetDocumentData } from '../types'

export interface TjxOrderSheetDocumentProps {
  readonly data: TjxOrderSheetDocumentData
}

const SCOPE_COLUMNS: readonly LineTableColumn[] = [
  { key: 'room', label: 'Room', width: 150 },
  { key: 'fixture', label: 'Fixture', width: 260 },
  { key: 'quantity', label: 'Qty', width: 70, align: 'right' },
]

const PART_COLUMNS: readonly LineTableColumn[] = [
  { key: 'position', label: '#', width: 24 },
  { key: 'partNumber', label: 'Part no.', width: 90 },
  { key: 'description', label: 'Description', width: 150 },
  { key: 'qtyWithMarkup', label: 'Qty / markup', width: 50, align: 'right' },
  { key: 'qtyWithoutMarkup', label: 'Qty / cost', width: 56, align: 'right' },
  { key: 'unitPrice', label: 'Unit price', width: 50, align: 'right' },
  { key: 'lineWithMarkup', label: 'With', width: 48, align: 'right' },
  { key: 'lineWithoutMarkup', label: 'Without', width: 48, align: 'right' },
]

export function TjxOrderSheetDocument({ data }: TjxOrderSheetDocumentProps) {
  const meta: BrandHeaderMeta[] = [
    { label: 'Issued', value: formatIsoDate(data.issuedOn) ?? data.issuedOn },
    { label: 'Type', value: data.quoteType },
  ]
  if (data.gridType) meta.push({ label: 'Grid', value: data.gridType })
  if (data.paymentTerms) meta.push({ label: 'Terms', value: data.paymentTerms })
  if (data.workOrders?.length) {
    meta.push({ label: 'Work orders', value: data.workOrders.join(', ') })
  }

  const scopeRows: LineTableRow[] = data.rooms.flatMap((room, roomIndex) =>
    (room.fixtures.length ? room.fixtures : [{ name: 'No fixtures', quantity: '0' }]).map(
      (fixture, fixtureIndex) => ({
        key: `${roomIndex}-${fixtureIndex}`,
        cells: {
          room: room.name,
          fixture: fixture.name,
          quantity: fixture.quantity,
        },
      }),
    ),
  )

  const partRows: LineTableRow[] = data.lines.map((line, index) => ({
    key: `${line.position}-${index}`,
    cells: {
      position: String(line.position),
      partNumber: line.partNumber ?? '',
      description: line.description,
      qtyWithMarkup: line.qtyWithMarkup,
      qtyWithoutMarkup: line.qtyWithoutMarkup,
      unitPrice: line.unitPrice,
      lineWithMarkup: line.lineWithMarkup,
      lineWithoutMarkup: line.lineWithoutMarkup,
    },
  }))

  const totals: TotalsRow[] = [
    { label: 'Subtotal with markup', value: data.totals.withMarkup.subtotal },
    { label: data.totals.withMarkup.taxLabel, value: data.totals.withMarkup.tax },
    { label: 'Total with markup', value: data.totals.withMarkup.total, emphasis: true },
    { label: 'Subtotal without markup', value: data.totals.withoutMarkup.subtotal },
    { label: data.totals.withoutMarkup.taxLabel, value: data.totals.withoutMarkup.tax },
    { label: 'Total without markup', value: data.totals.withoutMarkup.total, emphasis: true },
  ]

  const sections: NotesSection[] = []
  if (data.specialParts.length) {
    sections.push({
      heading: 'Special parts',
      lines: data.specialParts.map(
        (part) => `${part.description} × ${part.quantity} — ${part.lineTotal}`,
      ),
    })
  }
  if (data.notes && data.notes.length > 0) sections.push({ heading: 'Notes', lines: data.notes })

  return (
    <DocumentShell
      title="TJX order sheet — internal"
      number={data.revision ? `${data.number} · Rev. ${data.revision}` : data.number}
      meta={meta}
      footerNote="Alliance Lighting · Internal — not for customer distribution"
    >
      <View style={styles.addresses}>
        <AddressBlock label="Customer" data={data.customer} />
        {data.shipTo ? (
          <View style={styles.shipTo}>
            <AddressBlock label="Ship to" data={data.shipTo} />
          </View>
        ) : null}
      </View>

      <Text style={styles.heading}>Scope</Text>
      <LineTable columns={SCOPE_COLUMNS} rows={scopeRows} emptyLabel="No rooms." />

      <Text style={styles.heading}>Parts — both views</Text>
      <LineTable columns={PART_COLUMNS} rows={partRows} emptyLabel="No fixture parts." />
      <Totals rows={totals} />
      <Notes sections={sections} />
    </DocumentShell>
  )
}

const styles = StyleSheet.create({
  addresses: {
    flexDirection: 'row',
    marginBottom: 18,
  },
  shipTo: {
    marginLeft: 36,
  },
  heading: {
    marginTop: 14,
    marginBottom: 6,
    fontFamily: FONT_BODY,
    fontSize: FONT_SIZE.small,
    fontWeight: 600,
    color: COLORS.ink,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
})
