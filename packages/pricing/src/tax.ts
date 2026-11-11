/**
 * Canadian sales tax tables.
 *
 * Two tables live here and they are deliberately different:
 *
 *  - `SALES_TAX_TABLE` — the invoice calculator (`ajaxCalcTotal.php:26-43`).
 *    BC/MB/QC/SK are GST-only 5% and the GST-only variants (BCG/MBG/QCG/SKG)
 *    behave identically. Blank defaults to Ontario HST 13%.
 *  - `PURCHASE_TAX_TABLE` — the subcontractor purchase calculator
 *    (`functions.php:4183-4213`), with split PST and a Manitoba rate that
 *    depends on the invoice date. `appliedtaxrate` overrides both.
 *
 * Do not merge them. BUSINESS-RULES A9 and A12 record the divergence.
 */
import { parseDecimal, type Decimal } from './decimal'

export interface TaxRate {
  /** Combined rate used for the calculation. */
  rate: Decimal
  /** Provincial portion, when the legacy table splits it. Display only. */
  pst?: Decimal
  /** Sage tax code letter used by the legacy screens ("G", "H"). */
  sageLetter: 'G' | 'H'
  sageLabel: string
}

function rate(value: string, sageLetter: 'G' | 'H', sageLabel: string, pst?: string): TaxRate {
  const parsed = parseDecimal(value)
  if (!parsed) throw new Error(`Invalid tax rate in table: ${value}`)
  return {
    rate: parsed,
    ...(pst ? { pst: parseDecimal(pst) ?? undefined } : {}),
    sageLetter,
    sageLabel,
  }
}

export const SALES_TAX_TABLE = {
  AB: rate('0.05', 'G', 'G - GST 5%'),
  BC: rate('0.05', 'G', 'G - GST 5%'),
  BCG: rate('0.05', 'G', 'G - GST 5%'),
  MB: rate('0.05', 'G', 'G - GST 5%'),
  MBG: rate('0.05', 'G', 'G - GST 5%'),
  NB: rate('0.15', 'H', 'H - HST 15%'),
  NL: rate('0.15', 'H', 'H - HST 15%'),
  NS: rate('0.14', 'H', 'H - HST 14%'),
  NT: rate('0.05', 'G', 'G - GST 5%'),
  NU: rate('0.05', 'G', 'G - GST 5%'),
  ON: rate('0.13', 'H', 'H - HST 13%'),
  PE: rate('0.15', 'H', 'H - HST 15%'),
  // The legacy list spells PEI "PE"; accept both spellings for imports.
  PEI: rate('0.15', 'H', 'H - HST 15%'),
  QC: rate('0.05', 'G', 'G - GST 5%'),
  QCG: rate('0.05', 'G', 'G - GST 5%'),
  SK: rate('0.05', 'G', 'G - GST 5%'),
  SKG: rate('0.05', 'G', 'G - GST 5%'),
  YT: rate('0.05', 'G', 'G - GST 5%'),
} as const

export type SalesTaxProvince = keyof typeof SALES_TAX_TABLE

/** Blank or unknown province falls back to Ontario, exactly like the legacy code. */
export function normalizeSalesProvince(province: string | null | undefined): SalesTaxProvince {
  const key = (province ?? '').trim().toUpperCase()
  return (key in SALES_TAX_TABLE ? key : 'ON') as SalesTaxProvince
}

export function salesTaxRate(province: string | null | undefined): TaxRate & {
  province: SalesTaxProvince
} {
  const normalized = normalizeSalesProvince(province)
  return { ...SALES_TAX_TABLE[normalized], province: normalized }
}

/**
 * Subcontractor purchase rates. Returns null for an unknown province so the
 * caller can fall back to the function's 13% default.
 */
export function purchaseTaxRate(
  province: string | null | undefined,
  invoiceDate: string | null | undefined,
): TaxRate {
  const key = (province ?? '').trim().toUpperCase()
  switch (key) {
    case 'AB':
      return rate('0.05', 'G', 'G - GST 5%')
    case 'BC':
      return rate('0.12', 'G', 'G - GST 5% + PST 7%', '0.07')
    case 'BCG':
      return rate('0.05', 'G', 'G - GST 5%')
    case 'MB':
      return isBeforeJuly2019(invoiceDate)
        ? rate('0.13', 'G', 'G - GST 5% + PST 8%', '0.08')
        : rate('0.12', 'G', 'G - GST 5% + PST 7%', '0.07')
    case 'MBG':
      return rate('0.05', 'G', 'G - GST 5%')
    case 'NB':
      return rate('0.15', 'H', 'H - HST 15%')
    case 'NL':
      return rate('0.15', 'H', 'H - HST 15%')
    case 'NS':
      return rate('0.14', 'H', 'H - HST 14%')
    case 'ON':
      return rate('0.13', 'H', 'H - HST 13%')
    case 'PE':
    case 'PEI':
      return rate('0.15', 'H', 'H - HST 15%')
    case 'QC':
      return rate('0.14975', 'G', 'G - GST 5% + QST 9.975%', '0.09975')
    case 'QCG':
      return rate('0.05', 'G', 'G - GST 5%')
    case 'SK':
      return rate('0.11', 'G', 'G - GST 5% + PST 6%', '0.06')
    case 'SKG':
      return rate('0.05', 'G', 'G - GST 5%')
    case 'YT':
      return rate('0.05', 'G', 'G - GST 5%')
    default:
      // The legacy function starts at 0.13 and only replaces it on a match.
      return rate('0.13', 'H', 'H - HST 13%')
  }
}

/**
 * `is_purchase_invoice_date_before_july_2019` (`functions.php:4615`): the
 * invoice date is the earliest `wo_hours.date`; no hours means "before".
 */
export function isBeforeJuly2019(date: string | null | undefined): boolean {
  const text = (date ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return true
  return text.slice(0, 10) < '2019-07-01'
}
