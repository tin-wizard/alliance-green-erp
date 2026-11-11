import { calculateQuoteTotals, type QuoteInput } from '@cls/pricing'
import type {
  QuoteCreateInput,
  QuoteDetail,
  QuoteHourLine,
  QuotePartLine,
  QuoteSpecialLine,
  QuoteTotalsView,
} from '../types'

/** Roles allowed into the internal quote desk. There is no customer portal yet. */
export function isQuoteStaff(role: string): boolean {
  return role === 'admin' || role === 'technician'
}

export function toQuotePricingInput(quote: {
  taxCode: string | null
  appliedTaxRate: string | null
  manualTaxAmount: string | null
  hours: readonly QuoteHourLine[]
  parts: readonly QuotePartLine[]
  specialParts: readonly QuoteSpecialLine[]
}): QuoteInput {
  return {
    taxProvince: quote.taxCode,
    appliedTaxRate: quote.appliedTaxRate,
    manualTaxAmount: quote.manualTaxAmount,
    labour: quote.hours.map((line) => ({
      hours: line.hours,
      numTechs: line.numTechs,
      rate: line.rate,
      incurredHours: line.incurredHours,
      incurredRate: line.incurredRate,
    })),
    parts: quote.parts.map((line) => ({
      partNo: line.partNo,
      qty: line.qty,
      price: line.price,
      costPrice: line.costPrice,
    })),
    specialParts: quote.specialParts.map((line) => ({
      name: line.name,
      qty: line.qty,
      price: line.price,
      costPrice: line.costPrice,
    })),
  }
}

/** Same calculation the editor preview uses, applied to persisted lines. */
export function quoteTotals(quote: {
  taxCode: string | null
  appliedTaxRate: string | null
  manualTaxAmount: string | null
  hours: readonly QuoteHourLine[]
  parts: readonly QuotePartLine[]
  specialParts: readonly QuoteSpecialLine[]
}): QuoteTotalsView {
  return calculateQuoteTotals(toQuotePricingInput(quote))
}

/** Preview totals for unsaved form state; the same pure function the server uses. */
export function previewQuoteTotals(
  header: {
    taxCode?: string | null
    appliedTaxRate?: string | null
    manualTaxAmount?: string | null
  },
  lines: Pick<QuoteCreateInput, 'hours' | 'parts' | 'specialParts'>,
): QuoteTotalsView {
  return calculateQuoteTotals({
    taxProvince: header.taxCode,
    appliedTaxRate: header.appliedTaxRate,
    manualTaxAmount: header.manualTaxAmount,
    labour: lines.hours.map((line) => ({
      hours: line.hours ?? '0',
      numTechs: line.numTechs ?? 1,
      rate: line.rate ?? '0',
      incurredHours: line.incurredHours,
      incurredRate: line.incurredRate,
    })),
    parts: lines.parts.map((line) => ({
      partNo: line.partNo,
      qty: line.qty,
      price: line.price,
      costPrice: line.costPrice,
    })),
    specialParts: lines.specialParts.map((line) => ({
      name: line.name,
      qty: line.qty,
      price: line.price,
      costPrice: line.costPrice,
    })),
  })
}

export function canConvertQuote(quote: {
  status: number
  isDeleted: boolean
  convertedWorkOrderId: number | null
  isLastRevision: boolean
}): boolean {
  return (
    quote.status === 4 &&
    !quote.isDeleted &&
    quote.convertedWorkOrderId === null &&
    quote.isLastRevision
  )
}

export function canReviseQuote(quote: {
  status: number
  isDeleted: boolean
  isLastRevision: boolean
}): boolean {
  return quote.status === 4 && !quote.isDeleted && quote.isLastRevision
}

export function canEditQuote(quote: {
  status: number
  isDeleted: boolean
  isLastRevision: boolean
}): boolean {
  return !quote.isDeleted && quote.isLastRevision && (quote.status === 1 || quote.status === 2)
}

export function quoteCapabilities(
  quote: Pick<
    QuoteDetail,
    'status' | 'isDeleted' | 'isLastRevision' | 'convertedWorkOrderId' | 'kind'
  >,
  grants: Set<string>,
) {
  const has = (key: string) => grants.has(key)
  return {
    canEdit: has('quote:write') && canEditQuote(quote),
    canSubmit: has('quote:write') && canEditQuote(quote),
    canApprove: has('quote:approve') && quote.status === 3 && quote.isLastRevision,
    canRevise: has('quote:write') && canReviseQuote(quote),
    canConvert:
      has('quote:approve') &&
      has('workorder:create') &&
      canConvertQuote(quote),
    canDelete: has('quote:write') && quote.kind === 'standalone' && !quote.isDeleted,
    canRender: has('quote:read'),
  }
}
