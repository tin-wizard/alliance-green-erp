/**
 * @cls/pricing — pure money calculators shared by Work Orders and Invoicing.
 *
 * Two entry points, deliberately separate:
 *  - `calculateSalesInvoice` / `calculateProjectWorkOrderTotals` — the sales
 *    invoice rules (BUSINESS-RULES A1-A8), fixture-proven against
 *    `app/ajaxCalcTotal.php` and `app/ajaxCalcTotalSubProjectWo.php`.
 *  - `calculateSubcontractorPurchaseTotals` — the subcontractor purchase rules
 *    (A12-A18), fixture-proven against `get_sub_purchase_invoice_totals()`.
 *
 * No database, no React, no environment. Both modules must call these rather
 * than reimplementing rounding.
 */
export * from './decimal'
export * from './tax'
export * from './sales'
export * from './purchase'
export {
  calculateLocalInvoiceTotals,
  resolveLocalTaxProvince,
  type LocalWorkKind,
} from './local'
