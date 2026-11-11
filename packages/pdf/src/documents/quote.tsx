/** @jsxRuntime automatic */
/**
 * Customer quote / revision. The owning module maps its snapshot into
 * `QuoteDocumentData`; this component only lays it out.
 */
import { StyleSheet, View } from '@react-pdf/renderer'
import { AddressBlock } from '../components/AddressBlock'
import { DocumentShell } from '../components/DocumentShell'
import type { BrandHeaderMeta } from '../components/BrandHeader'
import { LineTable, type LineTableColumn, type LineTableRow } from '../components/LineTable'
import { Notes, type NotesSection } from '../components/Notes'
import { Totals, type TotalsRow } from '../components/Totals'
import { formatIsoDate } from '../format'
import type { QuoteDocumentData } from '../types'

export interface QuoteDocumentProps {
  readonly data: QuoteDocumentData
}

/** Widths add up to the 516 pt content width. */
const QUOTE_COLUMNS: readonly LineTableColumn[] = [
  { key: 'position', label: '#', width: 24 },
  { key: 'partNumber', label: 'Part no.', width: 92 },
  { key: 'description', label: 'Description', width: 184 },
  { key: 'quantity', label: 'Qty', width: 42, align: 'right' },
  { key: 'unit', label: 'Unit', width: 34 },
  { key: 'unitPrice', label: 'Unit price', width: 66, align: 'right' },
  { key: 'lineTotal', label: 'Amount', width: 74, align: 'right' },
]

export function QuoteDocument({ data }: QuoteDocumentProps) {
  const meta: BrandHeaderMeta[] = [
    { label: 'Issued', value: formatIsoDate(data.issuedOn) ?? data.issuedOn },
  ]
  if (data.validUntil) {
    meta.push({ label: 'Valid until', value: formatIsoDate(data.validUntil) ?? data.validUntil })
  }

  const number = data.revision ? `${data.number} · Rev. ${data.revision}` : data.number

  const rows: LineTableRow[] = data.lines.map((line, index) => ({
    key: `${line.position}-${index}`,
    cells: {
      position: String(line.position),
      partNumber: line.partNumber ?? '',
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
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
  if (data.notes && data.notes.length > 0) sections.push({ heading: 'Notes', lines: data.notes })
  if (data.terms && data.terms.length > 0) sections.push({ heading: 'Terms', lines: data.terms })

  return (
    <DocumentShell title="Quotation" number={number} meta={meta}>
      <View style={styles.addresses}>
        <AddressBlock label="Prepared for" data={data.customer} />
        {data.shipTo ? (
          <View style={styles.shipTo}>
            <AddressBlock label="Ship to" data={data.shipTo} />
          </View>
        ) : null}
      </View>

      <LineTable columns={QUOTE_COLUMNS} rows={rows} emptyLabel="No line items." />
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
