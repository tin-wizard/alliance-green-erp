/**
 * Master Data server functions — the module's read boundary.
 *
 * CLIENT SAFE: server-only imports happen inside handlers. Master Data has no
 * price-write path; parts and rate cards are read-only here. The only price
 * editor is the future price-management screen, which owns the global lock.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { ValidationError } from '@cls/core'
import { assertPermission, authMiddleware, permissionMiddleware } from '../../../server/middleware'
import type {
  CustomerDetail,
  CustomerListRow,
  PageResult,
  PartDetail,
  PartListRow,
  SiteDetail,
  SiteListRow,
  SubcontractorDetail,
  SubcontractorListRow,
  SupplierDetail,
  SupplierListRow,
} from '../types'
import {
  customerCreateSchema,
  customerUpdateSchema,
  documentUploadSchema,
  duplicateCheckSchema,
  findPriceFields,
  importRunSchema,
  partCreateSchema,
  partUpdateSchema,
  recordIdSchema,
  siteCreateSchema,
  siteUpdateSchema,
  subcontractorCreateSchema,
  subcontractorUpdateSchema,
  supplierCreateSchema,
  supplierUpdateSchema,
} from '../lib/write-validation'

const listSchema = z.object({
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25),
})

const idSchema = z.object({ id: recordIdSchema })

const siteListSchema = listSchema.extend({
  parent: z.enum(['all', 'present', 'missing']).default('all'),
})

const subcontractorListSchema = listSchema.extend({
  wsib: z.enum(['all', 'valid', 'missing']).default('all'),
})

export const listCustomersFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => listSchema.parse(input ?? {}))
  .middleware([permissionMiddleware('customer:read')])
  .handler(async ({ data }): Promise<PageResult<CustomerListRow>> => {
    const { listCustomers } = await import('./master-data.server')
    return listCustomers(data)
  })

export const getCustomerFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => idSchema.parse(input))
  .middleware([permissionMiddleware('customer:read')])
  .handler(async ({ data }): Promise<CustomerDetail | null> => {
    const { getCustomer } = await import('./master-data.server')
    return getCustomer(data.id)
  })

export const listSitesFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => siteListSchema.parse(input ?? {}))
  .middleware([permissionMiddleware('customer:read')])
  .handler(async ({ data }): Promise<PageResult<SiteListRow>> => {
    const { listSites } = await import('./master-data.server')
    return listSites(data)
  })

export const getSiteFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => idSchema.parse(input))
  .middleware([permissionMiddleware('customer:read')])
  .handler(async ({ data }): Promise<SiteDetail | null> => {
    const { getSite } = await import('./master-data.server')
    return getSite(data.id)
  })

export const listSubcontractorsFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => subcontractorListSchema.parse(input ?? {}))
  .middleware([permissionMiddleware('subcontractor:read')])
  .handler(async ({ data }): Promise<PageResult<SubcontractorListRow>> => {
    const { listSubcontractors } = await import('./master-data.server')
    return listSubcontractors(data)
  })

export const getSubcontractorFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => idSchema.parse(input))
  .middleware([permissionMiddleware('subcontractor:read')])
  .handler(async ({ data }): Promise<SubcontractorDetail | null> => {
    const { getSubcontractor } = await import('./master-data.server')
    return getSubcontractor(data.id)
  })

export const listSuppliersFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => listSchema.parse(input ?? {}))
  .middleware([permissionMiddleware('supplier:read')])
  .handler(async ({ data }): Promise<PageResult<SupplierListRow>> => {
    const { listSuppliers } = await import('./master-data.server')
    return listSuppliers(data)
  })

export const getSupplierFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => idSchema.parse(input))
  .middleware([permissionMiddleware('supplier:read')])
  .handler(async ({ data }): Promise<SupplierDetail | null> => {
    const { getSupplier } = await import('./master-data.server')
    return getSupplier(data.id)
  })

export const listPartsFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => listSchema.parse(input ?? {}))
  .middleware([permissionMiddleware('inventory:read')])
  .handler(async ({ data }): Promise<PageResult<PartListRow>> => {
    const { listParts } = await import('./master-data.server')
    return listParts(data)
  })

export const getPartFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => idSchema.parse(input))
  .middleware([permissionMiddleware('inventory:read')])
  .handler(async ({ data }): Promise<PartDetail | null> => {
    const { getPart } = await import('./master-data.server')
    return getPart(data.id)
  })

/* -------------------------------- writes -------------------------------- */

function rejectPricePayload(input: unknown): void {
  const fields = findPriceFields(input)
  if (fields.length > 0) {
    throw new ValidationError('Prices and rate cards cannot be written from Master Data.', {
      code: 'PRICE_FIELD_NOT_WRITABLE',
      fields,
    })
  }
}

