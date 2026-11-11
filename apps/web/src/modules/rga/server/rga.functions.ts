import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authMiddleware, permissionMiddleware } from '../../../server/middleware'
import {
  approveRgaSchema,
  createRgaSchema,
  createWarrantySchema,
  listRgaSchema,
  listWarrantySchema,
  queueRgaNotificationSchema,
  recordRgaCreditSchema,
  rgaIdSchema,
  transitionRgaSchema,
  updateRgaSchema,
} from '../lib/validation'

export const listRgasFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => listRgaSchema.parse(input ?? {}))
  .middleware([permissionMiddleware('rga:read')])
  .handler(async ({ data, context }) => {
    const { listRgas } = await import('./get.server')
    const { getDb } = await import('@cls/db')
    return listRgas(context.session, data, getDb())
  })

export const getRgaFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => rgaIdSchema.parse(input))
  .middleware([permissionMiddleware('rga:read')])
  .handler(async ({ data, context }) => {
    const { getRgaDetail } = await import('./get.server')
    const { getDb } = await import('@cls/db')
    return getRgaDetail(context.session, data.rgaId, getDb())
  })

export const getRgaFormOptionsFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({ search: z.string().optional() }).parse(input ?? {}))
  .middleware([permissionMiddleware('rga:read')])
  .handler(async ({ data, context }) => {
    const { getRgaFormOptions } = await import('./options.server')
    const { getDb } = await import('@cls/db')
    return getRgaFormOptions(context.session, data, getDb())
  })

export const createRgaFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => createRgaSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { createRgaCore } = await import('./save.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => createRgaCore(tx, data, context.session))
  })

export const saveRgaFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => updateRgaSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { saveRgaCore } = await import('./save.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => saveRgaCore(tx, data, context.session))
  })

export const approveRgaFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => approveRgaSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { approveRgaCore } = await import('./transitions.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => approveRgaCore(tx, data, context.session))
  })

export const transitionRgaFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => transitionRgaSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { transitionRgaCore } = await import('./transitions.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => transitionRgaCore(tx, data, context.session))
  })

export const recordRgaCreditFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => recordRgaCreditSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { recordRgaCreditCore } = await import('./credit.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => recordRgaCreditCore(tx, data, context.session))
  })

export const queueRgaReminderFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => queueRgaNotificationSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { queueRgaReminderCore } = await import('./notifications.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => queueRgaReminderCore(tx, data, context.session))
  })

export const renderRgaPdfFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => rgaIdSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { renderRgaPdf } = await import('./pdf.server')
    const { getDb } = await import('@cls/db')
    return renderRgaPdf(data.rgaId, context.session, getDb())
  })

export const listRgaDocumentsFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => rgaIdSchema.parse(input))
  .middleware([permissionMiddleware('rga:read')])
  .handler(async ({ data, context }) => {
    const { listRgaDocuments } = await import('./pdf.server')
    const { getDb } = await import('@cls/db')
    return listRgaDocuments(data.rgaId, context.session, getDb())
  })

export const listWarrantiesFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => listWarrantySchema.parse(input ?? {}))
  .middleware([permissionMiddleware('rga:read')])
  .handler(async ({ data, context }) => {
    const { listSiteWarranties } = await import('./warranty.server')
    const { getDb } = await import('@cls/db')
    return listSiteWarranties(context.session, data, getDb())
  })

export const listSiteWarrantiesFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({ siteId: z.number().int().positive() }).parse(input))
  .middleware([permissionMiddleware('rga:read')])
  .handler(async ({ data, context }) => {
    const { listSiteWarrantiesForSite } = await import('./warranty.server')
    const { getDb } = await import('@cls/db')
    return listSiteWarrantiesForSite(context.session, data.siteId, getDb())
  })

export const warrantySummaryFn = createServerFn({ method: 'GET' })
  .middleware([permissionMiddleware('rga:read')])
  .handler(async ({ context }) => {
    const { warrantySummary } = await import('./warranty.server')
    const { getDb } = await import('@cls/db')
    return warrantySummary(context.session, getDb())
  })

export const createWarrantyFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => createWarrantySchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { createSiteWarrantyCore } = await import('./warranty.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => createSiteWarrantyCore(tx, data, context.session))
  })
