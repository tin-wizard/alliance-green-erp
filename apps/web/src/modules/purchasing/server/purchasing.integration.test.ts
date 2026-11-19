/**
 * Purchasing integration tests.
 *
 * Real Neon branch, every test rolls back. Covers the approval control
 * (self-approval, edit-after-approval reset, denied approval), receiving and
 * stock posting idempotency, invoice matching and the receipt gate, supplier
 * credits (sign, PO caps, AP balancing, permission), numbering, plus
 * RFQ/pre-order idempotency and supplier scoping.
 */
import { and, eq } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

import { getConfig } from '@cls/core/env.server'
import { ALL_PERMISSIONS, ConflictError, ForbiddenError, ValidationError } from '@cls/core'
import { getDb, type Tx } from '@cls/db'
import {
  auditLog,
  inventoryMovements,
  purchaseOrderApprovals,
  purchaseOrderInvoiceLines,
  purchaseOrderInvoices,
  purchaseOrderPreorderParts,
  purchaseOrderPreorders,
  purchaseOrderRfqLines,
  purchaseOrderRfqSuppliers,
  purchaseOrderStatusHistory,
  purchaseOrders,
  suppliers,
  users,
} from '@cls/db/schema'
import { add, compare, parseDecimal } from '@cls/pricing'
import type { AuthSessionView } from '../../../server/auth.types'
import type { CreateSupplierCreditInput, PurchaseOrderCreateInput } from '../types'
import { createPurchaseOrderCore } from './create.server'
import { createSupplierCreditCore } from './credits.server'
import { getPurchaseOrderDetail } from './get.server'
import {
  closePurchaseOrderInvoiceCore,
  createPurchaseOrderInvoiceCore,
} from './invoices.server'
import { allocatePurchaseOrderNumber } from './numbering.server'
import { receivePurchaseOrderCore } from './receipts.server'
import {
  awardRfq,
  convertPreorder,
  createPreorder,
  createRfq,
  submitSupplierQuote,
} from './sourcing.server'
import { transitionPurchaseOrderCore } from './transition.server'

const ADMIN_A = '00000000-0000-4000-8000-0000000000a1'
const ADMIN_B = '00000000-0000-4000-8000-0000000000b1'
const TECH = '00000000-0000-4000-8000-0000000000c1'
const SUPPLIER_USER = '00000000-0000-4000-8000-0000000000d1'
const OTHER_SUPPLIER_USER = '00000000-0000-4000-8000-0000000000e1'
const SUPPLIER_ID = 990101
const OTHER_SUPPLIER_ID = 990102

function databaseConfigured(): boolean {
  try {
    return Boolean(getConfig().databaseUrl)
  } catch {
    return false
  }
}

class Rollback extends Error {}

async function inRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await getDb().transaction(async (tx) => {
      await fn(tx)
      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) throw error
  }
}

function session(
  id: string,
  role: 'admin' | 'technician' | 'supplier',
  keys: readonly string[],
): AuthSessionView {
  return {
    id: 'session-purchasing-test',
    expiresAt: new Date(Date.now() + 60_000),
    lastSeenAt: new Date(),
    user: {
      id,
      email: `${id.slice(-2)}@example.test`,
      username: `user-${id.slice(-2)}`,
      displayName: `User ${id.slice(-2)}`,
      role,
      subcontractorId: null,
      grants: keys.map((key) => ({ key, scopeSubcontractorId: null })),
    },
  }
}

const adminA = session(ADMIN_A, 'admin', ALL_PERMISSIONS)
const adminB = session(ADMIN_B, 'admin', ALL_PERMISSIONS)
const technician = session(TECH, 'technician', ['purchasing:read', 'purchasing:write'])
const supplier = session(SUPPLIER_USER, 'supplier', ['purchasing:read', 'supplier:read'])
const otherSupplier = session(OTHER_SUPPLIER_USER, 'supplier', ['purchasing:read', 'supplier:read'])

