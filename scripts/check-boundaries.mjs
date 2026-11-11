#!/usr/bin/env node
/**
 * Boundary gates for the Purchasing module.
 *
 * 1. Only Inventory and Purchasing may touch the stock ledger.
 * 2. No code writes the legacy `public.purchaseorder*` tables.
 * 3. No app.purchase_orders writes outside the purchasing module.
 * 4. No legacy per-username approval/issue checks reappear.
 * 5. Only Inventory writes part prices and rate-card prices.
 */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const root = process.cwd()
const failures = []

function rg(args) {
  try {
    return execFileSync('rg', args, { cwd: root, encoding: 'utf8' }).trim()
  } catch (error) {
    if (error.status === 1) return ''
    throw error
  }
}

function files(patterns, globs = ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}']) {
  const args = ['--files-with-matches', ...patterns.flatMap((p) => ['-e', p])]
  for (const glob of globs) args.push('-g', glob)
  return rg(args).split('\n').filter(Boolean)
}

function isPurchasing(path) {
  return path.includes('modules/purchasing/')
}

function isInventory(path) {
  return path.includes('modules/inventory/')
}

// 1. Stock ledger ownership.
for (const file of files(['inventoryMovements', 'inventory_movements'])) {
  if (isPurchasing(file) || isInventory(file)) continue
  if (file.includes('packages/db/src/schema')) continue
  failures.push(`stock ledger referenced outside purchasing/inventory: ${file}`)
}
for (const file of files(['current_quantity', 'currentQuantity'])) {
  if (isInventory(file)) continue
  if (file.includes('packages/db/src/schema')) continue
  failures.push(`part counter referenced outside inventory: ${file}`)
}

// 2. Legacy purchasing tables are read-only.
for (const file of files(
  ['public\\.purchaseorder'],
  ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}', 'scripts/**/*.ts'],
)) {
  const text = execFileSync('cat', [join(root, file)], { encoding: 'utf8' })
  if (/\b(insert\s+into|update|delete\s+from)\s+(public\.)?purchaseorder/i.test(text)) {
    failures.push(`write against legacy public.purchaseorder*: ${file}`)
  }
}

// 3. New purchasing writes stay in the module.
const writePatterns = [
  'insert\\(purchaseOrders',
  'update\\(purchaseOrders',
  'delete\\(purchaseOrders',
  'insert\\(purchaseOrderParts',
  'insert\\(purchaseOrderReceipts',
  'insert\\(purchaseOrderInvoices',
]
for (const file of files(writePatterns)) {
  if (isPurchasing(file)) continue
  failures.push(`purchase-order write outside the purchasing module: ${file}`)
}

// 4. Legacy username checks must not return.
for (const file of files(
  ['carmen', 'ASzpytka', '\\$PowerUserName'],
  ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
)) {
  if (file.includes('.test.')) continue
  failures.push(`legacy username check in code: ${file}`)
}

// 5. Price writes belong to Inventory only (E5 single write path).
const priceWrite =
  /(insert|update)\((parts|partSupplierRates|partSellingRates)\)[\s\S]{0,900}?\b(cost|sellPrice|installPrice|recyclePrice)\b/
for (const file of files([
  'insert\\(parts',
  'update\\(parts',
  'insert\\(partSupplierRates',
  'update\\(partSupplierRates',
  'insert\\(partSellingRates',
  'update\\(partSellingRates',
])) {
  if (isInventory(file)) continue
  if (file.includes('packages/db/src/schema')) continue
  if (file.includes('.test.')) continue
  const text = execFileSync('cat', [join(root, file)], { encoding: 'utf8' })
  if (priceWrite.test(text)) {
    failures.push(`part price write outside inventory: ${file}`)
  }
}

if (failures.length > 0) {
  console.error('Boundary check failed:\n' + failures.map((line) => `  - ${line}`).join('\n'))
  process.exit(1)
}
console.log(
  'Boundary check passed: purchasing owns its tables, inventory owns stock and every price write.',
)
