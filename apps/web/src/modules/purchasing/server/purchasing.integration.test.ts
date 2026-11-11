/**
 * Purchasing integration tests.
 *
 * Real Neon branch, every test rolls back. Covers the approval control
 * (self-approval, edit-after-approval reset, denied approval), receiving and
 * stock posting idempotency, invoice matching and the receipt gate, numbering,
 * plus RFQ/pre-order idempotency and supplier scoping.
 */
import { and, eq } from 'drizzle-orm'
import { describe, expect, test, vi } from 'vitest'

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })

import { getConfig } from '@cls/core/env.server'
import { ALL_PERMISSIONS, ForbiddenError, ValidationError } from '@cls/core'
import { getDb, type Tx } from '@cls/db'
import {
  inventoryMovements,
  purchaseOrderApprovals,
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
import type { AuthSessionView } from '../../../server/auth.types'
import type { PurchaseOrderCreateInput } from '../types'
import { createPurchaseOrderCore } from './create.server'
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
  ])
  await tx.insert(suppliers).values([
    { id: SUPPLIER_ID, name: 'Purchasing Test Supplier', province: 'ON', userId: SUPPLIER_USER },
    { id: OTHER_SUPPLIER_ID, name: 'Other Purchasing Supplier', province: 'ON', userId: OTHER_SUPPLIER_USER },
  ])
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
