import { describe, expect, test } from 'vitest'
import { isSageError } from '../errors'
import { mapPurchaseCreditNote, mapSalesCreditNote } from './credit-note'
import { mapSalesInvoice } from './documents'
import { mapContactPayment, mapJournal, mapOpeningJournal } from './payments'
import type { DocumentMappingContext } from './common'
import { purchaseCreditNotePayload, salesInvoicePayload } from '../testing/payloads'

function context(overrides: Partial<DocumentMappingContext> = {}): DocumentMappingContext {
  return {
    contactId: 'contact_1',
    ledgerAccountId: 'account_sales',
    roundingLedgerAccountId: 'account_rounding',
    taxRateIdFor: (percent) => `tax_${percent}`,
    productIdFor: (partNumber) => (partNumber ? `product_${partNumber}` : null),
    ...overrides,
  }
}

/** Runs a mapping that must fail and returns the Sage error code. */
function failureCode(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    if (isSageError(error)) return error.code
    throw error
  }
  throw new Error('Expected the mapping to fail with a SageError, but it succeeded.')
}

describe('invoice mapping', () => {
  test('reproduces the stored totals and sends no total field', () => {
    const mapped = mapSalesInvoice(salesInvoicePayload, context())
    expect(mapped.netCents).toBe(10_000)
    expect(mapped.taxCents).toBe(1_300)
    expect(mapped.roundingAdded).toBe(false)
    const body = mapped.body.sales_invoice as Record<string, unknown>
    expect(body.reference).toBe('cls:sales_invoice:1')
    expect(body.total_amount).toBeUndefined()
    expect(body.invoice_lines).toHaveLength(1)
  })

  test('adds an explicit rounding line when the line arithmetic misses the cent', () => {
    const payload = {
      ...salesInvoicePayload,
      lines: [
        {
          description: 'Three at 33.333',
          quantity: '3',
          unitPrice: '33.33',
          taxRate: '13',
          lineTotal: '100.00',
        },
      ],
      subtotal: '100.00',
      tax: '13.00',
      total: '113.00',
    }
    const mapped = mapSalesInvoice(payload, context())
    expect(mapped.roundingAdded).toBe(true)
    const lines = (mapped.body.sales_invoice as Record<string, unknown>).invoice_lines as Record<
      string,
      unknown
    >[]
    expect(lines).toHaveLength(2)
    expect(lines[1]?.description).toBe('Rounding adjustment')
    expect(lines[1]?.ledger_account_id).toBe('account_rounding')
    expect(mapped.netCents).toBe(10_000)
  })

  test('refuses a difference when no rounding account is configured', () => {
    const payload = {
      ...salesInvoicePayload,
      lines: [
        {
          description: 'Odd price',
          quantity: '1',
          unitPrice: '99.99',
          taxRate: '13',
          lineTotal: '100.00',
        },
      ],
    }
    expect(
      failureCode(() => mapSalesInvoice(payload, context({ roundingLedgerAccountId: null }))),
    ).toBe('ROUNDING_UNRESOLVED')
  })

  test('refuses when tax cannot be reproduced, naming both values', () => {
    expect(
      failureCode(() =>
        mapSalesInvoice({ ...salesInvoicePayload, tax: '12.00', total: '112.00' }, context()),
      ),
    ).toBe('TOTAL_MISMATCH')
  })
})

describe('credit notes', () => {
  test('a purchase credit posts negative lines to the credit-note collection', () => {
    const mapped = mapPurchaseCreditNote(purchaseCreditNotePayload, context())
    expect(mapped.path).toBe('purchase_credit_notes')
    const body = mapped.body.purchase_credit_note as Record<string, unknown>
    expect(body.reference).toBe('cls:rga_credit:12')
    const lines = body.invoice_lines as Record<string, unknown>[]
    expect(lines[0]?.quantity).toBe('-2')
    expect(mapped.netCents).toBe(-10_000)
    expect(mapped.taxCents).toBe(-1_300)
  })

  test('a sales credit note keeps its own path', () => {
    const mapped = mapSalesCreditNote(
      { ...purchaseCreditNotePayload, externalRef: 'cls:sales_credit_note:3' },
      context(),
    )
    expect(mapped.path).toBe('sales_credit_notes')
  })
})

describe('payment mapping', () => {
  const payment = {
    externalRef: 's50:payment:8842',
    date: '2026-01-31',
    contactId: 'contact_1',
    bankAccountId: 'bank_1',
    totalAmount: '113.00',
    allocations: [
      { artefactId: 'sales_invoices_1', amount: '100.00' },
      { artefactId: 'sales_invoices_2', amount: '13.00' },
    ],
  }

  test('carries the allocations inline and normalises the amounts', () => {
    const mapped = mapContactPayment(payment)
    const body = mapped.body.contact_payment as Record<string, unknown>
    expect(body.bank_account_id).toBe('bank_1')
    expect(body.total_amount).toBe('113.00')
    expect(body.allocated_artefacts).toEqual([
      { artefact_id: 'sales_invoices_1', amount: '100.00' },
      { artefact_id: 'sales_invoices_2', amount: '13.00' },
    ])
  })

  test('refuses allocations that do not add up to the receipt', () => {
    expect(
      failureCode(() =>
        mapContactPayment({ ...payment, allocations: [{ artefactId: 'a', amount: '100.00' }] }),
      ),
    ).toBe('ALLOCATION_TOTAL_MISMATCH')
  })

  test('refuses a receipt with no bank account rather than inventing one', () => {
    expect(failureCode(() => mapContactPayment({ ...payment, bankAccountId: '' }))).toBe(
      'BANK_ACCOUNT_MISSING',
    )
  })

  test('refuses a receipt with no allocations', () => {
    expect(failureCode(() => mapContactPayment({ ...payment, allocations: [] }))).toBe(
      'ALLOCATION_MISSING',
    )
  })
})

describe('journal mapping', () => {
  test('an opening position is a balanced journal with the cutover reference', () => {
    const mapped = mapOpeningJournal({
      snapshotId: '2026-11-01',
      contactId: 'contact_1',
      date: '2026-11-01',
      lines: [
        { ledgerAccountId: 'ar', description: 'Opening receivable', debit: '113.00' },
        { ledgerAccountId: 'equity', description: 'Opening position', credit: '113.00' },
      ],
    })
    expect(mapped.reference).toBe('cutover:2026-11-01:contact_1')
    expect(mapped.path).toBe('journals')
  })

  test('an unbalanced journal is refused before it is sent', () => {
    expect(
      failureCode(() =>
        mapJournal({
          externalRef: 'cutover:x',
          date: '2026-11-01',
          lines: [
            { ledgerAccountId: 'ar', description: 'debit', debit: '10.00' },
            { ledgerAccountId: 'equity', description: 'credit', credit: '9.00' },
          ],
        }),
      ),
    ).toBe('JOURNAL_UNBALANCED')
  })
})
