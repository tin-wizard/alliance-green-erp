// @generated
// Source: packages/db/contract/schema.json (2026-11-11).
// Do not edit by hand. Run `pnpm db:generate:schema` after updating the contract.
// Domain: purchasing

import { date, index, integer, numeric, pgEnum, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core'
export const legacyEnumPurchaseorderShipmentType = pgEnum('legacy_purchaseorder_shipment_type', ["alliance", "cls", "alliancepickup", "clspickup", "contractor", "customer", "subcontractor", "clscustomer", "alliancemaintenance", ""])
export const legacyEnumPurchaseorderOverrideSupplierIsUnder = pgEnum('legacy_purchaseorder_override_supplier_is_under', ["", "alliance", "cls", "maintenance"])
export const legacyEnumPurchaseorderTransferringFromType = pgEnum('legacy_purchaseorder_transferring_from_type', ["alliance", "cls", "alliancepickup", "clspickup", "contractor", "customer", "subcontractor", "clscustomer", "alliancemaintenance", ""])
export const legacyEnumPoPreorderPartsItemPurchaseType = pgEnum('legacy_po_preorder_parts_item_purchase_type', ["workorder", "stock", "cls", "projectpo"])
export const legacyEnumPoPreorderSopartsItemPurchaseType = pgEnum('legacy_po_preorder_soparts_item_purchase_type', ["workorder", "stock", "cls", "projectpo"])
export const legacyEnumPoPreorderSuppliersSupplierResponseStatus = pgEnum('legacy_po_preorder_suppliers_supplier_response_status', ["waiting", "accepted", "decline"])
export const legacyEnumPoQuoteSuppliersSupplierResponseStatus = pgEnum('legacy_po_quote_suppliers_supplier_response_status', ["waiting", "accepted", "decline"])

/**
 * purchaseorder — Purchase order header (supplier, status, approval, shipment type, transfer metadata).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPurchaseorder = pgTable(
  'purchaseorder',
  {
    id: serial('id').primaryKey(),
    purchaseOrderNumber: varchar('purchase_order_number', { length: 20 }),
    // legacy display value; PO number concept removed 2025-07-07
    invoiceNumber: varchar('invoice_number', { length: 50 }),
    supplierId: integer('supplier_id'),
    subSupplierId: integer('sub_supplier_id'),
    custQoid: integer('cust_qoid'),
    tjxQuoteid: integer('tjx_quoteid'),
    prePoid: integer('pre_poid'),
    supPoid: integer('sup_poid'),
    reqQoid: integer('req_qoid'),
    supQoid: integer('sup_qoid'),
    status: integer('status'),
    statusOnJuly212025: integer('status_on_july_21_2025'),
    priority: integer('priority'),
    supplierNotes: text('supplier_notes'),
    notes: text('notes'),
    expdeliverydate: date('expdeliverydate', { mode: 'string' }),
    taxCode: varchar('tax_code', { length: 50 }),
    appliedtaxrate: varchar('appliedtaxrate', { length: 12 }),
    fob: text('fob'),
    payTerms: text('pay_terms'),
    shipAddressContactname: text('ship_address_contactname'),
    shipAddressCompany: text('ship_address_company'),
    shipAddressStreet1: text('ship_address_street1'),
    shipAddressStreet2: text('ship_address_street2'),
    shipAddressCity: text('ship_address_city'),
    shipAddressProvince: text('ship_address_province'),
    shipAddressPostalcode: text('ship_address_postalcode'),
    shipAddressPhone: text('ship_address_phone'),
    shippingAddress: text('shipping_address'),
    securitycode: varchar('securitycode', { length: 50 }),
    shippingCode: varchar('shipping_code', { length: 50 }),
    shipVia: varchar('ship_via', { length: 50 }),
    createdby: integer('createdby'),
    isMarkedCritical: integer('is_marked_critical'),
    isSubmitted: integer('is_submitted'),
    completiondate: integer('completiondate'),
    dateCreated: timestamp('date_created', { mode: 'string', withTimezone: false }),
    dateCompleted: timestamp('date_completed', { mode: 'string', withTimezone: false }),
    poFolderAttachPath: varchar('po_folder_attach_path', { length: 200 }),
    isOnlineVendorOrder: integer('is_online_vendor_order'),
    stockUpdated: integer('stock_updated'),
    revisionNo: integer('revision_no'),
    isTypeMaintenance: integer('is_type_maintenance'),
    shipmentType: legacyEnumPurchaseorderShipmentType('shipment_type'),
    // enum: alliance, cls, alliancepickup, clspickup, contractor, customer, subcontractor, clscustomer, alliancemaintenance, ''
    shipmentTypeCorrection: varchar('shipment_type_correction', { length: 30 }),
    shipmentTypeBkup18july2025: varchar('shipment_type_bkup_18july2025', { length: 30 }),
    customerid: integer('customerid'),
    subcontractorid: integer('subcontractorid'),
    isAllianceStocktransferPo: integer('is_alliance_stocktransfer_po'),
    trackingid: varchar('trackingid', { length: 50 }),
    printRecordsPerPage: integer('print_records_per_page'),
    tjxPartsQtyType: varchar('tjx_parts_qty_type', { length: 15 }),
    isApproved: integer('is_approved'),
    // approval gate; reset to 0 on edit
    overrideSupplierIsUnder: legacyEnumPurchaseorderOverrideSupplierIsUnder('override_supplier_is_under'),
    transferringFromType: legacyEnumPurchaseorderTransferringFromType('transferring_from_type'),
    isAllianceStocktransferPoOld: integer('is_alliance_stocktransfer_po_old'),
    fromSubcontractorid: integer('from_subcontractorid'),
    fromCustomerid: integer('from_customerid'),
    transferFromContactname: varchar('transfer_from_contactname', { length: 50 }),
    transferFromCompany: varchar('transfer_from_company', { length: 50 }),
    transferFromStreet1: varchar('transfer_from_street1', { length: 100 }),
    transferFromStreet2: varchar('transfer_from_street2', { length: 100 }),
    transferFromCity: varchar('transfer_from_city', { length: 20 }),
    transferFromProvince: varchar('transfer_from_province', { length: 15 }),
    transferFromPostalcode: varchar('transfer_from_postalcode', { length: 15 }),
    transferFromPhone: varchar('transfer_from_phone', { length: 30 }),
    transferFromAddress: text('transfer_from_address'),
    transferCameFromPoid: integer('transfer_came_from_poid'),
    poSubmittedBy: varchar('po_submitted_by', { length: 15 }),
    approvalRequestBy: integer('approval_request_by'),
    lastStatus: integer('last_status'),
    statusChangedDate: timestamp('status_changed_date', { mode: 'string', withTimezone: false }),
    lastFollowupReminderDate: date('last_followup_reminder_date', { mode: 'string' }),
  },
  (table) => [
    index('legacy_purchaseorder_id').on(table.id),
    index('legacy_purchaseorder_is_alliance_stocktransfer_po').on(table.isAllianceStocktransferPo),
    index('legacy_purchaseorder_is_type_maintenance').on(table.isTypeMaintenance),
    index('legacy_purchaseorder_shipment_type').on(table.shipmentType),
    index('legacy_purchaseorder_status').on(table.status),
    index('legacy_purchaseorder_subcontractorid').on(table.subcontractorid),
    index('legacy_purchaseorder_supplier_id').on(table.supplierId),
  ],
)

/**
 * po_invoice — Supplier invoice against a PO (tax split GST/PST/HST/TVP, Sage sync flag).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPoInvoice = pgTable(
  'po_invoice',
  {
    id: serial('id').primaryKey(),
    poid: integer('poid').notNull(),
    invoicenumber: varchar('invoicenumber', { length: 100 }),
    invoiceSupplierId: integer('invoice_supplier_id'),
    taxAmount: numeric('tax_amount', { precision: 7, scale: 2 }).notNull(),
    taxCode: varchar('tax_code', { length: 25 }).notNull(),
    workordernumber: varchar('workordernumber', { length: 100 }),
    shippingCharges: varchar('shipping_charges', { length: 50 }),
    clsInvoicenumber: varchar('cls_invoicenumber', { length: 50 }),
    invoiceReport: text('invoice_report'),
    taxHst: numeric('tax_hst', { precision: 7, scale: 2 }),
    taxGst: numeric('tax_gst', { precision: 7, scale: 2 }),
    taxPst: numeric('tax_pst', { precision: 7, scale: 2 }),
    taxTvp: numeric('tax_tvp', { precision: 7, scale: 2 }),
    subTotal: varchar('sub_total', { length: 25 }),
    // varchar containing a formatted amount
    totalAmount: varchar('total_amount', { length: 25 }),
    // varchar containing a formatted amount
    createdby: integer('createdby'),
    dateCreated: date('date_created', { mode: 'string' }),
    invoiceDate: date('invoice_date', { mode: 'string' }),
    invoiceLevel: integer('invoice_level'),
    sageDone: integer('sage_done'),
    stockUpdatedDuringMarkInvoice: integer('stock_updated_during_mark_invoice'),
    isInvoiced: integer('is_invoiced'),
    rgaid: integer('rgaid'),
    forcedMarkinvoiceButton: integer('forced_markinvoice_button'),
    appliedtaxrate: varchar('appliedtaxrate', { length: 15 }),
    appliedtaxratePst: varchar('appliedtaxrate_pst', { length: 12 }),
  },
  (table) => [
    index('legacy_po_invoice_is_invoiced').on(table.isInvoiced),
    index('legacy_po_invoice_poid').on(table.poid),
    index('legacy_po_invoice_rgaid').on(table.rgaid),
    index('legacy_po_invoice_sage_done').on(table.sageDone),
  ],
)

/**
 * po_invoice_parts — Supplier invoice parts lines (actual vs backorder qty).
 * Rows observed: 3811. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPoInvoiceParts = pgTable(
  'po_invoice_parts',
  {
    id: serial('id').primaryKey(),
    poid: integer('poid'),
    invoiceId: integer('invoice_id').notNull(),
    partno: varchar('partno', { length: 20 }).notNull(),
    modelNumber: varchar('model_number', { length: 200 }),
    actualQty: numeric('actual_qty', { precision: 7, scale: 2 }),
    backorderQty: numeric('backorder_qty', { precision: 7, scale: 2 }),
    qty: numeric('qty', { precision: 7, scale: 2 }),
    price: varchar('price', { length: 20 }),
    linetotal: varchar('linetotal', { length: 20 }),
    sortorder: integer('sortorder'),
    sageprojectno: varchar('sageprojectno', { length: 50 }),
    invoiceProject: varchar('invoice_project', { length: 60 }),
    updateStockQuantity: integer('update_stock_quantity'),
  },
  (table) => [
    index('legacy_po_invoice_parts_invoice_id').on(table.invoiceId),
    index('legacy_po_invoice_parts_partno').on(table.partno),
    index('legacy_po_invoice_parts_poid').on(table.poid),
    index('legacy_po_invoice_parts_update_stock_quantity').on(table.updateStockQuantity),
  ],
)

/**
 * po_invoice_soparts — Supplier invoice special-order lines.
 * Rows observed: 1399. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPoInvoiceSoparts = pgTable(
  'po_invoice_soparts',
  {
    id: serial('id').primaryKey(),
    poid: integer('poid'),
    invoiceId: integer('invoice_id').notNull(),
    name: text('name').notNull(),
    poSoPartId: integer('po_so_part_id').notNull(),
    actualQty: numeric('actual_qty', { precision: 7, scale: 2 }),
    backorderQty: numeric('backorder_qty', { precision: 7, scale: 2 }),
    qty: numeric('qty', { precision: 7, scale: 2 }),
    price: varchar('price', { length: 20 }),
    linetotal: varchar('linetotal', { length: 20 }),
    sortorder: integer('sortorder'),
    sageprojectno: varchar('sageprojectno', { length: 50 }),
    invoiceProject: varchar('invoice_project', { length: 60 }),
  },
)

/**
 * po_notification — Per-user "notify me" subscription for a PO or quote.
 * Rows observed: 14. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPoNotification = pgTable(
  'po_notification',
  {
    id: serial('id').primaryKey(),
    poid: integer('poid').notNull(),
    notifyType: varchar('notify_type', { length: 10 }),
    userId: integer('user_id').notNull(),
    isNotified: integer('is_notified'),
  },
)

/**
 * po_parts — Purchase order parts lines (`qty_received` drives partial-receipt status).
 * Rows observed: 3703. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPoParts = pgTable(
  'po_parts',
  {
    id: serial('id').primaryKey(),
    poid: integer('poid').notNull(),
    partno: varchar('partno', { length: 100 }).notNull(),
    qty: numeric('qty', { precision: 7, scale: 2 }),
    qtyReceived: numeric('qty_received', { precision: 7, scale: 2 }),
    price: varchar('price', { length: 20 }),
    modelNumber: varchar('model_number', { length: 150 }),
    noneCustomerInvoiceItem: integer('none_customer_invoice_item'),
    itemTransferfromType: varchar('item_transferfrom_type', { length: 50 }),
    itemTransferfromTypeNumber: varchar('item_transferfrom_type_number', { length: 50 }),
    itemPurchaseType: varchar('item_purchase_type', { length: 50 }),
    itemPurchaseTypeNumber: varchar('item_purchase_type_number', { length: 50 }),
    underWarranty: integer('under_warranty'),
    doNotDeductFrom: integer('do_not_deduct_from'),
  },
  (table) => [
    index('legacy_po_parts_item_purchase_type_number').on(table.itemPurchaseTypeNumber),
    index('legacy_po_parts_partno').on(table.partno),
    index('legacy_po_parts_poid').on(table.poid),
  ],
)

/**
 * po_preorder — Pre-order header (parts requested before a PO exists).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPoPreorder = pgTable(
  'po_preorder',
  {
    id: serial('id').primaryKey(),
    custQoid: integer('cust_qoid'),
    report: text('report'),
    status: integer('status'),
    priority: integer('priority'),
    notes: text('notes'),
    isWithoutQuote: integer('is_without_quote'),
    workordernumber: varchar('workordernumber', { length: 50 }),
    createdby: integer('createdby'),
    dateReceived: date('date_received', { mode: 'string' }),
    dateCreated: date('date_created', { mode: 'string' }),
  },
)

/**
 * po_preorder_parts — Pre-order parts lines.
 * Rows observed: 114. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPoPreorderParts = pgTable(
  'po_preorder_parts',
  {
    id: serial('id').primaryKey(),
    prePoid: integer('pre_poid').notNull(),
    partno: varchar('partno', { length: 20 }).notNull(),
    qty: integer('qty').notNull(),
    price: numeric('price', { precision: 7, scale: 2 }),
    listId: integer('list_id'),
    supplierId: integer('supplier_id'),
    subSupplierId: integer('sub_supplier_id'),
    costPrice: varchar('cost_price', { length: 20 }),
    noneCustomerInvoiceItem: integer('none_customer_invoice_item'),
    itemPurchaseType: legacyEnumPoPreorderPartsItemPurchaseType('item_purchase_type'),
    itemPurchaseTypeNumber: varchar('item_purchase_type_number', { length: 50 }),
  },
)

/**
 * po_preorder_soparts — Pre-order special-order lines.
 * Rows observed: 4. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPoPreorderSoparts = pgTable(
  'po_preorder_soparts',
  {
    id: serial('id').primaryKey(),
    prePoid: integer('pre_poid').notNull(),
    name: text('name').notNull(),
    qty: integer('qty').notNull(),
    price: numeric('price', { precision: 7, scale: 2 }),
    listId: integer('list_id'),
    supplierId: integer('supplier_id'),
    subSupplierId: integer('sub_supplier_id'),
    costPrice: varchar('cost_price', { length: 20 }),
    noneCustomerInvoiceItem: integer('none_customer_invoice_item'),
    itemPurchaseType: legacyEnumPoPreorderSopartsItemPurchaseType('item_purchase_type'),
    itemPurchaseTypeNumber: varchar('item_purchase_type_number', { length: 50 }),
  },
)

/**
 * po_preorder_suppliers — Suppliers attached to a pre-order.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPoPreorderSuppliers = pgTable(
  'po_preorder_suppliers',
  {
    id: serial('id').primaryKey(),
    prePoid: integer('pre_poid'),
    supplierId: integer('supplier_id'),
    subSupplierId: integer('sub_supplier_id'),
    listId: integer('list_id'),
    supplierResponseStatus: legacyEnumPoPreorderSuppliersSupplierResponseStatus('supplier_response_status'),
    quotesCounter: integer('quotes_counter'),
    resubmissionRequest: integer('resubmission_request'),
    dated: timestamp('dated', { mode: 'string', withTimezone: false }),
    msgNotes: text('msg_notes'),
    processedAsOrder: integer('processed_as_order'),
  },
)

/**
 * po_quote — Request-for-quote header (RFQ to suppliers).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPoQuote = pgTable(
  'po_quote',
  {
    id: serial('id').primaryKey(),
    poid: integer('poid'),
    report: text('report'),
    status: integer('status'),
    priority: integer('priority'),
    notes: text('notes'),
    dateReceived: date('date_received', { mode: 'string' }),
    dateCreated: date('date_created', { mode: 'string' }),
  },
)

/**
 * po_quote_requested_parts — Parts requested in an RFQ.
 * Rows observed: 18. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPoQuoteRequestedParts = pgTable(
  'po_quote_requested_parts',
  {
    id: serial('id').primaryKey(),
    reqQoid: integer('req_qoid').notNull(),
    partno: varchar('partno', { length: 20 }).notNull(),
    qty: integer('qty').notNull(),
    price: numeric('price', { precision: 7, scale: 2 }),
    supplierLists: text('supplier_lists'),
  },
)

/**
 * po_quote_requested_parts_detail — Detail/description lines for RFQ parts.
 * Rows observed: 30. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPoQuoteRequestedPartsDetail = pgTable(
  'po_quote_requested_parts_detail',
  {
    id: serial('id').primaryKey(),
    reqQoid: integer('req_qoid').notNull(),
    partno: varchar('partno', { length: 20 }).notNull(),
    qty: integer('qty').notNull(),
    price: numeric('price', { precision: 7, scale: 2 }),
    listId: integer('list_id'),
    supplierId: integer('supplier_id'),
    costPrice: varchar('cost_price', { length: 20 }),
  },
)

/**
 * po_quote_suppliers — Suppliers invited to an RFQ, with per-supplier response status.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPoQuoteSuppliers = pgTable(
  'po_quote_suppliers',
  {
    id: serial('id').primaryKey(),
    reqQoid: integer('req_qoid'),
    supplierId: integer('supplier_id'),
    listId: integer('list_id'),
    sageId: integer('sage_id'),
    supplierUserId: integer('supplier_user_id'),
    supplierResponseStatus: legacyEnumPoQuoteSuppliersSupplierResponseStatus('supplier_response_status'),
    quotesCounter: integer('quotes_counter'),
    resubmissionRequest: integer('resubmission_request'),
    dated: timestamp('dated', { mode: 'string', withTimezone: false }),
    msgNotes: text('msg_notes'),
  },
)

/**
 * po_soparts — Purchase order special-order part lines.
 * Rows observed: 1349. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPoSoparts = pgTable(
  'po_soparts',
  {
    id: serial('id').primaryKey(),
    poid: integer('poid').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    qty: numeric('qty', { precision: 7, scale: 2 }),
    qtyReceived: numeric('qty_received', { precision: 7, scale: 2 }),
    price: varchar('price', { length: 20 }),
    modelNumber: varchar('model_number', { length: 150 }),
    noneCustomerInvoiceItem: integer('none_customer_invoice_item'),
    itemTransferfromType: varchar('item_transferfrom_type', { length: 50 }),
    itemTransferfromTypeNumber: varchar('item_transferfrom_type_number', { length: 50 }),
    itemPurchaseType: varchar('item_purchase_type', { length: 50 }),
    itemPurchaseTypeNumber: varchar('item_purchase_type_number', { length: 50 }),
    doNotDeductFrom: integer('do_not_deduct_from'),
  },
  (table) => [
    index('legacy_po_soparts_item_purchase_type_number').on(table.itemPurchaseTypeNumber),
    index('legacy_po_soparts_name').on(table.name),
    index('legacy_po_soparts_poid').on(table.poid),
  ],
)

/**
 * po_submission_after_approval — Queued e-mail of an approved PO to the supplier, with attachment options.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPoSubmissionAfterApproval = pgTable(
  'po_submission_after_approval',
  {
    id: serial('id').primaryKey(),
    poid: integer('poid'),
    emailSubject: text('email_subject'),
    emailNotes: text('email_notes'),
    mainEmail: text('main_email'),
    allianceemails: text('allianceemails'),
    ccEmails: text('cc_emails'),
    attachPoFile: varchar('attach_po_file', { length: 10 }),
    attachAllFiles: varchar('attach_all_files', { length: 10 }),
    attachIndividualFiles: text('attach_individual_files'),
    submitBy: integer('submit_by'),
    isPending: integer('is_pending'),
    dateCreated: timestamp('date_created', { mode: 'string', withTimezone: false }),
  },
)

/**
 * po_supplier_quote — Supplier's quote/response against an RFQ.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPoSupplierQuote = pgTable(
  'po_supplier_quote',
  {
    id: serial('id').primaryKey(),
    reqQoid: integer('req_qoid'),
    poid: integer('poid'),
    supplierId: integer('supplier_id'),
    report: text('report'),
    status: integer('status'),
    priority: integer('priority'),
    notes: text('notes'),
    expDeliveryDate: date('exp_delivery_date', { mode: 'string' }),
    dateCreated: date('date_created', { mode: 'string' }),
    resubmissionRequest: integer('resubmission_request'),
    processedAsOrder: integer('processed_as_order'),
  },
)

/**
 * po_supplier_quote_parts — Supplier quote line items.
 * Rows observed: 4. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPoSupplierQuoteParts = pgTable(
  'po_supplier_quote_parts',
  {
    id: serial('id').primaryKey(),
    supQoid: integer('sup_qoid'),
    reqQoid: integer('req_qoid').notNull(),
    partno: varchar('partno', { length: 20 }).notNull(),
    qty: integer('qty').notNull(),
    price: numeric('price', { precision: 7, scale: 2 }),
    additionalNote: text('additional_note'),
  },
)

/**
 * rga — Return-goods-authorisation header (return to supplier, warranty or credit).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyRga = pgTable(
  'rga',
  {
    id: serial('id').primaryKey(),
    supplierId: integer('supplier_id'),
    poid: integer('poid'),
    status: integer('status'),
    statusOnJuly212025: integer('status_on_july_21_2025'),
    rgaNotes: text('rga_notes'),
    notes: text('notes'),
    requestDate: date('request_date', { mode: 'string' }),
    rgaInvoicedate: varchar('rga_invoicedate', { length: 50 }),
    rgaInvoicenumber: varchar('rga_invoicenumber', { length: 50 }),
    shipAddressContactname: text('ship_address_contactname'),
    shipAddressCompany: text('ship_address_company'),
    shipAddressStreet1: text('ship_address_street1'),
    shipAddressStreet2: text('ship_address_street2'),
    shipAddressCity: text('ship_address_city'),
    shipAddressProvince: text('ship_address_province'),
    shipAddressPostalcode: text('ship_address_postalcode'),
    shipAddressPhone: text('ship_address_phone'),
    shippingAddress: text('shipping_address'),
    createdby: integer('createdby'),
    isMarkedCritical: integer('is_marked_critical'),
    completiondate: integer('completiondate'),
    dateCreated: timestamp('date_created', { mode: 'string', withTimezone: false }),
    dateCompleted: timestamp('date_completed', { mode: 'string', withTimezone: false }),
    rgaFolderAttachPath: varchar('rga_folder_attach_path', { length: 200 }),
    isOnlineVendorOrder: integer('is_online_vendor_order'),
    stockUpdated: integer('stock_updated'),
    revisionNo: integer('revision_no'),
    isTypeMaintenance: integer('is_type_maintenance'),
    isSubmitted: integer('is_submitted'),
    rgaType: varchar('rga_type', { length: 20 }),
    replacementType: varchar('replacement_type', { length: 25 }),
    subcontractor: integer('subcontractor'),
    site: integer('site'),
    workordernumber: varchar('workordernumber', { length: 20 }),
  },
  (table) => [
    index('legacy_rga_poid').on(table.poid),
    index('legacy_rga_replacement_type').on(table.replacementType),
    index('legacy_rga_rga_type').on(table.rgaType),
    index('legacy_rga_status').on(table.status),
    index('legacy_rga_subcontractor').on(table.subcontractor),
    index('legacy_rga_supplier_id').on(table.supplierId),
  ],
)

/**
 * rga_invoice — RGA credit/invoice record raised against a supplier return.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyRgaInvoice = pgTable(
  'rga_invoice',
  {
    id: serial('id').primaryKey(),
    rgaid: integer('rgaid').notNull(),
    invoicenumber: varchar('invoicenumber', { length: 100 }),
    invoiceSupplierId: integer('invoice_supplier_id'),
    taxAmount: numeric('tax_amount', { precision: 7, scale: 2 }).notNull(),
    taxCode: varchar('tax_code', { length: 25 }).notNull(),
    workordernumber: varchar('workordernumber', { length: 100 }),
    shippingCharges: varchar('shipping_charges', { length: 50 }),
    clsInvoicenumber: varchar('cls_invoicenumber', { length: 50 }),
    invoiceReport: text('invoice_report'),
    taxHst: numeric('tax_hst', { precision: 7, scale: 2 }),
    taxGst: numeric('tax_gst', { precision: 7, scale: 2 }),
    taxPst: numeric('tax_pst', { precision: 7, scale: 2 }),
    taxTvp: numeric('tax_tvp', { precision: 7, scale: 2 }),
    subTotal: varchar('sub_total', { length: 25 }),
    totalAmount: varchar('total_amount', { length: 25 }),
    createdby: integer('createdby'),
    dateCreated: date('date_created', { mode: 'string' }),
    invoiceDate: date('invoice_date', { mode: 'string' }),
    invoiceLevel: integer('invoice_level'),
    sageDone: integer('sage_done'),
    isInvoiced: integer('is_invoiced'),
  },
)

/**
 * rga_invoice_parts — RGA invoice parts lines (defined, zero rows in this snapshot).
 * Rows observed: 0. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyRgaInvoiceParts = pgTable(
  'rga_invoice_parts',
  {
    id: serial('id').primaryKey(),
    rgaid: integer('rgaid'),
    invoiceId: integer('invoice_id').notNull(),
    partno: varchar('partno', { length: 20 }).notNull(),
    actualQty: integer('actual_qty'),
    backorderQty: integer('backorder_qty').notNull(),
    qty: integer('qty'),
    price: varchar('price', { length: 20 }),
    linetotal: varchar('linetotal', { length: 20 }),
    sortorder: integer('sortorder'),
    sageprojectno: varchar('sageprojectno', { length: 25 }),
  },
)

/**
 * rga_invoice_soparts — RGA invoice special-order lines (defined, zero rows).
 * Rows observed: 0. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyRgaInvoiceSoparts = pgTable(
  'rga_invoice_soparts',
  {
    id: serial('id').primaryKey(),
    rgaid: integer('rgaid'),
    invoiceId: integer('invoice_id').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    rgaSoPartId: integer('rga_so_part_id').notNull(),
    actualQty: integer('actual_qty'),
    backorderQty: integer('backorder_qty').notNull(),
    qty: integer('qty'),
    price: varchar('price', { length: 20 }),
    linetotal: varchar('linetotal', { length: 20 }),
    sortorder: integer('sortorder'),
    sageprojectno: varchar('sageprojectno', { length: 25 }),
  },
)

/**
 * rga_notification — Per-user RGA notification subscription.
 * Rows observed: 412. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyRgaNotification = pgTable(
  'rga_notification',
  {
    id: serial('id').primaryKey(),
    rgaid: integer('rgaid').notNull(),
    notifyType: varchar('notify_type', { length: 30 }),
    userId: integer('user_id').notNull(),
    isNotified: integer('is_notified'),
    notifyDate: date('notify_date', { mode: 'string' }),
  },
)

/**
 * rga_parts — RGA parts lines (qty, reason, warranty flag, linked PO part).
 * Rows observed: 443. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyRgaParts = pgTable(
  'rga_parts',
  {
    id: serial('id').primaryKey(),
    rgaid: integer('rgaid').notNull(),
    partno: varchar('partno', { length: 50 }).notNull(),
    qty: numeric('qty', { precision: 7, scale: 2 }),
    price: varchar('price', { length: 20 }),
    modelNumber: varchar('model_number', { length: 150 }),
    reasonForReturn: text('reason_for_return'),
    itemPurchaseType: varchar('item_purchase_type', { length: 50 }),
    itemPurchaseTypeNumber: varchar('item_purchase_type_number', { length: 50 }),
    poNumber: varchar('po_number', { length: 50 }),
    poPartId: integer('po_part_id'),
    returnQty: varchar('return_qty', { length: 15 }),
    underWarranty: integer('under_warranty'),
    rpInvoicenumber: varchar('rp_invoicenumber', { length: 100 }),
    rpInvoicedate: varchar('rp_invoicedate', { length: 25 }),
  },
  (table) => [
    index('legacy_rga_parts_partno').on(table.partno),
    index('legacy_rga_parts_po_number').on(table.poNumber),
    index('legacy_rga_parts_rgaid').on(table.rgaid),
  ],
)

/**
 * rga_soparts — RGA special-order part lines.
 * Rows observed: 194. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyRgaSoparts = pgTable(
  'rga_soparts',
  {
    id: serial('id').primaryKey(),
    rgaid: integer('rgaid').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    qty: numeric('qty', { precision: 7, scale: 2 }),
    price: varchar('price', { length: 20 }),
    modelNumber: varchar('model_number', { length: 150 }),
    reasonForReturn: text('reason_for_return'),
    itemPurchaseType: varchar('item_purchase_type', { length: 50 }),
    itemPurchaseTypeNumber: varchar('item_purchase_type_number', { length: 50 }),
    poNumber: varchar('po_number', { length: 50 }),
    poSopartId: integer('po_sopart_id'),
    returnQty: varchar('return_qty', { length: 15 }),
    rpInvoicenumber: varchar('rp_invoicenumber', { length: 25 }),
    rpInvoicedate: varchar('rp_invoicedate', { length: 25 }),
  },
  (table) => [
    index('legacy_rga_soparts_name').on(table.name),
  ],
)