async function seedReference(tx: Tx): Promise<void> {
  await tx.insert(users).values([
    { id: ADMIN_A, email: 'po-admin-a@example.test', username: 'po-admin-a', displayName: 'PO Admin A', role: 'admin' },
    { id: ADMIN_B, email: 'po-admin-b@example.test', username: 'po-admin-b', displayName: 'PO Admin B', role: 'admin' },
    { id: TECH, email: 'po-tech@example.test', username: 'po-tech', displayName: 'PO Tech', role: 'technician' },
    { id: SUPPLIER_USER, email: 'po-supplier@example.test', username: 'po-supplier', displayName: 'PO Supplier', role: 'supplier' },
    { id: OTHER_SUPPLIER_USER, email: 'po-supplier-2@example.test', username: 'po-supplier-2', displayName: 'PO Supplier 2', role: 'supplier' },
  ]).onConflictDoNothing()
  await tx.insert(suppliers).values([
    { id: SUPPLIER_ID, name: 'Purchasing Test Supplier', province: 'ON', userId: SUPPLIER_USER },
    { id: OTHER_SUPPLIER_ID, name: 'Other Purchasing Supplier', province: 'ON', userId: OTHER_SUPPLIER_USER },
  ]).onConflictDoNothing()
}

function poInput(overrides: Partial<PurchaseOrderCreateInput> = {}): PurchaseOrderCreateInput {
  return {
    supplierId: SUPPLIER_ID,
    shipmentType: 'alliance',
    taxCode: 'ON',
    parts: [
      { partNo: 'PO-TEST-1', qty: '2.00', price: '10.00' },
      { partNo: 'PO-TEST-2', qty: '1.00', price: '5.00' },
    ],
    specialParts: [],
    ...overrides,
  }
}

async function createDraft(tx: Tx, overrides: Partial<PurchaseOrderCreateInput> = {}) {
  return createPurchaseOrderCore(tx, poInput(overrides), adminA)
}

async function approveAndIssue(tx: Tx, id: number, version: number, approver = adminA) {
  const requested = await transitionPurchaseOrderCore(tx, { id, version, to: 7 }, adminA)
  const approved = await transitionPurchaseOrderCore(
    tx,
    { id, version: requested.version, to: 8 },
    approver,
  )
  const issued = await transitionPurchaseOrderCore(
    tx,
    { id, version: approved.version, to: 2 },
    adminA,
  )
  return issued
}

/** Invoice every PO line at the ordered price, so a credit has something to reduce. */
async function invoiceWholeOrder(tx: Tx, poId: number, supplierInvoiceNumber: string) {
  const detail = await getPurchaseOrderDetail(adminA, poId, tx)
  return createPurchaseOrderInvoiceCore(
    tx,
    {
      id: poId,
      supplierInvoiceNumber,
      invoiceDate: '2026-11-11',
      taxCode: 'ON',
      lines: detail.lines.map((line) => ({
        partLineId: line.id,
        qty: line.qty,
        unitPrice: line.price,
      })),
    },
    adminA,
  )
}

/** Decimal property: the two amounts sum to exactly zero, to the cent. */
function netsToZero(left: string, right: string): boolean {
  const parsedLeft = parseDecimal(left)
  const parsedRight = parseDecimal(right)
  if (!parsedLeft || !parsedRight) return false
  return compare(add(parsedLeft, parsedRight), { value: 0n, scale: 2 }) === 0
}

