// @generated
// Source: packages/db/contract/schema.json (2026-11-11).
// Do not edit by hand. Run `pnpm db:generate:schema` after updating the contract.
// Domain: inventory

import { bigint, date, index, integer, numeric, pgEnum, pgTable, serial, smallint, text, timestamp, varchar } from 'drizzle-orm/pg-core'
export const legacyEnumPartsInventoryAdjustmentAdjustmentType = pgEnum('legacy_parts_inventory_adjustment_adjustment_type', ["global", "alliance", "subcontractor", "customer", "contractor", ""])
export const legacyEnumPartsSalepurchaseLogAdjustmentType = pgEnum('legacy_parts_salepurchase_log_adjustment_type', ["alliance", "subcontractor", "customer", "contractor", ""])

/**
 * parts — Parts/item master: number, cost, sell price, stock counters, Sage link, profit formulas.
 * Rows observed: 2605. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyParts = pgTable(
  'parts',
  {
    name: text('name'),
    number: varchar('number', { length: 50 }),
    // joined to Sage tinvent.sPartCode; unique
    cost: numeric('cost', { precision: 7, scale: 2 }),
    id: serial('id').primaryKey(),
    subignore: smallint('subignore'),
    sellPrice: numeric('sell_price', { precision: 7, scale: 2 }),
    sageId: integer('sage_id'),
    partGroupId: integer('part_group_id'),
    warranty: varchar('warranty', { length: 75 }),
    laborWarranty: varchar('labor_warranty', { length: 75 }),
    purchasedQuantity: numeric('purchased_quantity', { precision: 7, scale: 2 }),
    currentQuantity: numeric('current_quantity', { precision: 7, scale: 2 }),
    // authoritative counter (do not derive from the ledger)
    soldQuantity: numeric('sold_quantity', { precision: 7, scale: 2 }),
    // incremented on sale; paired with current_quantity
    installcostperunit: varchar('installcostperunit', { length: 15 }),
    installProfitFormula: varchar('install_profit_formula', { length: 50 }),
    recycleProfitFormula: varchar('recycle_profit_formula', { length: 50 }),
    savedSagePrice: varchar('saved_sage_price', { length: 50 }),
    isSageSaved: integer('is_sage_saved'),
    partPopupNotes: text('part_popup_notes'),
    parentPartnumber: varchar('parent_partnumber', { length: 50 }),
    clsLinkedPartcode: varchar('cls_linked_partcode', { length: 20 }),
    activeInSage: integer('active_in_sage'),
    defaultsortorder: integer('defaultsortorder'),
  },
  (table) => [
    index('legacy_parts_number').on(table.number),
  ],
)

/**
 * shared_parts_list — Mapping of part code → main part code (shared/TJX parts).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacySharedPartsList = pgTable(
  'shared_parts_list',
  {
    partcode: varchar('partcode', { length: 15 }).notNull(),
    mainPartcode: varchar('main_partcode', { length: 15 }).notNull(),
  },
)

/**
 * parts_inventory — Per-shipment inventory receipt (cost, sell, markup, qty).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPartsInventory = pgTable(
  'parts_inventory',
  {
    id: serial('id').primaryKey(),
    partId: integer('part_id').notNull(),
    supplierId: integer('supplier_id').notNull(),
    shipmentDetail: text('shipment_detail'),
    purchasedQuantity: integer('purchased_quantity'),
    costPrice: numeric('cost_price', { precision: 7, scale: 2 }),
    sellPrice: numeric('sell_price', { precision: 7, scale: 2 }),
    markup: numeric('markup', { precision: 7, scale: 2 }),
    soldQuantity: integer('sold_quantity'),
    status: varchar('status', { length: 15 }),
    datePurchased: timestamp('date_purchased', { mode: 'string', withTimezone: false }),
  },
)

/**
 * parts_inventory_adjustment — Manual stock adjustments (field counts, subcontractor/site attribution).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPartsInventoryAdjustment = pgTable(
  'parts_inventory_adjustment',
  {
    id: serial('id').primaryKey(),
    partno: varchar('partno', { length: 50 }),
    qty: varchar('qty', { length: 15 }),
    price: varchar('price', { length: 30 }),
    dateCreated: timestamp('date_created', { mode: 'string', withTimezone: false }),
    adjustmentType: legacyEnumPartsInventoryAdjustmentAdjustmentType('adjustment_type'),
    notes: text('notes'),
    isLogDeleted: integer('is_log_deleted'),
    insertedDatetime: timestamp('inserted_datetime', { mode: 'string', withTimezone: false }),
    workordernumber: varchar('workordernumber', { length: 25 }),
    site: integer('site'),
    subcontractor: integer('subcontractor'),
    massAdjustmentNumber: integer('mass_adjustment_number'),
  },
  (table) => [
    index('legacy_parts_inventory_adjustment_adjustment_type').on(table.adjustmentType),
    index('legacy_parts_inventory_adjustment_partno').on(table.partno),
  ],
)

/**
 * parts_price_history — Price change history per part.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPartsPriceHistory = pgTable(
  'parts_price_history',
  {
    id: serial('id').primaryKey(),
    priceId: integer('price_id').notNull(),
    fieldName: varchar('field_name', { length: 30 }).notNull(),
    lastValue: varchar('last_value', { length: 30 }),
    newValue: varchar('new_value', { length: 30 }),
    userName: varchar('user_name', { length: 50 }).notNull(),
    sectionName: text('section_name'),
    dateInserted: timestamp('date_inserted', { mode: 'string', withTimezone: false }),
  },
)

/**
 * parts_price_lock — Single-row global lock on the price editor (id=1).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPartsPriceLock = pgTable(
  'parts_price_lock',
  {
    id: serial('id').primaryKey(),
    isLocked: integer('is_locked'),
    lockedBy: varchar('locked_by', { length: 50 }),
    lockTime: integer('lock_time'),
  },
)

/**
 * parts_purchased_inventory — Purchased-inventory staging rows.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPartsPurchasedInventory = pgTable(
  'parts_purchased_inventory',
  {
    id: serial('id').primaryKey(),
    partNo: varchar('part_no', { length: 50 }),
    partDesc: varchar('part_desc', { length: 200 }),
    inventoryTrackingId: integer('inventory_tracking_id'),
    invoiceNumber: varchar('invoice_number', { length: 50 }),
    invoiceLineNo: integer('invoice_line_no'),
    unitPrice: numeric('unit_price', { precision: 7, scale: 2 }),
    qty: integer('qty'),
    sageVendorId: integer('sage_vendor_id'),
    dateInvoiced: timestamp('date_invoiced', { mode: 'string', withTimezone: false }),
    dateCreatedTime: bigint('date_created_time', { mode: 'number' }),
  },
)

/**
 * parts_purchasing_log — Purchasing movement log per PO/part.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPartsPurchasingLog = pgTable(
  'parts_purchasing_log',
  {
    id: serial('id').primaryKey(),
    poid: integer('poid'),
    partno: varchar('partno', { length: 50 }),
    qty: varchar('qty', { length: 15 }),
    price: varchar('price', { length: 15 }),
    stockIdentifier: varchar('stock_identifier', { length: 50 }),
    dateCreated: timestamp('date_created', { mode: 'string', withTimezone: false }),
  },
)

/**
 * parts_salepurchase_log — Stock movement ledger: Sale / Purchase / Adjustment, with invoice and qty.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 * `woid_poid`, `invoice_number` and `invoice_id` duplicate one identifier.
 */
