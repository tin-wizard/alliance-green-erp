import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { authMiddleware, permissionMiddleware } from '../../../server/middleware'
import type {
  QuoteCreateInput,
  QuotePackingInput,
  QuoteReviseInput,
  QuoteRejectInput,
  QuoteTransitionInput,
  QuoteUpdateInput,
} from '../types'
import {
  createQuoteSchema,
  listQuoteFiltersSchema,
  packingSlipSchema,
  quoteIdSchema,
  rejectQuoteSchema,
  reviseQuoteSchema,
  transitionQuoteSchema,
  updateQuoteSchema,
} from '../lib/validation'

export const listQuotesFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => listQuoteFiltersSchema.parse(input ?? {}))
  .middleware([permissionMiddleware('quote:read')])
  .handler(async ({ data, context }) => {
    const { queryQuotes } = await import('./list.server')
    return queryQuotes(context.session, data)
  })

export const getQuoteFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => quoteIdSchema.parse(input))
  .middleware([permissionMiddleware('quote:read')])
  .handler(async ({ data, context }) => {
    const { getQuoteDetail } = await import('./get.server')
    return getQuoteDetail(context.session, data.id)
  })

export const createQuoteFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => createQuoteSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { createQuoteCore } = await import('./create.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) =>
      createQuoteCore(tx, data as QuoteCreateInput, context.session),
    )
  })

export const updateQuoteFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => updateQuoteSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { updateQuote } = await import('./update.server')
    return updateQuote(data as QuoteUpdateInput, context.session)
  })

export const transitionQuoteFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => transitionQuoteSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { transitionQuote } = await import('./lifecycle.server')
    return transitionQuote(data as QuoteTransitionInput, context.session)
  })

export const rejectQuoteFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => rejectQuoteSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { rejectQuote } = await import('./lifecycle.server')
    return rejectQuote(data as QuoteRejectInput, context.session)
  })

export const reviseQuoteFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => reviseQuoteSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { reviseQuote } = await import('./lifecycle.server')
    return reviseQuote(data as QuoteReviseInput, context.session)
  })

export const resubmitQuoteFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => reviseQuoteSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { reviseQuote } = await import('./lifecycle.server')
    return reviseQuote({ ...(data as QuoteReviseInput), submit: true }, context.session)
  })

export const deleteQuoteFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => quoteIdSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { deleteStandaloneQuote } = await import('./lifecycle.server')
    return deleteStandaloneQuote(data.id, context.session)
  })

export const convertQuoteFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => quoteIdSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { convertQuote } = await import('./convert.server')
    return convertQuote(data.id, context.session)
  })

export const renderQuotePdfFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => quoteIdSchema.parse(input))
  .middleware([permissionMiddleware('quote:read')])
  .handler(async ({ data, context }) => {
    const { renderQuotePdf } = await import('./pdf.server')
    return renderQuotePdf(data.id, context.session)
  })

export const createPackingSlipFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => packingSlipSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }) => {
    const { createPackingSlip } = await import('./pdf.server')
    return createPackingSlip(data as QuotePackingInput, context.session)
  })

export const listQuoteDocumentsFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({ id: z.number().int().positive() }).parse(input))
  .middleware([permissionMiddleware('quote:read')])
  .handler(async ({ data, context }) => {
    const { listGeneratedDocuments } = await import('./pdf.server')
    return listGeneratedDocuments('quote', String(data.id), context.session)
  })

export const regenerateQuotePdfFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z.object({ id: z.number().int().positive(), documentId: z.string().uuid() }).parse(input),
  )
  .middleware([permissionMiddleware('quote:read')])
  .handler(async ({ data, context }) => {
    const { regenerateGeneratedDocument } = await import('./pdf.server')
    return regenerateGeneratedDocument(data.documentId, context.session)
  })
