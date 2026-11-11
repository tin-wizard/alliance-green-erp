/**
 * Receipts and vendor payments, and the journals that carry opening positions.
 *
 * `contact_payment` (v3.1) takes the allocations inline, which is what makes a
 * historical receipt reconstructable in one call:
 *
 *   POST /contact_payments
 *   { "contact_payment": {
 *       "contact_id": "…", "bank_account_id": "…", "date": "2026-01-31",
 *       "total_amount": "1234.56", "reference": "s50:payment:8842",
 *       "allocated_artefacts": [ { "artefact_id": "…", "amount": "1234.56" } ] } }
 *
 * A receipt whose allocations do not add up to its total is refused here, before
 * the API sees it: a partially allocated receipt looks like a payment with
 * leftover cash, and the ageing quietly changes.
 */
import { SageError } from '../errors'
import { fromCents, toCents } from './common'

export interface ContactPaymentInput {
  externalRef: string
  date: string
  contactId: string
  bankAccountId: string
  totalAmount: string
  paymentMethodId?: string | null
  reference?: string | null
  notes?: string | null
  allocations: { artefactId: string; amount: string }[]
}

export interface MappedContactPayment {
  path: 'contact_payments'
  body: Record<string, unknown>
  reference: string
}

export function mapContactPayment(input: ContactPaymentInput): MappedContactPayment {
  if (input.allocations.length === 0) {
    throw new SageError(
      'permanent',
      'ALLOCATION_MISSING',
      `Payment ${input.externalRef} has no allocated invoices; it would post as unapplied cash.`,
    )
  }
  const total = toCents(input.totalAmount)
  const allocated = input.allocations.reduce((sum, line) => sum + toCents(line.amount), 0)
  if (Math.abs(total - allocated) > 0) {
    throw new SageError(
      'permanent',
      'ALLOCATION_TOTAL_MISMATCH',
      `Payment ${input.externalRef} is ${fromCents(total)} but its allocations add to ${fromCents(allocated)}.`,
    )
  }
  if (!input.bankAccountId) {
    throw new SageError(
      'permanent',
      'BANK_ACCOUNT_MISSING',
      `Payment ${input.externalRef} has no bank account; the bookkeeper must map the stream first.`,
    )
  }
  return {
    path: 'contact_payments',
    reference: input.externalRef,
    body: {
      contact_payment: {
        contact_id: input.contactId,
        bank_account_id: input.bankAccountId,
        date: input.date,
        total_amount: fromCents(total),
        ...(input.paymentMethodId ? { payment_method_id: input.paymentMethodId } : {}),
        reference: input.reference ?? input.externalRef,
        ...(input.notes ? { notes: input.notes } : {}),
        allocated_artefacts: input.allocations.map((line) => ({
          artefact_id: line.artefactId,
          amount: fromCents(toCents(line.amount)),
        })),
      },
    },
  }
}

export interface JournalLineInput {
  ledgerAccountId: string
  description: string
  debit?: string
  credit?: string
}

export interface JournalInput {
  externalRef: string
  date: string
  lines: JournalLineInput[]
  notes?: string | null
}

export interface MappedJournal {
  path: 'journals'
  body: Record<string, unknown>
  reference: string
}

export function mapJournal(input: JournalInput): MappedJournal {
  if (input.lines.length === 0) {
    throw new SageError('permanent', 'JOURNAL_EMPTY', `Journal ${input.externalRef} has no lines.`)
  }
  let debit = 0
  let credit = 0
  const lines = input.lines.map((line) => {
    const debitCents = line.debit ? toCents(line.debit) : 0
    const creditCents = line.credit ? toCents(line.credit) : 0
    if ((debitCents === 0) === (creditCents === 0)) {
      throw new SageError(
        'permanent',
        'JOURNAL_LINE_INVALID',
        `Journal ${input.externalRef} line "${line.description}" must have exactly one of debit or credit.`,
      )
    }
    debit += debitCents
    credit += creditCents
    return {
      ledger_account_id: line.ledgerAccountId,
      description: line.description,
      debit: fromCents(debitCents),
      credit: fromCents(creditCents),
    }
  })
  if (debit !== credit) {
    throw new SageError(
      'permanent',
      'JOURNAL_UNBALANCED',
      `Journal ${input.externalRef} debits ${fromCents(debit)} but credits ${fromCents(credit)}.`,
    )
  }
  return {
    path: 'journals',
    reference: input.externalRef,
    body: {
      journal: {
        date: input.date,
        reference: input.externalRef,
        ...(input.notes ? { notes: input.notes } : {}),
        journal_lines: lines,
      },
    },
  }
}

/**
 * Account-level opening position for one contact at cut-off. Paid state never
 * travels this way: it is reconstructed with `contact_payments` per receipt.
 */
export function mapOpeningJournal(input: {
  snapshotId: string
  contactId: string
  date: string
  lines: JournalLineInput[]
  receivableAccountId?: string | null
  payableAccountId?: string | null
}): MappedJournal {
  return mapJournal({
    externalRef: `cutover:${input.snapshotId}:${input.contactId}`,
    date: input.date,
    notes: 'Opening position at conversion',
    lines: input.lines,
  })
}
