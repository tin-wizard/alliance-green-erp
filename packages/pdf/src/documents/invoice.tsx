/** @jsxRuntime automatic */
/**
 * Customer sales invoice. The owning module maps the stored invoice snapshot
 * into `InvoiceDocumentData`; this component never calculates money.
 */
import { StyleSheet, View } from '@react-pdf/renderer'
import { AddressBlock } from '../components/AddressBlock'
import { DocumentShell } from '../components/DocumentShell'
import type { BrandHeaderMeta } from '../components/BrandHeader'
import { LineTable, type LineTableColumn, type LineTableRow } from '../components/LineTable'
import { Notes, type NotesSection } from '../components/Notes'
import { Totals, type TotalsRow } from '../components/Totals'
import { formatIsoDate } from '../format'
import type { InvoiceDocumentData } from '../types'

export interface InvoiceDocumentProps {
  readonly data: InvoiceDocumentData
}

const INVOICE_COLUMNS: readonly LineTableColumn[] = [
  { key: 'position', label: '#', width: 24 },
  { key: 'partNumber', label: 'Part no.', width: 84 },
  { key: 'description', label: 'Description', width: 188 },
  { key: 'quantity', label: 'Qty', width: 44, align: 'right' },
  { key: 'unit', label: 'Unit', width: 34 },
  { key: 'unitPrice', label: 'Unit price', width: 70, align: 'right' },
  { key: 'lineTotal', label: 'Amount', width: 72, align: 'right' },
]

export function InvoiceDocument({ data }: InvoiceDocumentProps) {
  const meta: BrandHeaderMeta[] = [
    { label: 'Invoice date', value: formatIsoDate(data.issuedOn) ?? data.issuedOn },
  ]
  if (data.dueDate) {
    meta.push({ label: 'Due', value: formatIsoDate(data.dueDate) ?? data.dueDate })
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
    <DocumentShell title="Invoice" number={data.number} meta={meta}>
      <View style={styles.addresses}>
        <AddressBlock label="Bill to" data={data.customer} />
        {data.shipTo ? (
          <View style={styles.shipTo}>
            <AddressBlock label="Site" data={data.shipTo} />
          </View>
        ) : null}
      </View>

      <LineTable columns={INVOICE_COLUMNS} rows={rows} emptyLabel="No line items." />
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
