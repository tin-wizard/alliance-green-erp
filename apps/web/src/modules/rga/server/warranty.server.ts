/**
 * Site warranty records. A warranty is evidence attached to a site and,
 * optionally, the work order that created it. Expiry is projected here so
 * every screen shows the same answer.
 */
import { and, asc, eq, gt, gte, ilike, lt, lte, sql, type SQL } from 'drizzle-orm'
import { NotFoundError, ValidationError } from '@cls/core'
import { writeAudit } from '@cls/auth'
import type { Executor, Tx } from '@cls/db'
import { siteWarranties, sites, workOrders } from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import { assertRgaRead, assertRgaWrite } from './access.server'
import type { CreateWarrantyInput } from '../lib/validation'

const EXPIRING_DAYS = 30

function daysUntil(expiresOn: string, today: string): number {
  const a = Date.parse(`${expiresOn}T00:00:00Z`)
  const b = Date.parse(`${today}T00:00:00Z`)
  return Math.round((a - b) / 86_400_000)
}

function warrantyState(expiresOn: string, today: string): 'expired' | 'expiring' | 'active' {
  const days = daysUntil(expiresOn, today)
  if (days < 0) return 'expired'
  if (days <= EXPIRING_DAYS) return 'expiring'
  return 'active'
}

export async function listSiteWarranties(
  session: AuthSessionView,
  filters: { filter?: 'all' | 'expiring' | 'expired' | 'active'; search?: string },
  executor: Executor,
) {
  assertRgaRead(session)
  const today = new Date().toISOString().slice(0, 10)
  const conditions: SQL[] = []
  const term = (filters.search ?? '').trim()
  if (term) conditions.push(ilike(sites.name, `%${term}%`))
  const filter = filters.filter ?? 'all'
  if (filter === 'expired') conditions.push(lt(siteWarranties.expiresOn, today))
  if (filter === 'expiring') {
    conditions.push(gte(siteWarranties.expiresOn, today))
    conditions.push(
      lte(siteWarranties.expiresOn, sql<string>`${today}::date + interval '30 days'`),
    )
  }
  if (filter === 'active') {
    conditions.push(gt(siteWarranties.expiresOn, sql<string>`${today}::date + interval '30 days'`))
  }

  const rows = await executor
    .select({
      id: siteWarranties.id,
      siteId: siteWarranties.siteId,
      siteName: sites.name,
      siteCity: sites.city,
      siteProvince: sites.province,
      description: siteWarranties.description,
      expiresOn: siteWarranties.expiresOn,
      documentKey: siteWarranties.documentKey,
      workOrderId: siteWarranties.workOrderId,
      workOrderNumber: workOrders.id,
      createdAt: siteWarranties.createdAt,
    })
    .from(siteWarranties)
    .innerJoin(sites, eq(sites.id, siteWarranties.siteId))
    .leftJoin(workOrders, eq(workOrders.id, siteWarranties.workOrderId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(siteWarranties.expiresOn))

  const projected = rows.map((row) => ({
    ...row,
    expiresOn: row.expiresOn ?? '',
    state: row.expiresOn ? warrantyState(row.expiresOn, today) : ('active' as const),
    daysRemaining: row.expiresOn ? daysUntil(row.expiresOn, today) : null,
    createdAt: row.createdAt.toISOString(),
  }))

  return projected
}

export async function listSiteWarrantiesForSite(
  session: AuthSessionView,
  siteId: number,
  executor: Executor,
) {
  const rows = await listSiteWarranties(session, {}, executor)
  return rows.filter((row) => row.siteId === siteId)
}

export async function createSiteWarrantyCore(
  tx: Tx,
  input: CreateWarrantyInput,
  session: AuthSessionView,
) {
  assertRgaWrite(session)
  const [site] = await tx
    .select({ id: sites.id, name: sites.name })
    .from(sites)
    .where(eq(sites.id, input.siteId))
    .limit(1)
  if (!site) throw new NotFoundError('Site')

  if (input.workOrderId) {
    const [wo] = await tx
      .select({ id: workOrders.id, siteId: workOrders.siteId })
      .from(workOrders)
      .where(eq(workOrders.id, input.workOrderId))
      .limit(1)
    if (!wo) throw new NotFoundError('Work order')
    if (wo.siteId !== input.siteId) {
      throw new ValidationError('The work order belongs to a different site.')
    }
  }

  const [row] = await tx
    .insert(siteWarranties)
    .values({
      siteId: input.siteId,
      description: input.description,
      expiresOn: input.expiresOn,
      documentKey: input.documentKey ?? null,
      workOrderId: input.workOrderId ?? null,
      createdBy: session.user.id,
    })
    .returning()
  if (!row) throw new ValidationError('The warranty could not be recorded.')

  await writeAudit(tx, {
    action: 'site_warranty.create',
    actorUserId: session.user.id,
    actorLabel: session.user.email,
    actorRole: session.user.role,
    entityType: 'site_warranty',
    entityId: row.id,
    summary: `Recorded a warranty for ${site.name} expiring ${input.expiresOn}.`,
    after: {
      siteId: row.siteId,
      workOrderId: row.workOrderId,
      expiresOn: row.expiresOn,
      description: row.description,
    },
  })

  return { ...row, state: warrantyState(input.expiresOn, new Date().toISOString().slice(0, 10)) }
}

/** Global expiry counters for the dashboard and the site screen. */
export async function warrantySummary(session: AuthSessionView, executor: Executor) {
  assertRgaRead(session)
  const today = new Date().toISOString().slice(0, 10)
  const [row] = await executor
    .select({
      total: sql<number>`count(*)::int`,
      expired: sql<number>`count(*) filter (where ${siteWarranties.expiresOn} < ${today}::date)::int`,
      expiring: sql<number>`count(*) filter (where ${siteWarranties.expiresOn} >= ${today}::date and ${siteWarranties.expiresOn} <= ${today}::date + interval '30 days')::int`,
    })
    .from(siteWarranties)
  return row ?? { total: 0, expired: 0, expiring: 0 }
}
