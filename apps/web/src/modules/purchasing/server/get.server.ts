import { asc, eq, inArray } from 'drizzle-orm'
import type { Db } from '@cls/db'
import {
  purchaseOrderInvoices,
  purchaseOrderParts,
  purchaseOrderReceiptLines,
  purchaseOrderReceipts,
  purchaseOrderSpecialParts,
  purchaseOrderStatusHistory,
  suppliers,
} from '@cls/db/schema'
import { format, multiply, parseDecimal, round } from '@cls/pricing'
import type { AuthSessionView } from '../../../server/auth.types'
import type {
  PurchaseOrderDetail,
  PurchaseOrderInvoiceStatus,
  PurchaseOrderStatus,
} from '../types'
import { grantSet, loadPurchaseOrder } from './access.server'
import { displayNumberFor } from './numbering.server'
import { purchaseOrderCapabilities } from '../lib/status'

function lineTotal(qty: string, price: string): string {
  return format(
    round(
      multiply(
        parseDecimal(qty) ?? { value: 0n, scale: 2 },
        parseDecimal(price) ?? { value: 0n, scale: 2 },
      ),
      2,
    ),
    2,
  )
}

export async function getPurchaseOrderDetail(
  session: AuthSessionView,
  id: number,
  executor: Db,
): Promise<PurchaseOrderDetail> {
  const po = await loadPurchaseOrder(session, id, executor)
  const [supplier] = await executor
    .select({ name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.id, po.supplierId))
    .limit(1)

  const [parts, specialParts, receipts, invoices, history] = await Promise.all([
    executor.select().from(purchaseOrderParts).where(eq(purchaseOrderParts.poId, id)).orderBy(asc(purchaseOrderParts.sortOrder), asc(purchaseOrderParts.id)),
    executor.select().from(purchaseOrderSpecialParts).where(eq(purchaseOrderSpecialParts.poId, id)).orderBy(asc(purchaseOrderSpecialParts.sortOrder), asc(purchaseOrderSpecialParts.id)),
    executor.select().from(purchaseOrderReceipts).where(eq(purchaseOrderReceipts.poId, id)).orderBy(asc(purchaseOrderReceipts.receivedOn), asc(purchaseOrderReceipts.id)),
    executor.select().from(purchaseOrderInvoices).where(eq(purchaseOrderInvoices.poId, id)).orderBy(asc(purchaseOrderInvoices.invoiceDate), asc(purchaseOrderInvoices.id)),
    executor.select().from(purchaseOrderStatusHistory).where(eq(purchaseOrderStatusHistory.poId, id)).orderBy(asc(purchaseOrderStatusHistory.createdAt), asc(purchaseOrderStatusHistory.id)),
  ])

  const receiptLines = receipts.length
    ? await executor
        .select()
        .from(purchaseOrderReceiptLines)
        .where(inArray(purchaseOrderReceiptLines.receiptId, receipts.map((receipt) => receipt.id)))
        .orderBy(asc(purchaseOrderReceiptLines.id))
    : []

  return {
    id: po.id,
    displayNumber: displayNumberFor(po.id, po.displayNumber),
    status: po.status as PurchaseOrderStatus,
    supplierId: po.supplierId,
    supplierName: supplier?.name ?? `Supplier ${po.supplierId}`,
    subSupplierId: po.subSupplierId,
    priorityId: po.priorityId,
    shipmentType: po.shipmentType,
    shipContact: po.shipContact,
    shipCompany: po.shipCompany,
    shipStreet1: po.shipStreet1,
    shipStreet2: po.shipStreet2,
    shipCity: po.shipCity,
    shipProvince: po.shipProvince,
    shipPostalCode: po.shipPostalCode,
    shipPhone: po.shipPhone,
    expectedDelivery: po.expectedDelivery,
    supplierNotes: po.supplierNotes,
    notes: po.notes,
    fob: po.fob,
    payTerms: po.payTerms,
    shipVia: po.shipVia,
    trackingId: po.trackingId,
    taxCode: po.taxCode,
    appliedTaxRate: po.appliedTaxRate,
    subtotal: po.subtotal,
    tax: po.tax,
    total: po.total,
    isApproved: po.isApproved,
    approvalRequestBy: po.approvalRequestBy,
    approvedBy: po.approvedBy,
    approvedAt: po.approvedAt?.toISOString() ?? null,
    approvalRevision: po.approvalRevision,
    selfApproved: po.selfApproved,
    poSubmittedBy: po.poSubmittedBy,
    submittedAt: po.submittedAt?.toISOString() ?? null,
    cancelledAt: po.cancelledAt?.toISOString() ?? null,
    cancelledReason: po.cancelledReason,
    closedShort: po.closedShort,
    shortCloseReason: po.shortCloseReason,
    stockPostedAt: po.stockPostedAt?.toISOString() ?? null,
    isTransfer: po.isTransfer,
    transferFromPoId: po.transferFromPoId,
    version: po.version,
    createdAt: po.createdAt.toISOString(),
    updatedAt: po.updatedAt.toISOString(),
    lines: parts.map((line) => ({
      id: line.id,
      partNo: line.partNo,
      description: line.description,
      qty: line.qty,
      qtyReceived: line.qtyReceived,
      price: line.price,
      lineTotal: lineTotal(line.qty, line.price),
      itemPurchaseType: line.itemPurchaseType,
      itemPurchaseTypeNumber: line.itemPurchaseTypeNumber,
    })),
    specialLines: specialParts.map((line) => ({
      id: line.id,
      name: line.name,
      qty: line.qty,
      qtyReceived: line.qtyReceived,
      price: line.price,
      lineTotal: lineTotal(line.qty, line.price),
      itemPurchaseType: line.itemPurchaseType,
      itemPurchaseTypeNumber: line.itemPurchaseTypeNumber,
    })),
    receipts: receipts.map((receipt) => ({
      id: receipt.id,
      receivedOn: receipt.receivedOn,
      receivedBy: receipt.receivedBy,
      notes: receipt.notes,
      stockPostedAt: receipt.stockPostedAt?.toISOString() ?? null,
      lines: receiptLines
        .filter((line) => line.receiptId === receipt.id)
        .map((line) => {
          const part = parts.find((p) => p.id === line.partLineId)
          const special = specialParts.find((p) => p.id === line.specialPartLineId)
          return {
            id: line.id,
            partNo: part?.partNo ?? null,
            name: special?.name ?? null,
            qty: line.qty,
            overReceivedQty: line.overReceivedQty,
          }
        }),
    })),
    invoices: invoices.map((invoice) => ({
      id: invoice.id,
      supplierInvoiceNumber: invoice.supplierInvoiceNumber,
      invoiceDate: invoice.invoiceDate,
      subtotal: invoice.subtotal,
      tax: invoice.tax,
      freight: invoice.freight,
      total: invoice.total,
      status: invoice.status as PurchaseOrderInvoiceStatus,
      variance: invoice.variance,
      varianceDetail: invoice.varianceDetail,
      acceptedVarianceReason: invoice.acceptedVarianceReason,
      postedAt: invoice.postedAt?.toISOString() ?? null,
      sageReference: invoice.sageReference,
    })),
    statusHistory: history.map((event) => ({
      id: event.id,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      action: event.action,
      actorLabel: event.actorLabel,
      poVersion: event.poVersion,
      selfApproved: event.selfApproved,
      note: event.note,
      createdAt: event.createdAt.toISOString(),
    })),
    capabilities: purchaseOrderCapabilities(
      { status: po.status, isTransfer: po.isTransfer },
      grantSet(session),
    ),
  }
}