export const legacyPartsSalepurchaseLog = pgTable(
  'parts_salepurchase_log',
  {
    id: serial('id').primaryKey(),
    woidPoid: integer('woid_poid'),
    invoiceId: integer('invoice_id'),
    invoiceNumber: varchar('invoice_number', { length: 50 }),
    partno: varchar('partno', { length: 50 }),
    qty: varchar('qty', { length: 15 }),
    price: varchar('price', { length: 15 }),
    dateCreated: timestamp('date_created', { mode: 'string', withTimezone: false }),
    transactionType: varchar('transaction_type', { length: 15 }),
    // observed values: 'Sale', 'Purchase', 'Adjustment'
    notes: text('notes'),
    isLogDeleted: integer('is_log_deleted'),
    insertedDatetime: timestamp('inserted_datetime', { mode: 'string', withTimezone: false }),
    isIncludeedInStockManagement: integer('is_includeed_in_stock_management'),
    adjustmentType: legacyEnumPartsSalepurchaseLogAdjustmentType('adjustment_type'),
    onFieldCountedQty: varchar('on_field_counted_qty', { length: 20 }),
    adjSubcontractor: integer('adj_subcontractor'),
    adjSite: integer('adj_site'),
  },
)

/**
 * parts_selling_log — Selling log per work order/part.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPartsSellingLog = pgTable(
  'parts_selling_log',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid'),
    partno: varchar('partno', { length: 50 }),
    qty: varchar('qty', { length: 15 }),
    price: varchar('price', { length: 15 }),
    dateCreated: timestamp('date_created', { mode: 'string', withTimezone: false }),
  },
)

/**
 * parts_selling_rates — Selling rate table per part/supplier.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPartsSellingRates = pgTable(
  'parts_selling_rates',
  {
    id: serial('id').primaryKey(),
    partCode: varchar('part_code', { length: 50 }),
    listId: integer('list_id'),
    oldSellPrice: numeric('old_sell_price', { precision: 7, scale: 2 }),
    increasePercentage: integer('increase_percentage'),
    sellPrice: numeric('sell_price', { precision: 7, scale: 2 }),
    installPrice: numeric('install_price', { precision: 7, scale: 2 }),
    recyclePrice: numeric('recycle_price', { precision: 7, scale: 2 }),
    dateInserted: timestamp('date_inserted', { mode: 'string', withTimezone: false }),
  },
)

/**
 * parts_selling_rates_list — Selling-rate list headers.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPartsSellingRatesList = pgTable(
  'parts_selling_rates_list',
  {
    id: serial('id').primaryKey(),
    listHeading: varchar('list_heading', { length: 100 }),
    listDate: date('list_date', { mode: 'string' }),
    isWinner: integer('is_winner'),
  },
)

/**
 * parts_sub_suppliers — Sub-supplier links for a part.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPartsSubSuppliers = pgTable(
  'parts_sub_suppliers',
  {
    id: serial('id').primaryKey(),
    supplierId: integer('supplier_id'),
    name: varchar('name', { length: 50 }),
    location: text('location'),
    contactNumber: varchar('contact_number', { length: 50 }),
    contactEmails: text('contact_emails'),
  },
)

/**
 * parts_supplier_model_rates — Supplier model-number-specific cost/sell rates.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPartsSupplierModelRates = pgTable(
  'parts_supplier_model_rates',
  {
    id: serial('id').primaryKey(),
    partCode: varchar('part_code', { length: 50 }),
    listId: integer('list_id'),
    supplierId: integer('supplier_id'),
    modelPrice: varchar('model_price', { length: 50 }),
    defaultModel: integer('default_model'),
    modelNumber: text('model_number'),
  },
  (table) => [
    index('legacy_parts_supplier_model_rates_part_code').on(table.partCode),
    index('legacy_parts_supplier_model_rates_supplier_id').on(table.supplierId),
  ],
)

/**
 * parts_supplier_rates — Supplier rate card per part (cost, sell, install, recycle, markup, model numbers, warranty).
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPartsSupplierRates = pgTable(
  'parts_supplier_rates',
  {
    id: serial('id').primaryKey(),
    partCode: varchar('part_code', { length: 50 }),
    listId: integer('list_id'),
    supplierId: integer('supplier_id'),
    subSupplierId: integer('sub_supplier_id'),
    costPrice: varchar('cost_price', { length: 50 }),
    lastCostPrice: varchar('last_cost_price', { length: 30 }),
    dateInserted: timestamp('date_inserted', { mode: 'string', withTimezone: false }),
    markup: numeric('markup', { precision: 7, scale: 2 }),
    sellPrice: numeric('sell_price', { precision: 7, scale: 2 }),
    lastSellPrice: numeric('last_sell_price', { precision: 7, scale: 2 }),
    installPrice: numeric('install_price', { precision: 7, scale: 2 }),
    recyclePrice: numeric('recycle_price', { precision: 7, scale: 2 }),
    defaultRate: integer('default_rate'),
    modelNumber1: text('model_number_1'),
    modelNumber2: text('model_number_2'),
    modelNumber3: text('model_number_3'),
    supplierWarranty: varchar('supplier_warranty', { length: 10 }),
    costPriceDecimal: numeric('cost_price_decimal', { precision: 7, scale: 2 }),
  },
  (table) => [
    index('legacy_parts_supplier_rates_part_code').on(table.partCode),
  ],
)

/**
 * parts_supplier_rates_list — Supplier rate-card list headers.
 * Rows observed: 0. Engine: InnoDB.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPartsSupplierRatesList = pgTable(
  'parts_supplier_rates_list',
  {
    id: serial('id').primaryKey(),
    supplierId: integer('supplier_id'),
    listHeading: varchar('list_heading', { length: 100 }),
    listDate: date('list_date', { mode: 'string' }),
    hasBuyRates: integer('has_buy_rates'),
  },
)

/**
 * prf — Purchase requisition form header (internal request before PO).
 * Rows observed: 20. Engine: MyISAM.
 *
 * Legacy MySQL table. Names and nullability are preserved for migration parity.
 */
export const legacyPrf = pgTable(
  'prf',
  {
    id: serial('id').primaryKey(),
    woid: integer('woid').notNull(),
    description: text('description'),
    tech: varchar('tech', { length: 50 }).notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    notes: text('notes'),
    eta: date('eta', { mode: 'string' }),
    status: varchar('status', { length: 50 }).notNull(),
  },
)
