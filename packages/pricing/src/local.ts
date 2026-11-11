/**
 * Local work-order flavour.
 *
 * A local work order uses the same calculator as a subcontractor one, but the
 * legacy submit path hard-codes Ontario for the non-project flavour:
 * `local_calc_submit.php:99-100` posts/forces ON, while
 * `local_calc_projectworkorder_submit.php` keeps the province. The calculator
 * itself honours whatever province it is given (the fixture
 * `local-endpoint-accepts-province-but-submit-forces-on` pins that), so the
 * forcing belongs here, at the boundary, not inside the maths.
 */
import {
  calculateSalesInvoice,
  type SalesInvoiceInput,
  type SalesInvoiceTotals,
} from './sales'

export type LocalWorkKind = 'local' | 'local_project'

export function resolveLocalTaxProvince(
  kind: LocalWorkKind,
  province: string | null | undefined,
): string {
  return kind === 'local' ? 'ON' : (province ?? '')
}

export function calculateLocalInvoiceTotals(
  kind: LocalWorkKind,
  input: SalesInvoiceInput,
): SalesInvoiceTotals & { calcType: LocalWorkKind } {
  return {
    ...calculateSalesInvoice({
      ...input,
      taxProvince: resolveLocalTaxProvince(kind, input.taxProvince),
    }),
    calcType: kind,
  }
}
