/** @jsxRuntime automatic */
/**
 * Packing slip. Quantities are the module's decimal strings: the slip prints
 * what was ordered and shipped and never derives or adjusts a figure.
 */
import { StyleSheet, View } from '@react-pdf/renderer'
import { AddressBlock } from '../components/AddressBlock'
import { DocumentShell } from '../components/DocumentShell'
import type { BrandHeaderMeta } from '../components/BrandHeader'
import { LineTable, type LineTableColumn, type LineTableRow } from '../components/LineTable'
import { Notes, type NotesSection } from '../components/Notes'
import { formatIsoDate } from '../format'
import type { PackingSlipDocumentData } from '../types'

export interface PackingSlipDocumentProps {
  readonly data: PackingSlipDocumentData
}

/** Widths add up to the 516 pt content width. */
const PACKING_SLIP_COLUMNS: readonly LineTableColumn[] = [
  { key: 'position', label: '#', width: 24 },
  { key: 'partNumber', label: 'Part no.', width: 96 },
  { key: 'description', label: 'Description', width: 216 },
  { key: 'quantity', label: 'Ordered', width: 46, align: 'right' },
  { key: 'unit', label: 'Unit', width: 34 },
  { key: 'shipped', label: 'Shipped', width: 46, align: 'right' },
  { key: 'backorder', label: 'Backorder', width: 54, align: 'right' },
]

export function PackingSlipDocument({ data }: PackingSlipDocumentProps) {
  const meta: BrandHeaderMeta[] = [
    { label: 'Issued', value: formatIsoDate(data.issuedOn) ?? data.issuedOn },
  ]
  if (data.shipDate) {
    meta.push({ label: 'Ship date', value: formatIsoDate(data.shipDate) ?? data.shipDate })
  }

  const rows: LineTableRow[] = data.lines.map((line, index) => ({
    key: `${line.position}-${index}`,
    cells: {
      position: String(line.position),
      partNumber: line.partNumber ?? '',
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      shipped: line.shipped,
      backorder: line.backorder,
    },
  }))

  const sections: NotesSection[] = []
  if (data.notes && data.notes.length > 0) sections.push({ heading: 'Notes', lines: data.notes })

  return (
    <DocumentShell title="Packing slip" number={data.number} meta={meta}>
      <View style={styles.addresses}>
        <AddressBlock label="Ship to" data={data.shipTo ?? data.customer} />
      </View>

      <LineTable columns={PACKING_SLIP_COLUMNS} rows={rows} emptyLabel="No line items." />
      <Notes sections={sections} />
    </DocumentShell>
  )
}

const styles = StyleSheet.create({
  addresses: {
    flexDirection: 'row',
    marginBottom: 18,
  },
})
