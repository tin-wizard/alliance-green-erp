import { sql } from 'drizzle-orm'
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { app } from './base'

/**
 * Purchasing — purchase orders, receipts, supplier invoices, pre-orders, RFQs.
 *
 * `purchase_orders.id` is the PO number (BUSINESS-RULES D3). It is allocated as
 * `MAX(ABS(id)) + 1` under an advisory lock, so credit/negative POs share the
 * space. `display_number` carries transfer numbers (`<source>-T<n>`).
 *
 * Receipts are events, not status edits: `qty_received` is a cache of the
 * receipt lines, and stock movement lives in Inventory. Supplier invoices never
 * mutate ordered prices; variances are recorded.
 */
export const purchaseOrders = app.table(
  'purchase_orders',
  {
    id: integer('id').primaryKey(),
    displayNumber: text('display_number'),
    supplierId: integer('supplier_id').notNull(),
    subSupplierId: integer('sub_supplier_id'),
    status: smallint('status').notNull().default(3),
    legacyStatus: smallint('legacy_status'),
    priorityId: smallint('priority_id'),
    shipmentType: text('shipment_type').notNull().default(''),
    shipContact: text('ship_contact'),
    shipCompany: text('ship_company'),
    shipStreet1: text('ship_street_1'),
    shipStreet2: text('ship_street_2'),
    shipCity: text('ship_city'),
    shipProvince: text('ship_province'),
    shipPostalCode: text('ship_postal_code'),
    shipPhone: text('ship_phone'),
    expectedDelivery: date('expected_delivery'),
    supplierNotes: text('supplier_notes'),
    notes: text('notes'),
    fob: text('fob'),
    payTerms: text('pay_terms'),
    shipVia: text('ship_via'),
    trackingId: text('tracking_id'),
    securityCode: text('security_code'),
    taxCode: text('tax_code'),
    appliedTaxRate: numeric('applied_tax_rate', { precision: 9, scale: 5 }),
    appliedTaxRatePst: numeric('applied_tax_rate_pst', { precision: 9, scale: 5 }),
    subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull().default('0'),
    tax: numeric('tax', { precision: 14, scale: 2 }).notNull().default('0'),
    total: numeric('total', { precision: 14, scale: 2 }).notNull().default('0'),
    approvalRequestBy: uuid('approval_request_by'),
    approvalRequestedAt: timestamp('approval_requested_at', { withTimezone: true }),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvalRevision: integer('approval_revision'),
    selfApproved: boolean('self_approved').notNull().default(false),
    isApproved: boolean('is_approved').notNull().default(false),
    poSubmittedBy: uuid('po_submitted_by'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledReason: text('cancelled_reason'),
    closedShort: boolean('closed_short').notNull().default(false),
    shortCloseReason: text('short_close_reason'),
    stockPostedAt: timestamp('stock_posted_at', { withTimezone: true }),
    sourceQuoteId: integer('source_quote_id'),
    preorderId: integer('preorder_id'),
    rfqId: integer('rfq_id'),
    supplierQuoteId: integer('supplier_quote_id'),
    workOrderNumber: integer('work_order_number'),
    isTransfer: boolean('is_transfer').notNull().default(false),
    transferFromPoId: integer('transfer_from_po_id'),
    transferFromType: text('transfer_from_type'),
    transferFromCustomerId: integer('transfer_from_customer_id'),
    transferFromSubcontractorId: integer('transfer_from_subcontractor_id'),
    revisionNo: integer('revision_no').notNull().default(0),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('purchase_orders_status_check', sql`${table.status} between 1 and 11`),
    uniqueIndex('purchase_orders_display_number_unique').on(table.displayNumber),
    index('purchase_orders_supplier_idx').on(table.supplierId),
    index('purchase_orders_status_idx').on(table.status),
    index('purchase_orders_created_idx').on(table.createdAt, table.id),
  ],
)

export const purchaseOrderParts = app.table(
  'purchase_order_parts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    poId: integer('po_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    partNo: text('part_no').notNull(),
    description: text('description'),
    qty: numeric('qty', { precision: 12, scale: 2 }).notNull().default('0'),
    qtyReceived: numeric('qty_received', { precision: 12, scale: 2 }).notNull().default('0'),
    price: numeric('price', { precision: 12, scale: 2 }).notNull().default('0'),
    modelNumber: text('model_number'),
    itemPurchaseType: text('item_purchase_type'),
    itemPurchaseTypeNumber: text('item_purchase_type_number'),
    workOrderNumber: integer('work_order_number'),
    underWarranty: boolean('under_warranty').notNull().default(false),
    doNotDeductFrom: integer('do_not_deduct_from'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    index('purchase_order_parts_po_idx').on(table.poId),
    check('purchase_order_parts_qty_check', sql`${table.qty} >= 0`),
    check('purchase_order_parts_received_check', sql`${table.qtyReceived} >= 0`),
  ],
)

export const purchaseOrderSpecialParts = app.table(
  'purchase_order_special_parts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    poId: integer('po_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    qty: numeric('qty', { precision: 12, scale: 2 }).notNull().default('0'),
    qtyReceived: numeric('qty_received', { precision: 12, scale: 2 }).notNull().default('0'),
    price: numeric('price', { precision: 12, scale: 2 }).notNull().default('0'),
    modelNumber: text('model_number'),
    itemPurchaseType: text('item_purchase_type'),
    itemPurchaseTypeNumber: text('item_purchase_type_number'),
    doNotDeductFrom: integer('do_not_deduct_from'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    index('purchase_order_special_parts_po_idx').on(table.poId),
    check('purchase_order_special_parts_qty_check', sql`${table.qty} >= 0`),
    check('purchase_order_special_parts_received_check', sql`${table.qtyReceived} >= 0`),
  ],
)

export const purchaseOrderReceipts = app.table(
  'purchase_order_receipts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    poId: integer('po_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    receivedOn: date('received_on').notNull().defaultNow(),
    receivedBy: uuid('received_by'),
    carrier: text('carrier'),
    trackingId: text('tracking_id'),
    notes: text('notes'),
    stockPostedAt: timestamp('stock_posted_at', { withTimezone: true }),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('purchase_order_receipts_idempotency_unique').on(table.idempotencyKey),
    index('purchase_order_receipts_po_idx').on(table.poId),
  ],
)

