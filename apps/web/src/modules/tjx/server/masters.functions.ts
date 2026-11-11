import { createServerFn } from '@tanstack/react-start'
import { permissionMiddleware } from '../../../server/middleware'
import {
  fixtureIdSchema,
  listFixtureSchema,
  listRoomSchema,
  listTemplateSchema,
  partSearchSchema,
  saveFixtureSchema,
  saveRoomSchema,
  saveTemplateSchema,
  setFixtureActiveSchema,
  setRoomActiveSchema,
  templateIdSchema,
} from '../lib/masters.validation'

export const listTjxRoomsFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => listRoomSchema.parse(input ?? {}))
  .middleware([permissionMiddleware('tjx:read')])
  .handler(async ({ data }) => {
    const { listRooms } = await import('./masters.server')
    const { getDb } = await import('@cls/db')
    return listRooms(getDb(), data)
  })

export const saveTjxRoomFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => saveRoomSchema.parse(input))
  .middleware([permissionMiddleware('tjx:write')])
  .handler(async ({ data, context }) => {
    const { saveRoomCore } = await import('./masters.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => saveRoomCore(tx, data, context.session))
  })

export const setTjxRoomActiveFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => setRoomActiveSchema.parse(input))
  .middleware([permissionMiddleware('tjx:write')])
  .handler(async ({ data, context }) => {
    const { setRoomActiveCore } = await import('./masters.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => setRoomActiveCore(tx, data, context.session))
  })

export const listTjxTemplatesFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => listTemplateSchema.parse(input ?? {}))
  .middleware([permissionMiddleware('tjx:read')])
  .handler(async ({ data }) => {
    const { listTemplates } = await import('./templates.server')
    const { getDb } = await import('@cls/db')
    return listTemplates(getDb(), data)
  })

export const getTjxTemplateFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => templateIdSchema.parse(input))
  .middleware([permissionMiddleware('tjx:read')])
  .handler(async ({ data }) => {
    const { getTemplate } = await import('./templates.server')
    const { getDb } = await import('@cls/db')
    return getTemplate(getDb(), data.id)
  })

export const saveTjxTemplateFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => saveTemplateSchema.parse(input))
  .middleware([permissionMiddleware('tjx:write')])
  .handler(async ({ data, context }) => {
    const { saveTemplateCore } = await import('./templates.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => saveTemplateCore(tx, data, context.session))
  })

export const setDefaultTjxTemplateFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => templateIdSchema.parse(input))
  .middleware([permissionMiddleware('tjx:write')])
  .handler(async ({ data, context }) => {
    const { setDefaultTemplateCore } = await import('./templates.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => setDefaultTemplateCore(tx, data.id, context.session))
  })

export const deleteTjxTemplateFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => templateIdSchema.parse(input))
  .middleware([permissionMiddleware('tjx:write')])
  .handler(async ({ data, context }) => {
    const { deleteTemplateCore } = await import('./templates.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => deleteTemplateCore(tx, data.id, context.session))
  })

export const listTjxFixturesFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => listFixtureSchema.parse(input ?? {}))
  .middleware([permissionMiddleware('tjx:read')])
  .handler(async ({ data }) => {
    const { listFixtures } = await import('./masters.server')
    const { getDb } = await import('@cls/db')
    return listFixtures(getDb(), data)
  })

export const getTjxFixtureFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => fixtureIdSchema.parse(input))
  .middleware([permissionMiddleware('tjx:read')])
  .handler(async ({ data }) => {
    const { getFixture } = await import('./masters.server')
    const { getDb } = await import('@cls/db')
    return getFixture(getDb(), data.id)
  })

export const saveTjxFixtureFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => saveFixtureSchema.parse(input))
  .middleware([permissionMiddleware('tjx:write')])
  .handler(async ({ data, context }) => {
    const { saveFixtureCore } = await import('./masters.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => saveFixtureCore(tx, data, context.session))
  })

export const setTjxFixtureActiveFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => setFixtureActiveSchema.parse(input))
  .middleware([permissionMiddleware('tjx:write')])
  .handler(async ({ data, context }) => {
    const { setFixtureActiveCore } = await import('./masters.server')
    const { getDb } = await import('@cls/db')
    return getDb().transaction((tx) => setFixtureActiveCore(tx, data, context.session))
  })

export const searchTjxPartsFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => partSearchSchema.parse(input ?? {}))
  .middleware([permissionMiddleware('tjx:read')])
  .handler(async ({ data }) => {
    const { searchParts } = await import('./masters.server')
    const { getDb } = await import('@cls/db')
    return searchParts(getDb(), data)
  })

export const listTjxSubcontractorOptionsFn = createServerFn({ method: 'GET' })
  .middleware([permissionMiddleware('tjx:read')])
  .handler(async () => {
    const { listSubcontractorOptions } = await import('./masters.server')
    const { getDb } = await import('@cls/db')
    return listSubcontractorOptions(getDb())
  })