export const createCustomerFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => customerCreateSchema.parse(input))
  .middleware([permissionMiddleware('customer:write')])
  .handler(async ({ data, context }) => {
    const { createCustomer } = await import('./master-data.write.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => createCustomer(tx, data, context.session))
  })

export const updateCustomerFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => customerUpdateSchema.parse(input))
  .middleware([permissionMiddleware('customer:write')])
  .handler(async ({ data, context }) => {
    const { updateCustomer } = await import('./master-data.write.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => updateCustomer(tx, data, context.session))
  })

export const createSiteFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => siteCreateSchema.parse(input))
  .middleware([permissionMiddleware('customer:write')])
  .handler(async ({ data, context }) => {
    const { createSite } = await import('./master-data.write.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => createSite(tx, data, context.session))
  })

export const updateSiteFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => siteUpdateSchema.parse(input))
  .middleware([permissionMiddleware('customer:write')])
  .handler(async ({ data, context }) => {
    const { updateSite } = await import('./master-data.write.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => updateSite(tx, data, context.session))
  })

export const createSubcontractorFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => subcontractorCreateSchema.parse(input))
  .middleware([permissionMiddleware('subcontractor:write')])
  .handler(async ({ data, context }) => {
    const { createSubcontractor } = await import('./master-data.write.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => createSubcontractor(tx, data, context.session))
  })

export const updateSubcontractorFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => subcontractorUpdateSchema.parse(input))
  .middleware([permissionMiddleware('subcontractor:write')])
  .handler(async ({ data, context }) => {
    const { updateSubcontractor } = await import('./master-data.write.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => updateSubcontractor(tx, data, context.session))
  })

export const createSupplierFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => supplierCreateSchema.parse(input))
  .middleware([permissionMiddleware('supplier:write')])
  .handler(async ({ data, context }) => {
    const { createSupplier } = await import('./master-data.write.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => createSupplier(tx, data, context.session))
  })

export const updateSupplierFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => supplierUpdateSchema.parse(input))
  .middleware([permissionMiddleware('supplier:write')])
  .handler(async ({ data, context }) => {
    const { updateSupplier } = await import('./master-data.write.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => updateSupplier(tx, data, context.session))
  })

export const createPartFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    rejectPricePayload(input)
    return partCreateSchema.parse(input)
  })
  .middleware([permissionMiddleware('inventory:write')])
  .handler(async ({ data, context }) => {
    const { createPart } = await import('./master-data.write.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => createPart(tx, data, context.session))
  })

export const updatePartFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    rejectPricePayload(input)
    return partUpdateSchema.parse(input)
  })
  .middleware([permissionMiddleware('inventory:write')])
  .handler(async ({ data, context }) => {
    const { updatePart } = await import('./master-data.write.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => updatePart(tx, data, context.session))
  })

export const checkDuplicatesFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => duplicateCheckSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const permission =
      data.entity === 'part'
        ? 'inventory:read'
        : data.entity === 'subcontractor'
          ? 'subcontractor:read'
          : data.entity === 'supplier'
            ? 'supplier:read'
            : 'customer:read'
    assertPermission(context.session, permission)
    const {
      checkCustomerDuplicates,
      checkPartDuplicates,
      checkSiteDuplicates,
      checkVendorDuplicates,
    } = await import('./duplicates.server')
    const { getDb } = await import('@cls/db')
    const db = getDb()
    if (data.entity === 'part') {
      if (!data.partNumber) throw new ValidationError('Enter a part number.')
      return checkPartDuplicates(db, { ...data, partNumber: data.partNumber })
    }
    if (!data.name) throw new ValidationError('Enter a name.')
    const named = { ...data, name: data.name }
    if (data.entity === 'customer') return checkCustomerDuplicates(db, named)
    if (data.entity === 'site') return checkSiteDuplicates(db, named)
    return checkVendorDuplicates(
      db,
      data.entity === 'subcontractor' ? 'subcontractor' : 'supplier',
      named,
    )
  })

/* ------------------------------- documents ------------------------------- */

export const uploadSubcontractorDocumentFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => documentUploadSchema.parse(input))
  .middleware([permissionMiddleware('compliance:write')])
  .handler(async ({ data, context }) => {
    const { uploadSubcontractorDocument } = await import('./documents.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => uploadSubcontractorDocument(tx, data, context.session))
  })

export const getDocumentUrlFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({ id: z.uuid() }).parse(input))
  .middleware([permissionMiddleware('compliance:read')])
  .handler(async ({ data }) => {
    const { signedDocumentUrl } = await import('./documents.server')
    const { getDb } = await import('@cls/db')
    return signedDocumentUrl(data.id, getDb())
  })

/* -------------------------------- jobs ---------------------------------- */

export const runComplianceRemindersFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => z.object({}).parse(input ?? {}))
  .middleware([permissionMiddleware('compliance:write')])
  .handler(async () => {
    const { runExpiryReminders } = await import('./reminders.server')
    const { getDb } = await import('@cls/db')
    return runExpiryReminders(getDb())
  })

export const runSageImportFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => importRunSchema.parse(input ?? {}))
  .middleware([permissionMiddleware('customer:write')])
  .handler(async ({ data, context }) => {
    const { runSageImport } = await import('./import.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => runSageImport(tx, data, context.session))
  })