describe.skipIf(!databaseConfigured())('purchasing', () => {
  test('self-approval is allowed, audited, and editing an approved PO drops it to Saved', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const created = await createDraft(tx)
      expect(created.version).toBe(1)
      expect(created.displayNumber).toBe(String(created.id))

      const requested = await transitionPurchaseOrderCore(
        tx,
        { id: created.id, version: 1, to: 7 },
        adminA,
      )
      expect(requested.status).toBe(7)

      const approved = await transitionPurchaseOrderCore(
        tx,
        { id: created.id, version: requested.version, to: 8 },
        adminA,
      )
      expect(approved.status).toBe(8)
      expect(approved.selfApproved).toBe(true)

      const [approval] = await tx
        .select()
        .from(purchaseOrderApprovals)
        .where(
          and(
            eq(purchaseOrderApprovals.poId, created.id),
            eq(purchaseOrderApprovals.decision, 'approve'),
          ),
        )
      expect(approval?.selfApproved).toBe(true)
      expect(approval?.approvedBy).toBe(ADMIN_A)
      expect(approval?.requestedBy).toBe(ADMIN_A)
      expect(approval?.poVersion).toBe(requested.version)
      expect(approval?.approvedAt).not.toBeNull()

      const [approvalHistory] = await tx
        .select()
        .from(purchaseOrderStatusHistory)
        .where(
          and(
            eq(purchaseOrderStatusHistory.poId, created.id),
            eq(purchaseOrderStatusHistory.toStatus, 8),
          ),
        )
      expect(approvalHistory?.selfApproved).toBe(true)
      expect(approvalHistory?.actorId).toBe(ADMIN_A)
      expect(approvalHistory?.poVersion).toBe(approved.version)

      // The control: touching an approved PO clears approval and reopens it.
      const { updatePurchaseOrderCore } = await import('./create.server')
      const edited = await updatePurchaseOrderCore(
        tx,
        {
          ...poInput({ parts: [{ partNo: 'PO-TEST-1', qty: '3.00', price: '10.00' }] }),
          id: created.id,
          version: approved.version,
        },
        adminA,
      )
      expect(edited.version).toBe(approved.version + 1)
      const [afterEdit] = await tx
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, created.id))
      expect(afterEdit?.status).toBe(3)
      expect(afterEdit?.isApproved).toBe(false)
      expect(afterEdit?.selfApproved).toBe(false)
      expect(afterEdit?.approvedBy).toBeNull()
      expect(afterEdit?.approvalRevision).toBeNull()

      // Re-approval is required before issue.
      const requestedAgain = await transitionPurchaseOrderCore(
        tx,
        { id: created.id, version: edited.version, to: 7 },
        adminA,
      )
      const approvedByOther = await transitionPurchaseOrderCore(
        tx,
        { id: created.id, version: requestedAgain.version, to: 8 },
        adminB,
      )
      expect(approvedByOther.selfApproved).toBe(false)
      const [secondApproval] = await tx
        .select()
        .from(purchaseOrderApprovals)
        .where(
          and(
            eq(purchaseOrderApprovals.poId, created.id),
            eq(purchaseOrderApprovals.decision, 'approve'),
            eq(purchaseOrderApprovals.approvedBy, ADMIN_B),
          ),
        )
      expect(secondApproval?.selfApproved).toBe(false)
    })
  })

  test('approval without po.approve is denied and illegal edges are rejected', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const created = await createDraft(tx)
      const requested = await transitionPurchaseOrderCore(
        tx,
        { id: created.id, version: 1, to: 7 },
        adminA,
      )
      await expect(
        transitionPurchaseOrderCore(
          tx,
          { id: created.id, version: requested.version, to: 8 },
          technician,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError)

      // Draft cannot jump straight to Received.
      await expect(
        transitionPurchaseOrderCore(tx, { id: created.id, version: requested.version, to: 4 }, adminA),
      ).rejects.toBeInstanceOf(ValidationError)
    })
  })

  test('two racing transitions: one wins and the other gets a conflict', async () => {
    const db = getDb()
    const raceA = '00000000-0000-4000-8000-00000000f0a1'
    const raceB = '00000000-0000-4000-8000-00000000f0b1'
    const raceSupplier = 990901
    let poId: number | undefined
    let release = () => {}
    try {
      await db.transaction(async (tx) => {
        await tx
          .insert(users)
          .values([
            { id: raceA, email: `${raceA}@example.test`, username: raceA, displayName: 'Race A', role: 'admin' },
            { id: raceB, email: `${raceB}@example.test`, username: raceB, displayName: 'Race B', role: 'admin' },
          ])
          .onConflictDoNothing()
        await tx
          .insert(suppliers)
          .values({ id: raceSupplier, name: 'Race Supplier', province: 'ON' })
          .onConflictDoNothing()
        poId = (
          await createPurchaseOrderCore(tx, poInput({ supplierId: raceSupplier }), session(raceA, 'admin', ALL_PERMISSIONS))
        ).id
      })
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      let firstLocked = () => {}
      const firstHasLock = new Promise<void>((resolve) => {
        firstLocked = resolve
      })
      const first = db.transaction(async (tx) => {
        await transitionPurchaseOrderCore(tx, { id: poId!, version: 1, to: 7 }, session(raceA, 'admin', ALL_PERMISSIONS))
        firstLocked()
        await held
      })
      await firstHasLock
      const second = db.transaction((tx) =>
        transitionPurchaseOrderCore(tx, { id: poId!, version: 1, to: 7 }, session(raceB, 'admin', ALL_PERMISSIONS)),
      )
      await new Promise((resolve) => setTimeout(resolve, 300))
      release()
      await first
      await expect(second).rejects.toBeInstanceOf(ConflictError)
    } finally {
      release()
      if (poId !== undefined) {
        await db
          .delete(auditLog)
          .where(and(eq(auditLog.entityType, 'purchase_order'), eq(auditLog.entityId, String(poId))))
        await db.delete(purchaseOrders).where(eq(purchaseOrders.id, poId))
      }
      await db.delete(suppliers).where(eq(suppliers.id, raceSupplier))
      for (const id of [raceA, raceB]) {
        await db.delete(users).where(eq(users.id, id))
      }
    }
  })

  test('receipt posts stock once, is idempotent, and an invoice before receipt closes only after delivery', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const created = await createDraft(tx)
      const issued = await approveAndIssue(tx, created.id, 1)
      const detail = await getPurchaseOrderDetail(adminA, created.id, tx)
      const first = detail.lines[0]!
      const second = detail.lines[1]!

      // Invoice the whole order before any goods arrive.
      const invoice = await createPurchaseOrderInvoiceCore(
        tx,
        {
          id: created.id,
          supplierInvoiceNumber: 'INV-BEFORE-RECEIPT',
          invoiceDate: '2026-11-11',
          taxCode: 'ON',
          lines: [
            { partLineId: first.id, qty: '2.00', unitPrice: '10.00' },
            { partLineId: second.id, qty: '1.00', unitPrice: '5.00' },
          ],
        },
        adminA,
      )
      expect(invoice.status).toBe('pending_receipt')
      expect(invoice.variance).toBe('0.00')
      await expect(
        closePurchaseOrderInvoiceCore(
          tx,
          { id: created.id, invoiceId: invoice.invoiceId },
          adminA,
        ),
      ).rejects.toBeInstanceOf(ValidationError)

      const idempotencyKey = 'receipt-partial-0001'
      const partial = await receivePurchaseOrderCore(
        tx,
        {
          id: created.id,
          version: issued.version,
          idempotencyKey,
          lines: [{ partLineId: first.id, qty: '1.00' }],
        },
        adminA,
      )
      expect(partial.status).toBe(5)
      expect(partial.stockLinesPosted).toBe(1)
      const retry = await receivePurchaseOrderCore(
        tx,
        {
          id: created.id,
          version: issued.version,
          idempotencyKey,
          lines: [{ partLineId: first.id, qty: '1.00' }],
        },
        adminA,
      )
      expect(retry.idempotent).toBe(true)
      expect(retry.receiptId).toBe(partial.receiptId)

      const movementsAfterRetry = await tx
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.poId, created.id))
      expect(movementsAfterRetry).toHaveLength(1)

      // Over-receipt needs po.approve plus a reason.
      await expect(
        receivePurchaseOrderCore(
          tx,
          {
            id: created.id,
            version: partial.version,
            idempotencyKey: 'receipt-over-0001',
            lines: [{ partLineId: first.id, qty: '2.00' }],
          },
          adminA,
        ),
      ).rejects.toBeInstanceOf(ValidationError)

      const final = await receivePurchaseOrderCore(
        tx,
        {
          id: created.id,
          version: partial.version,
          idempotencyKey: 'receipt-final-0001',
          lines: [
            { partLineId: first.id, qty: '1.00' },
            { partLineId: second.id, qty: '1.00' },
          ],
        },
        adminA,
      )
      expect(final.status).toBe(4)
      expect(final.stockLinesPosted).toBe(2)

      const movements = await tx
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.poId, created.id))
      expect(movements).toHaveLength(3)
      expect(movements.map((row) => row.qty).sort()).toEqual(['1.00', '1.00', '1.00'])

      const [released] = await tx
        .select()
        .from(purchaseOrderInvoices)
        .where(eq(purchaseOrderInvoices.id, invoice.invoiceId))
      expect(released?.status).toBe('matched')

      const closed = await closePurchaseOrderInvoiceCore(
        tx,
        { id: created.id, invoiceId: invoice.invoiceId },
        adminA,
      )
      expect(closed.status).toBe(11)
    })
  })

  test('a price variance is recorded and blocks closing until an issuer accepts it with a reason', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const created = await createDraft(tx)
      const issued = await approveAndIssue(tx, created.id, 1)
      const detail = await getPurchaseOrderDetail(adminA, created.id, tx)
      await receivePurchaseOrderCore(
        tx,
        {
          id: created.id,
          version: issued.version,
          idempotencyKey: 'receipt-variance-01',
          lines: detail.lines.map((line) => ({ partLineId: line.id, qty: line.qty })),
        },
        adminA,
      )

      const invoice = await createPurchaseOrderInvoiceCore(
        tx,
        {
          id: created.id,
          supplierInvoiceNumber: 'INV-VARIANCE-01',
          invoiceDate: '2026-11-11',
          taxCode: 'ON',
          lines: [
            { partLineId: detail.lines[0]!.id, qty: detail.lines[0]!.qty, unitPrice: '11.00' },
            { partLineId: detail.lines[1]!.id, qty: detail.lines[1]!.qty, unitPrice: detail.lines[1]!.price },
          ],
        },
        adminA,
      )
      expect(invoice.status).toBe('draft')
      expect(invoice.variance).toBe('2.00')

      await expect(
        closePurchaseOrderInvoiceCore(tx, { id: created.id, invoiceId: invoice.invoiceId }, adminA),
      ).rejects.toBeInstanceOf(ValidationError)
      const closed = await closePurchaseOrderInvoiceCore(
        tx,
        {
          id: created.id,
          invoiceId: invoice.invoiceId,
          acceptVarianceReason: 'Supplier price increase approved by purchasing',
        },
        adminA,
      )
      expect(closed.status).toBe(11)
      const [stored] = await tx
        .select()
        .from(purchaseOrderInvoices)
        .where(eq(purchaseOrderInvoices.id, invoice.invoiceId))
      expect(stored?.acceptedVarianceReason).toBe('Supplier price increase approved by purchasing')
    })
  })

  test('a credit is a negative document on the PO and the invoice path still refuses qty <= 0', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const created = await createDraft(tx)
      await approveAndIssue(tx, created.id, 1)
      const detail = await getPurchaseOrderDetail(adminA, created.id, tx)
      const first = detail.lines[0]!
      await invoiceWholeOrder(tx, created.id, 'INV-CREDIT-BASE')

      // Regression: the ordinary invoice path is untouched. A zero or negative
      // line is still refused with the module's existing message, so the credit
      // path did not loosen it.
      await expect(
        createPurchaseOrderInvoiceCore(
          tx,
          {
            id: created.id,
            supplierInvoiceNumber: 'INV-CREDIT-ZERO',
            invoiceDate: '2026-11-11',
            taxCode: 'ON',
            lines: [{ partLineId: first.id, qty: '0.00', unitPrice: '10.00' }],
          },
          adminA,
        ),
      ).rejects.toThrow('Invoice quantity must be greater than zero.')

      const credit = await createSupplierCreditCore(
        tx,
        {
          source: { purchaseOrderId: created.id },
          supplierId: SUPPLIER_ID,
          creditDate: '2026-11-12',
          reference: 'SUPPLIER-CR-01',
          lines: [
            {
              description: 'Returned part, supplier credit',
              partId: first.id,
              qty: '-1.00',
              rate: first.price,
              taxRate: '0.13',
            },
          ],
        },
        adminA,
      )
      expect(credit.reference).toBe('SUPPLIER-CR-01')

      const [stored] = await tx
        .select()
        .from(purchaseOrderInvoices)
        .where(eq(purchaseOrderInvoices.id, credit.creditId))
      expect(stored?.poId).toBe(created.id)
      expect(stored?.supplierId).toBe(SUPPLIER_ID)
      expect(stored?.status).toBe('matched')
      expect(stored?.subtotal).toBe('-10.00')
      expect(stored?.tax).toBe('-1.30')
      expect(stored?.total).toBe('-11.30')

      const lines = await tx
        .select()
        .from(purchaseOrderInvoiceLines)
        .where(eq(purchaseOrderInvoiceLines.invoiceId, credit.creditId))
      expect(lines).toHaveLength(1)
      expect(lines[0]?.qty).toBe('-1.00')
      expect(lines[0]?.lineTotal).toBe('-10.00')
      expect(lines[0]?.taxAmount).toBe('-1.30')

      const audits = await tx
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, 'purchase_credit.created'),
            eq(auditLog.entityId, String(created.id)),
          ),
        )
      expect(audits).toHaveLength(1)
      expect(audits[0]?.summary).toContain('SUPPLIER-CR-01')
    })
  })

  test('a credit that would leave the PO line below zero invoiced quantity is rejected', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const created = await createDraft(tx)
      await approveAndIssue(tx, created.id, 1)
      const detail = await getPurchaseOrderDetail(adminA, created.id, tx)
      const first = detail.lines[0]!
      await invoiceWholeOrder(tx, created.id, 'INV-CREDIT-CAP')

      const creditFor = (qty: string): CreateSupplierCreditInput => ({
        source: { purchaseOrderId: created.id },
        supplierId: SUPPLIER_ID,
        creditDate: '2026-11-12',
        lines: [
          {
            description: 'Returned part',
            partId: first.id,
            qty,
            rate: first.price,
            taxRate: '0.13',
          },
        ],
      })

      // The invoice path caps invoiced quantity at the ordered quantity; the
      // credit path is its mirror and caps the reduction at what was invoiced.
      // 3.00 credited against 2.00 invoiced is therefore rejected, not recorded:
      // the PO would otherwise read a negative invoiced quantity, which the
      // close rule ("all received quantity invoiced") cannot reason about.
      await expect(createSupplierCreditCore(tx, creditFor('-3.00'), adminA)).rejects.toBeInstanceOf(
        ValidationError,
      )

      // Crediting exactly what was invoiced is legal and leaves the line at zero.
      const credit = await createSupplierCreditCore(tx, creditFor('-2.00'), adminA)
      const [stored] = await tx
        .select()
        .from(purchaseOrderInvoices)
        .where(eq(purchaseOrderInvoices.id, credit.creditId))
      expect(stored?.total).toBe('-22.60')
    })
  })

  test('a credit is the exact negative of the invoice it corrects, to the cent', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const created = await createDraft(tx)
      await approveAndIssue(tx, created.id, 1)
      const detail = await getPurchaseOrderDetail(adminA, created.id, tx)
      const invoice = await invoiceWholeOrder(tx, created.id, 'INV-CREDIT-PROPERTY')

      const credit = await createSupplierCreditCore(
        tx,
        {
          source: { purchaseOrderId: created.id },
          supplierId: SUPPLIER_ID,
          creditDate: '2026-11-12',
          reference: 'SUPPLIER-CR-PROPERTY',
          lines: detail.lines.map((line) => ({
            description: `Credit for ${line.partNo}`,
            partId: line.id,
            qty: `-${line.qty}`,
            rate: line.price,
            taxRate: '0.13',
          })),
        },
        adminA,
      )

      const [invoiceRow] = await tx
        .select()
        .from(purchaseOrderInvoices)
        .where(eq(purchaseOrderInvoices.id, invoice.invoiceId))
      const [creditRow] = await tx
        .select()
        .from(purchaseOrderInvoices)
        .where(eq(purchaseOrderInvoices.id, credit.creditId))
      expect(invoiceRow?.total).toBe('28.25')
      expect(creditRow?.total).toBe('-28.25')
      // AP balancing: every money field nets to exactly zero against the invoice
      // when the same lines and rates are used.
      for (const field of ['subtotal', 'tax', 'total', 'variance'] as const) {
        expect(netsToZero(invoiceRow![field], creditRow![field])).toBe(true)
      }
    })
  })

  test('a session without invoice:write cannot create a supplier credit', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const created = await createDraft(tx)
      const detail = await getPurchaseOrderDetail(adminA, created.id, tx)
      const first = detail.lines[0]!

      // The technician holds purchasing:read and purchasing:write but not the
      // invoice permission the module already checks.
      await expect(
        createSupplierCreditCore(
          tx,
          {
            source: { purchaseOrderId: created.id },
            supplierId: SUPPLIER_ID,
            creditDate: '2026-11-12',
            lines: [
              {
                description: 'Returned part',
                partId: first.id,
                qty: '-1.00',
                rate: first.price,
                taxRate: '0.13',
              },
            ],
          },
          technician,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  test('credit validation covers sign, supplier, PO membership and the RGA-derived source', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const created = await createDraft(tx)
      await approveAndIssue(tx, created.id, 1)
      const detail = await getPurchaseOrderDetail(adminA, created.id, tx)
      const first = detail.lines[0]!
      await invoiceWholeOrder(tx, created.id, 'INV-CREDIT-VALIDATION')
      const other = await createDraft(tx)
      const otherDetail = await getPurchaseOrderDetail(adminA, other.id, tx)

      const base: CreateSupplierCreditInput = {
        source: { purchaseOrderId: created.id },
        supplierId: SUPPLIER_ID,
        creditDate: '2026-11-12',
        apAccountId: 'AP-2100',
        lines: [
          { description: 'Returned part', partId: first.id, qty: '-1.00', rate: '10.00', taxRate: '0.13' },
        ],
      }

      await expect(
        createSupplierCreditCore(
          tx,
          { ...base, lines: [{ ...base.lines[0]!, qty: '1.00' }] },
          adminA,
        ),
      ).rejects.toThrow('Credit quantity must be less than zero.')
      await expect(
        createSupplierCreditCore(tx, { ...base, supplierId: OTHER_SUPPLIER_ID }, adminA),
      ).rejects.toThrow('The supplier does not match the purchase order')
      await expect(
        createSupplierCreditCore(
          tx,
          { ...base, lines: [{ ...base.lines[0]!, partId: otherDetail.lines[0]!.id }] },
          adminA,
        ),
      ).rejects.toThrow('That part line is not on this purchase order.')

      // An RGA-sourced credit names no PO; the PO is derived from the part line
      // it corrects and the RGA reference becomes the document reference.
      const rgaCredit = await createSupplierCreditCore(
        tx,
        {
          source: { rgaReference: 'RGA-9001' },
          supplierId: SUPPLIER_ID,
          creditDate: '2026-11-12',
          lines: [
            { description: 'RGA return', partId: first.id, qty: '-1.00', rate: '10.00', taxRate: '0.13' },
          ],
        },
        adminA,
      )
      expect(rgaCredit.reference).toBe('RGA-9001')
      const [stored] = await tx
        .select()
        .from(purchaseOrderInvoices)
        .where(eq(purchaseOrderInvoices.id, rgaCredit.creditId))
      expect(stored?.poId).toBe(created.id)
    })
  })

  test('over-receipt with approval records the excess, and cancelling after receipt keeps stock', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const created = await createDraft(tx)
      const issued = await approveAndIssue(tx, created.id, 1)
      const detail = await getPurchaseOrderDetail(adminA, created.id, tx)
      const first = detail.lines[0]!

      const over = await receivePurchaseOrderCore(
        tx,
        {
          id: created.id,
          version: issued.version,
          idempotencyKey: 'receipt-over-approved',
          allowOverReceipt: true,
          allowOverReceiptReason: 'Supplier shipped a full box',
          lines: [{ partLineId: first.id, qty: '3.00' }],
        },
        adminA,
      )
      expect(over.status).toBe(5)

      const cancelled = await transitionPurchaseOrderCore(
        tx,
        { id: created.id, version: over.version, to: 10, reason: 'Wrong part shipped' },
        adminA,
      )
      expect(cancelled.status).toBe(10)
      const movements = await tx
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.poId, created.id))
      expect(movements).toHaveLength(1)
      expect(movements[0]?.qty).toBe('3.00')
    })
  })

  test('numbering skips negative ids and transfer POs never collide', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const first = await createDraft(tx)
      const second = await createDraft(tx)
      expect(second.id).toBe(first.id + 1)

      const transfer = await createDraft(tx, {
        isTransfer: true,
        transferFromPoId: first.id,
      })
      expect(transfer.id).toBe(second.id + 1)
      expect(transfer.displayNumber).toBe(`${first.id}-T1`)

      // A negative legacy id takes part in MAX(ABS(id)); the next forward
      // number must step past it rather than reuse it.
      const probe = await allocatePurchaseOrderNumber(tx, { transferFromPoId: null })
      const negativeId = -(probe.id + 25)
      await tx.insert(purchaseOrders).values({
        id: negativeId,
        supplierId: SUPPLIER_ID,
        status: 3,
        shipmentType: 'alliance',
        taxCode: 'ON',
        subtotal: '0.00',
        tax: '0.00',
        total: '0.00',
        createdBy: ADMIN_A,
        updatedBy: ADMIN_A,
      })
      const afterNegative = await createDraft(tx)
      expect(afterNegative.id).toBe(probe.id + 26)
      expect(afterNegative.id).not.toBe(negativeId)
    })
  })

  test('RFQ award twice returns one PO and scopes supplier quotes to invited suppliers', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const rfq = await createRfq(
        {
          supplierIds: [SUPPLIER_ID],
          lines: [{ partNo: 'RFQ-1', qty: '2.00', price: '8.00' }],
        },
        adminA,
        tx,
      )
      expect(rfq.status).toBe(2)

      const lines = await tx
        .select()
        .from(purchaseOrderRfqLines)
        .where(eq(purchaseOrderRfqLines.rfqId, rfq.id))
      const rfqLine = lines[0]!

      await expect(
        submitSupplierQuote(
          {
            rfqId: rfq.id,
            lines: [{ rfqLineId: rfqLine.id, price: '7.50' }],
          },
          otherSupplier,
          tx,
        ),
      ).rejects.toBeInstanceOf(ValidationError)

      const quote = await submitSupplierQuote(
        {
          rfqId: rfq.id,
          lines: [{ rfqLineId: rfqLine.id, price: '7.50' }],
        },
        supplier,
        tx,
      )
      const firstAward = await awardRfq(
        { rfqId: rfq.id, supplierQuoteId: quote.id, lineIds: [rfqLine.id] },
        adminA,
        tx,
      )
      const secondAward = await awardRfq(
        { rfqId: rfq.id, supplierQuoteId: quote.id, lineIds: [rfqLine.id] },
        adminA,
        tx,
      )
      expect(secondAward.id).toBe(firstAward.id)
      expect(secondAward.idempotent).toBe(true)
      const awarded = await tx
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.rfqId, rfq.id))
      expect(awarded).toHaveLength(1)
    })
  })

  test('converting a pre-order twice returns the same PO', async () => {
    await inRollback(async (tx) => {
      await seedReference(tx)
      const preorder = await createPreorder(
        {
          isWithoutQuote: true,
          supplierIds: [SUPPLIER_ID],
          parts: [{ partNo: 'PRE-1', qty: '1.00', price: '12.00' }],
          specialParts: [],
        },
        adminA,
        tx,
      )
      const first = await convertPreorder({ id: preorder.id, supplierId: SUPPLIER_ID }, adminA, tx)
      const second = await convertPreorder({ id: preorder.id, supplierId: SUPPLIER_ID }, adminA, tx)
      expect(second.id).toBe(first.id)
      expect(second.idempotent).toBe(true)
      const [stored] = await tx
        .select()
        .from(purchaseOrderPreorders)
        .where(eq(purchaseOrderPreorders.id, preorder.id))
      expect(stored?.status).toBe(2)
      const preorderLines = await tx
        .select()
        .from(purchaseOrderPreorderParts)
        .where(eq(purchaseOrderPreorderParts.preorderId, preorder.id))
      expect(preorderLines).toHaveLength(1)
      const offered = await tx
        .select()
        .from(purchaseOrderRfqSuppliers)
        .where(eq(purchaseOrderRfqSuppliers.rfqId, 0))
      expect(offered).toHaveLength(0)
    })
  })
})
