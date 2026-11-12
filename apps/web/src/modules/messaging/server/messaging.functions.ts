import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getDb } from '@cls/db'
import { permissionMiddleware } from '../../../server/middleware'

const threadId = z.uuid()

export const listThreadsFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({}).parse(input ?? {}))
  .middleware([permissionMiddleware('messages:read')])
  .handler(async ({ context }) => {
    const { listThreads } = await import('./messaging.server')
    return listThreads(context.session, getDb())
  })

export const getThreadFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({ id: threadId }).parse(input))
  .middleware([permissionMiddleware('messages:read')])
  .handler(async ({ data, context }) => {
    const { getThread } = await import('./messaging.server')
    return getThread(data.id, context.session)
  })

export const createThreadFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z
      .object({
        subject: z.string().trim().min(1).max(200),
        body: z.string().trim().min(1).max(20_000),
        participantIds: z.array(z.uuid()).min(1).max(50),
      })
      .parse(input),
  )
  .middleware([permissionMiddleware('messages:write')])
  .handler(async ({ data, context }) => {
    const { createThreadCore } = await import('./messaging.server')
    return getDb().transaction((tx) => createThreadCore(tx, data, context.session))
  })

export const replyThreadFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) =>
    z.object({ id: threadId, body: z.string().trim().min(1).max(20_000) }).parse(input),
  )
  .middleware([permissionMiddleware('messages:write')])
  .handler(async ({ data, context }) => {
    const { replyThreadCore } = await import('./messaging.server')
    return getDb().transaction((tx) =>
      replyThreadCore(tx, { threadId: data.id, body: data.body }, context.session),
    )
  })

export const markThreadReadFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => z.object({ id: threadId }).parse(input))
  .middleware([permissionMiddleware('messages:read')])
  .handler(async ({ data, context }) => {
    const { markThreadReadCore } = await import('./messaging.server')
    await getDb().transaction((tx) => markThreadReadCore(tx, data.id, context.session))
    return { ok: true }
  })

export const listMessageUsersFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => z.object({}).parse(input ?? {}))
  .middleware([permissionMiddleware('messages:read')])
  .handler(async ({ context }) => {
    const { listMessageUsers } = await import('./messaging.server')
    return listMessageUsers(context.session, getDb())
  })

export const listNotificationsFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) =>
    z
      .object({
        status: z.string().optional(),
        kind: z.string().optional(),
        search: z.string().trim().max(120).optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(200).optional(),
      })
      .parse(input ?? {}),
  )
  .middleware([permissionMiddleware('messages:read')])
  .handler(async ({ data, context }) => {
    const { listNotifications } = await import('./messaging.server')
    return listNotifications(context.session, data)
  })

export const markNotificationReadFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => z.object({ id: z.uuid() }).parse(input))
  .middleware([permissionMiddleware('messages:read')])
  .handler(async ({ data, context }) => {
    const { markNotificationReadCore } = await import('./messaging.server')
    await getDb().transaction((tx) => markNotificationReadCore(tx, data.id, context.session))
    return { ok: true }
  })

export const listOutboxFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) =>
    z
      .object({
        status: z.string().optional(),
        kind: z.string().optional(),
        search: z.string().trim().max(120).optional(),
      })
      .parse(input ?? {}),
  )
  .middleware([permissionMiddleware('messages:admin')])
  .handler(async ({ data, context }) => {
    const { listOutbox } = await import('./messaging.server')
    return listOutbox(context.session, data)
  })

export const retryNotificationFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => z.object({ id: z.uuid() }).parse(input))
  .middleware([permissionMiddleware('messages:admin')])
  .handler(async ({ data, context }) => {
    const { retryNotificationCore } = await import('./messaging.server')
    await getDb().transaction((tx) => retryNotificationCore(tx, data.id, context.session))
    return { ok: true }
  })
