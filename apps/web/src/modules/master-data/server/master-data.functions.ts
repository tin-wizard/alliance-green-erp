/**
 * Master Data server functions — the module's read boundary.
 *
 * CLIENT SAFE: server-only imports happen inside handlers. Master Data has no
 * price-write path; parts and rate cards are read-only here. The only price
 * editor is the future price-management screen, which owns the global lock.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { permissionMiddleware } from '../../../server/middleware'
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

const listSchema = z.object({
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25),
})

const idSchema = z.object({ id: z.coerce.number().int().positive() })

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
