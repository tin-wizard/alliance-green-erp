/** Payload fixtures that match the invoicing module's gateway contract. */
import type {
  SageCreditNotePayload,
  SagePurchaseInvoicePayload,
  SageSalesInvoicePayload,
} from '../invoices'

export const salesInvoicePayload: SageSalesInvoicePayload = {
  externalRef: 'cls:sales_invoice:1',
  invoiceNumber: 'INV-2026-0001',
  workOrderNumber: '73850',
  customerName: 'Alliance Lighting',
  invoiceDate: '2026-11-01',
  taxProvince: 'ON',
  subtotal: '100.00',
  tax: '13.00',
  total: '113.00',
  lines: [
    {
      description: 'Labour — 2026-11-01',
      quantity: '1',
      unitPrice: '100.00',
      taxRate: '13',
      lineTotal: '100.00',
    },
  ],
}

export const purchaseInvoicePayload: SagePurchaseInvoicePayload = {
  externalRef: 'cls:subcontractor_invoice:7',
  invoiceNumber: 'SUB-77',
  workOrderNumber: '73850',
  supplierName: 'Liteline Supply',
  invoiceDate: '2026-11-02',
  taxProvince: 'ON',
  subtotal: '250.00',
  tax: '32.50',
  total: '282.50',
  lines: [
    {
      description: 'Recessed fixture',
      partNumber: 'LIT-100',
      quantity: '5',
      unitPrice: '50.00',
      taxRate: '13',
      lineTotal: '250.00',
    },
  ],
}

export const purchaseCreditNotePayload: SageCreditNotePayload = {
  externalRef: 'cls:rga_credit:12',
  creditDate: '2026-11-05',
  contactName: 'Liteline Supply',
  workOrderNumber: '73850',
  subtotal: '-100.00',
  tax: '-13.00',
  total: '-113.00',
  lines: [
    {
      description: 'Returned fixture',
      partNumber: 'LIT-100',
      quantity: '-2',
      unitPrice: '50.00',
      taxRate: '13',
      lineTotal: '-100.00',
    },
  ],
}
