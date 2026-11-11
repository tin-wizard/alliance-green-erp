/**
 * Invoice money boundary.
 *
 * The only calculator Invoicing calls is `@cls/pricing`. This wrapper exists so
 * the module depends on one local entry point, and so the 28 legacy sales
 * fixture cases can be run against the exact path Invoicing previews use.
 */
import {
  calculateSalesInvoice,
  calculateSubcontractorPurchaseTotals,
  format,
  multiply,
  parseDecimal,
  round,
  type SalesInvoiceInput,
  type SalesInvoiceTotals,
  type SubcontractorPurchaseInput,
  type SubcontractorPurchaseTotals,
} from '@cls/pricing'

export type InvoiceMoneyInput = SalesInvoiceInput
export type InvoiceMoneyTotals = SalesInvoiceTotals
export type PurchaseInvoiceInput = SubcontractorPurchaseInput
export type PurchaseInvoiceTotals = SubcontractorPurchaseTotals

export function previewInvoiceTotals(input: InvoiceMoneyInput): InvoiceMoneyTotals {
  return calculateSalesInvoice(input)
}

export function previewPurchaseInvoiceTotals(
  input: PurchaseInvoiceInput,
): PurchaseInvoiceTotals | null {
  return calculateSubcontractorPurchaseTotals(input)
}

/** A display line amount, rounded before it is accumulated (A2). */
export function lineAmount(qty: string | number, price: string | number): string {
  const q = parseDecimal(String(qty))
  const p = parseDecimal(String(price))
  if (!q || !p) return '0.00'
  return format(round(multiply(q, p), 2), 2)
}
