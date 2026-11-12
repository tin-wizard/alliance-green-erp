/** @jsxRuntime automatic */
/**
 * Customer TJX quote. The with-markup triplet is the only money shown; the
 * without-markup triplet stays on the internal order sheet.
 */
import { StyleSheet, View } from '@react-pdf/renderer'
import { AddressBlock } from '../components/AddressBlock'
import { DocumentShell } from '../components/DocumentShell'
import type { BrandHeaderMeta } from '../components/BrandHeader'
import { LineTable, type LineTableColumn, type LineTableRow } from '../components/LineTable'
import { Notes, type NotesSection } from '../components/Notes'
import { Totals, type TotalsRow } from '../components/Totals'
import { formatIsoDate } from '../format'
import type { TjxQuoteDocumentData } from '../types'

export interface TjxQuoteDocumentProps {
  readonly data: TjxQuoteDocumentData
}

const TJX_QUOTE_COLUMNS: readonly LineTableColumn[] = [
  { key: 'position', label: '#', width: 24 },
  { key: 'partNumber', label: 'Part no.', width: 96 },
  { key: 'description', label: 'Description', width: 238 },
  { key: 'quantity', label: 'Qty', width: 48, align: 'right' },
  { key: 'unitPrice', label: 'Unit price', width: 52, align: 'right' },
  { key: 'lineTotal', label: 'Amount', width: 58, align: 'right' },
]

export function TjxQuoteDocument({ data }: TjxQuoteDocumentProps) {
  const meta: BrandHeaderMeta[] = [
    { label: 'Issued', value: formatIsoDate(data.issuedOn) ?? data.issuedOn },
    { label: 'Type', value: data.quoteType },
  ]
  if (data.gridType) meta.push({ label: 'Grid', value: data.gridType })
  if (data.paymentTerms) meta.push({ label: 'Terms', value: data.paymentTerms })
  if (data.dueDate) meta.push({ label: 'Due', value: formatIsoDate(data.dueDate) ?? data.dueDate })

  const rows: LineTableRow[] = data.lines.map((line, index) => ({
    key: `${line.position}-${index}`,
    cells: {
      position: String(line.position),
      partNumber: line.partNumber ?? '',
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
    },
  }))

  const totals: TotalsRow[] = [
    { label: 'Subtotal', value: data.totals.subtotal },
    { label: data.totals.taxLabel, value: data.totals.tax },
    { label: 'Total', value: data.totals.total, emphasis: true },
  ]

  const sections: NotesSection[] = []
  const scope = data.rooms.flatMap((room) =>
    room.fixtures.length
      ? room.fixtures.map((fixture) => `${room.name} — ${fixture.name} × ${fixture.quantity}`)
      : [`${room.name} — no fixtures`],
  )
  if (scope.length) sections.push({ heading: 'Scope', lines: scope })
  if (data.notes && data.notes.length > 0) sections.push({ heading: 'Notes', lines: data.notes })

  return (
    <DocumentShell
      title="TJX fixture quotation"
      number={data.revision ? `${data.number} · Rev. ${data.revision}` : data.number}
      meta={meta}
    >
      <View style={styles.addresses}>
        <AddressBlock label="Prepared for" data={data.customer} />
        {data.shipTo ? (
          <View style={styles.shipTo}>
            <AddressBlock label="Ship to" data={data.shipTo} />
          </View>
        ) : null}
      </View>

      <LineTable columns={TJX_QUOTE_COLUMNS} rows={rows} emptyLabel="No fixture parts." />
      {data.specialParts.length ? (
        <Notes
          sections={[
            {
              heading: 'Special parts',
              lines: data.specialParts.map(
                (part) => `${part.description} × ${part.quantity} — ${part.lineTotal}`,
              ),
            },
          ]}
        />
      ) : null}
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
})
