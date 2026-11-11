/** @jsxRuntime automatic */
/**
 * Return goods authorization. The RGA module maps committed rows into
 * `RgaDocumentData`; this component prints quantities, never recalculates them.
 */
import { StyleSheet, View } from '@react-pdf/renderer'
import { AddressBlock } from '../components/AddressBlock'
import { DocumentShell } from '../components/DocumentShell'
import type { BrandHeaderMeta } from '../components/BrandHeader'
import { LineTable, type LineTableColumn, type LineTableRow } from '../components/LineTable'
import { Notes, type NotesSection } from '../components/Notes'
import { formatIsoDate } from '../format'
import type { RgaDocumentData } from '../types'

export interface RgaDocumentProps {
  readonly data: RgaDocumentData
}

const RGA_COLUMNS: readonly LineTableColumn[] = [
  { key: 'position', label: '#', width: 24 },
  { key: 'partNumber', label: 'Part no.', width: 84 },
  { key: 'description', label: 'Description', width: 170 },
  { key: 'quantity', label: 'Ordered', width: 52, align: 'right' },
  { key: 'returnQuantity', label: 'Return', width: 52, align: 'right' },
  { key: 'unitPrice', label: 'Unit price', width: 64, align: 'right' },
  { key: 'reason', label: 'Reason', width: 70 },
]

export function RgaDocument({ data }: RgaDocumentProps) {
  const meta: BrandHeaderMeta[] = [
    { label: 'Requested', value: formatIsoDate(data.issuedOn) ?? data.issuedOn },
    { label: 'Type', value: data.typeLabel },
    { label: 'Status', value: data.statusLabel },
  ]
  if (data.purchaseOrderNumber) {
    meta.push({ label: 'Purchase order', value: data.purchaseOrderNumber })
  }
  if (data.workOrderNumber) {
    meta.push({ label: 'Work order', value: data.workOrderNumber })
  }

  const rows: LineTableRow[] = data.lines.map((line, index) => ({
    key: `${line.position}-${index}`,
    cells: {
      position: String(line.position),
      partNumber: line.partNumber ?? '',
      description: line.description,
      quantity: line.quantity,
      returnQuantity: line.returnQuantity,
      unitPrice: line.unitPrice,
      reason: line.reason ?? '',
    },
  }))

  const sections: NotesSection[] = []
  if (data.notes && data.notes.length > 0) sections.push({ heading: 'Notes', lines: data.notes })
  sections.push({
    heading: 'Return instructions',
    lines: ['Quote the RGA number on the packing slip and on all correspondence.'],
  })

  return (
    <DocumentShell title="Return goods authorization" number={data.number} meta={meta}>
      <View style={styles.addresses}>
        {data.supplier ? <AddressBlock label="Supplier" data={data.supplier} /> : null}
        {data.site ? (
          <View style={styles.site}>
            <AddressBlock label="Return from site" data={data.site} />
          </View>
        ) : null}
      </View>
      <LineTable columns={RGA_COLUMNS} rows={rows} emptyLabel="No return lines." />
      <Notes sections={sections} />
    </DocumentShell>
  )
}

const styles = StyleSheet.create({
  addresses: {
    flexDirection: 'row',
    marginBottom: 18,
  },
  site: {
    marginLeft: 36,
  },
})