export const purchaseOrderReceiptLines = app.table(
  'purchase_order_receipt_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    receiptId: integer('receipt_id')
      .notNull()
      .references(() => purchaseOrderReceipts.id, { onDelete: 'cascade' }),
    partLineId: integer('part_line_id').references(() => purchaseOrderParts.id, {
      onDelete: 'set null',
    }),
    specialPartLineId: integer('special_part_line_id').references(
      () => purchaseOrderSpecialParts.id,
      { onDelete: 'set null' },
    ),
    qty: numeric('qty', { precision: 12, scale: 2 }).notNull(),
    overReceivedQty: numeric('over_received_qty', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    note: text('note'),
  },
  (table) => [
    index('purchase_order_receipt_lines_receipt_idx').on(table.receiptId),
    check('purchase_order_receipt_lines_qty_check', sql`${table.qty} >= 0`),
  ],
)

export const purchaseOrderInvoices = app.table(
  'purchase_order_invoices',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    poId: integer('po_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    supplierId: integer('supplier_id').notNull(),
    supplierInvoiceNumber: text('supplier_invoice_number').notNull(),
    invoiceDate: date('invoice_date').notNull(),
    taxCode: text('tax_code'),
    appliedTaxRate: numeric('applied_tax_rate', { precision: 9, scale: 5 }),
    subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull().default('0'),
    tax: numeric('tax', { precision: 14, scale: 2 }).notNull().default('0'),
    taxHst: numeric('tax_hst', { precision: 14, scale: 2 }).notNull().default('0'),
    taxGst: numeric('tax_gst', { precision: 14, scale: 2 }).notNull().default('0'),
    taxPst: numeric('tax_pst', { precision: 14, scale: 2 }).notNull().default('0'),
    taxTvp: numeric('tax_tvp', { precision: 14, scale: 2 }).notNull().default('0'),
    freight: numeric('freight', { precision: 14, scale: 2 }).notNull().default('0'),
    total: numeric('total', { precision: 14, scale: 2 }).notNull().default('0'),
    status: text('status').notNull().default('draft'),
    variance: numeric('variance', { precision: 14, scale: 2 }).notNull().default('0'),
    varianceDetail: text('variance_detail'),
    acceptedVarianceReason: text('accepted_variance_reason'),
    acceptedBy: uuid('accepted_by'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    sageReference: text('sage_reference'),
    createdBy: uuid('created_by'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('purchase_order_invoices_supplier_number_unique').on(
      table.supplierId,
      table.supplierInvoiceNumber,
    ),
    index('purchase_order_invoices_po_idx').on(table.poId),
    check(
      'purchase_order_invoices_status_check',
      sql`${table.status} in ('draft','pending_receipt','matched','posted','void')`,
    ),
  ],
)

export const purchaseOrderInvoiceLines = app.table(
  'purchase_order_invoice_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => purchaseOrderInvoices.id, { onDelete: 'cascade' }),
    partLineId: integer('part_line_id').references(() => purchaseOrderParts.id, {
      onDelete: 'set null',
    }),
    specialPartLineId: integer('special_part_line_id').references(
      () => purchaseOrderSpecialParts.id,
      { onDelete: 'set null' },
    ),
    qty: numeric('qty', { precision: 12, scale: 2 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
    lineTotal: numeric('line_total', { precision: 14, scale: 2 }).notNull(),
    taxAmount: numeric('tax_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    variance: numeric('variance', { precision: 14, scale: 2 }).notNull().default('0'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [index('purchase_order_invoice_lines_invoice_idx').on(table.invoiceId)],
)

export const purchaseOrderStatusHistory = app.table(
  'purchase_order_status_history',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    poId: integer('po_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    fromStatus: smallint('from_status'),
    toStatus: smallint('to_status').notNull(),
    action: text('action').notNull(),
    actorId: uuid('actor_id'),
    actorLabel: text('actor_label'),
    poVersion: integer('po_version').notNull(),
    selfApproved: boolean('self_approved').notNull().default(false),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('purchase_order_status_history_po_idx').on(table.poId, table.createdAt)],
)

export const purchaseOrderApprovals = app.table(
  'purchase_order_approvals',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    poId: integer('po_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    decision: text('decision').notNull(),
    requestedBy: uuid('requested_by'),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    poVersion: integer('po_version').notNull(),
    selfApproved: boolean('self_approved').notNull().default(false),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('purchase_order_approvals_po_idx').on(table.poId),
    check(
      'purchase_order_approvals_decision_check',
      sql`${table.decision} in ('request','approve','challenge','cancel_request')`,
    ),
  ],
)

export const purchaseOrderPreorders = app.table(
  'purchase_order_preorders',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    status: smallint('status').notNull().default(1),
    sourceQuoteId: integer('source_quote_id'),
    report: text('report'),
    priorityId: smallint('priority_id'),
    notes: text('notes'),
    isWithoutQuote: boolean('is_without_quote').notNull().default(false),
    workOrderNumber: integer('work_order_number'),
    createdBy: uuid('created_by'),
    dateReceived: date('date_received'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('purchase_order_preorders_status_check', sql`${table.status} in (1,2)`)],
)

export const purchaseOrderPreorderParts = app.table(
  'purchase_order_preorder_parts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    preorderId: integer('preorder_id')
      .notNull()
      .references(() => purchaseOrderPreorders.id, { onDelete: 'cascade' }),
    partNo: text('part_no').notNull(),
    qty: numeric('qty', { precision: 12, scale: 2 }).notNull(),
    price: numeric('price', { precision: 12, scale: 2 }).notNull().default('0'),
    itemPurchaseType: text('item_purchase_type'),
    itemPurchaseTypeNumber: text('item_purchase_type_number'),
    supplierId: integer('supplier_id'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [index('purchase_order_preorder_parts_idx').on(table.preorderId)],
)

export const purchaseOrderPreorderSpecialParts = app.table(
  'purchase_order_preorder_special_parts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    preorderId: integer('preorder_id')
      .notNull()
      .references(() => purchaseOrderPreorders.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    qty: numeric('qty', { precision: 12, scale: 2 }).notNull(),
    price: numeric('price', { precision: 12, scale: 2 }).notNull().default('0'),
    itemPurchaseType: text('item_purchase_type'),
    itemPurchaseTypeNumber: text('item_purchase_type_number'),
    supplierId: integer('supplier_id'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [index('purchase_order_preorder_special_parts_idx').on(table.preorderId)],
)

export const purchaseOrderPreorderSuppliers = app.table(
  'purchase_order_preorder_suppliers',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    preorderId: integer('preorder_id')
      .notNull()
      .references(() => purchaseOrderPreorders.id, { onDelete: 'cascade' }),
    supplierId: integer('supplier_id').notNull(),
    responseStatus: text('response_status').notNull().default('waiting'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('purchase_order_preorder_suppliers_unique').on(table.preorderId, table.supplierId),
    check(
      'purchase_order_preorder_suppliers_status_check',
      sql`${table.responseStatus} in ('waiting','accepted','decline')`,
    ),
  ],
)

export const purchaseOrderRfqs = app.table(
  'purchase_order_rfqs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    status: smallint('status').notNull().default(1),
    sourceQuoteId: integer('source_quote_id'),
    report: text('report'),
    priorityId: smallint('priority_id'),
    notes: text('notes'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('purchase_order_rfqs_status_check', sql`${table.status} between 1 and 5`)],
)

export const purchaseOrderRfqSuppliers = app.table(
  'purchase_order_rfq_suppliers',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    rfqId: integer('rfq_id')
      .notNull()
      .references(() => purchaseOrderRfqs.id, { onDelete: 'cascade' }),
    supplierId: integer('supplier_id').notNull(),
    responseStatus: text('response_status').notNull().default('waiting'),
    quotesCounter: integer('quotes_counter').notNull().default(0),
    resubmissionRequest: boolean('resubmission_request').notNull().default(false),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('purchase_order_rfq_suppliers_unique').on(table.rfqId, table.supplierId),
    check(
      'purchase_order_rfq_suppliers_status_check',
      sql`${table.responseStatus} in ('waiting','accepted','decline')`,
    ),
  ],
)

export const purchaseOrderRfqLines = app.table(
  'purchase_order_rfq_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    rfqId: integer('rfq_id')
      .notNull()
      .references(() => purchaseOrderRfqs.id, { onDelete: 'cascade' }),
    partNo: text('part_no'),
    name: text('name'),
    qty: numeric('qty', { precision: 12, scale: 2 }).notNull(),
    targetPrice: numeric('target_price', { precision: 12, scale: 2 }),
    itemPurchaseType: text('item_purchase_type'),
    itemPurchaseTypeNumber: text('item_purchase_type_number'),
    awardedSupplierQuoteId: integer('awarded_supplier_quote_id'),
    awardedPoId: integer('awarded_po_id'),
    cancelled: boolean('cancelled').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [index('purchase_order_rfq_lines_rfq_idx').on(table.rfqId)],
)

export const purchaseOrderSupplierQuotes = app.table(
  'purchase_order_supplier_quotes',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    rfqId: integer('rfq_id')
      .notNull()
      .references(() => purchaseOrderRfqs.id, { onDelete: 'cascade' }),
    supplierId: integer('supplier_id').notNull(),
    status: smallint('status').notNull().default(3),
    expectedDelivery: date('expected_delivery'),
    notes: text('notes'),
    processedAsOrder: boolean('processed_as_order').notNull().default(false),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('purchase_order_supplier_quotes_unique').on(table.rfqId, table.supplierId),
    check('purchase_order_supplier_quotes_status_check', sql`${table.status} in (3,4,5)`),
  ],
)

export const purchaseOrderSupplierQuoteLines = app.table(
  'purchase_order_supplier_quote_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    supplierQuoteId: integer('supplier_quote_id')
      .notNull()
      .references(() => purchaseOrderSupplierQuotes.id, { onDelete: 'cascade' }),
    rfqLineId: integer('rfq_line_id')
      .notNull()
      .references(() => purchaseOrderRfqLines.id, { onDelete: 'cascade' }),
    partNo: text('part_no'),
    name: text('name'),
    qty: numeric('qty', { precision: 12, scale: 2 }).notNull(),
    price: numeric('price', { precision: 12, scale: 2 }).notNull(),
    note: text('note'),
  },
  (table) => [
    index('purchase_order_supplier_quote_lines_quote_idx').on(table.supplierQuoteId),
    uniqueIndex('purchase_order_supplier_quote_lines_unique').on(
      table.supplierQuoteId,
      table.rfqLineId,
    ),
  ],
)
