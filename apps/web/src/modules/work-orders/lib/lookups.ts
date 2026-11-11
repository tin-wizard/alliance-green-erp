/**
 * Master-data lookup adapter — the module's only dependency on master data.
 *
 * SERVER ONLY. Do not import from a component or route file.
 *
 * Work Orders does not own customers, sites, subcontractors or parts. The
 * Master Data module owns them in the `app` schema; this adapter is the frozen
 * interface between the two modules. Types and signatures must not change
 * without a coordinated Work Orders change.
 *
 * The legacy `public` mirror is deliberately not read here. Natural ids are
 * preserved exactly (Sage ids for customers/sites, legacy ids for vendors and
 * parts), and a missing billing parent is returned as `customerName: ''`
 * rather than hidden by an inner join.
 */
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { getDb, type Executor } from '@cls/db'
import {
  customers,
  legacyWoCategories,
  legacyWoPriority,
  legacyWoServtype,
  parts,
  sites,
  subcontractorDocuments,
  subcontractors,
  users,
} from '@cls/db/schema'
import type {
  LookupOption,
  PartLookupOption,
  SiteLookupOption,
  SubcontractorLookupOption,
  TechnicianLookupOption,
} from '../types'
import { businessToday, validWsibDocument, type WsibDocument } from './rules'

function db(executor?: Executor): Executor {
  return executor ?? getDb()
}

/* ------------------------------- sites ------------------------------- */

const siteColumns = {
  id: sites.id,
  name: sites.name,
  street: sites.street,
  city: sites.city,
  province: sites.province,
  postalCode: sites.postalCode,
  customerId: sites.customerId,
  customerName: customers.name,
}

export async function searchSites(
  search: string,
  limit = 20,
  executor?: Executor,
): Promise<SiteLookupOption[]> {
  const term = `%${search.trim()}%`
  const rows = await db(executor)
    .select(siteColumns)
    .from(sites)
    .leftJoin(customers, eq(sites.customerId, customers.id))
    .where(
      search.trim()
        ? or(
            ilike(sites.name, term),
            ilike(sites.street, term),
            ilike(sites.city, term),
            ilike(customers.name, term),
          )
        : sql`true`,
    )
    .orderBy(sql`lower(${sites.name}) asc`, asc(sites.id))
    .limit(limit)

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    street: row.street ?? '',
    city: row.city ?? '',
    province: row.province ?? '',
    postalCode: row.postalCode,
    customerId: row.customerId ?? 0,
    customerName: row.customerName ?? '',
  }))
}

export async function getSite(
  id: number,
  executor?: Executor,
): Promise<SiteLookupOption | null> {
  const rows = await db(executor)
    .select(siteColumns)
    .from(sites)
    .leftJoin(customers, eq(sites.customerId, customers.id))
    .where(eq(sites.id, id))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    street: row.street ?? '',
    city: row.city ?? '',
    province: row.province ?? '',
    postalCode: row.postalCode,
    customerId: row.customerId ?? 0,
    customerName: row.customerName ?? '',
  }
}

/* --------------------------- subcontractors --------------------------- */

export async function getSubcontractorWsibDocuments(
  subcontractorId: number,
  executor?: Executor,
): Promise<WsibDocument[]> {
  const rows = await db(executor)
    .select({
      documentType: subcontractorDocuments.documentType,
      expirationDate: subcontractorDocuments.expiresOn,
      isExpired: subcontractorDocuments.isExpired,
    })
    .from(subcontractorDocuments)
    .where(
      and(
        eq(subcontractorDocuments.subcontractorId, subcontractorId),
        inArray(subcontractorDocuments.kind, ['wsib', 'insurance']),
      ),
    )
    .orderBy(sql`${subcontractorDocuments.expiresOn} desc`)
  return rows.map((row) => ({
    documentType: row.documentType,
    expirationDate: row.expirationDate,
    isExpired: row.isExpired ? 1 : 0,
  }))
}

export async function getSubcontractorWsibState(
  subcontractorId: number,
  executor?: Executor,
): Promise<{ valid: boolean; expirationDate: string | null; documentType: string | null }> {
  const documents = await getSubcontractorWsibDocuments(subcontractorId, executor)
  const valid = validWsibDocument(documents, businessToday())
  return {
    valid: valid !== null,
    expirationDate: valid?.expirationDate ?? null,
    documentType: valid?.documentType ?? null,
  }
}

export async function searchSubcontractors(
  search: string,
  limit = 20,
  executor?: Executor,
): Promise<SubcontractorLookupOption[]> {
  const term = `%${search.trim()}%`
  const rows = await db(executor)
    .select({
      id: subcontractors.id,
      name: subcontractors.name,
      city: subcontractors.city,
      province: subcontractors.province,
      email: subcontractors.contactEmail,
    })
    .from(subcontractors)
    .where(search.trim() ? ilike(subcontractors.name, term) : sql`true`)
    .orderBy(sql`lower(${subcontractors.name}) asc`, asc(subcontractors.id))
    .limit(limit)

  if (rows.length === 0) return []
  const documents = await db(executor)
    .select({
      subid: subcontractorDocuments.subcontractorId,
      documentType: subcontractorDocuments.documentType,
      expirationDate: subcontractorDocuments.expiresOn,
      isExpired: subcontractorDocuments.isExpired,
    })
    .from(subcontractorDocuments)
    .where(
      and(
        inArray(
          subcontractorDocuments.subcontractorId,
          rows.map((row) => row.id),
        ),
        inArray(subcontractorDocuments.kind, ['wsib', 'insurance']),
      ),
    )
  const bySub = new Map<number, WsibDocument[]>()
  for (const document of documents) {
    const list = bySub.get(document.subid) ?? []
    list.push({
      documentType: document.documentType,
      expirationDate: document.expirationDate,
      isExpired: document.isExpired ? 1 : 0,
    })
    bySub.set(document.subid, list)
  }
  const today = businessToday()
  return rows.map((row) => {
    const valid = validWsibDocument(bySub.get(row.id) ?? [], today)
    return {
      id: row.id,
      name: row.name,
      city: row.city ?? null,
      province: row.province ?? null,
      email: row.email ?? null,
      wsibValid: valid !== null,
      wsibExpirationDate: valid?.expirationDate ?? null,
    }
  })
}

export async function getSubcontractor(
  id: number,
  executor?: Executor,
): Promise<SubcontractorLookupOption | null> {
  const rows = await db(executor)
    .select({
      id: subcontractors.id,
      name: subcontractors.name,
      city: subcontractors.city,
      province: subcontractors.province,
      email: subcontractors.contactEmail,
    })
    .from(subcontractors)
    .where(eq(subcontractors.id, id))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  const wsib = await getSubcontractorWsibState(id, executor)
  return {
    id: row.id,
    name: row.name,
    city: row.city ?? null,
    province: row.province ?? null,
    email: row.email ?? null,
    wsibValid: wsib.valid,
    wsibExpirationDate: wsib.expirationDate,
  }
}

/* ------------------------------ lookups ------------------------------ */

export async function listServiceTypes(executor?: Executor): Promise<LookupOption[]> {
  const rows = await db(executor)
    .select({ id: legacyWoServtype.id, name: legacyWoServtype.name })
    .from(legacyWoServtype)
    .orderBy(asc(legacyWoServtype.id))
  return rows.map((row) => ({ id: row.id, label: row.name }))
}

export async function listPriorities(executor?: Executor): Promise<LookupOption[]> {
  const rows = await db(executor)
    .select({ id: legacyWoPriority.id, name: legacyWoPriority.name })
    .from(legacyWoPriority)
    .orderBy(asc(legacyWoPriority.id))
  return rows.map((row) => ({ id: row.id, label: row.name }))
}

export async function listCategories(executor?: Executor): Promise<LookupOption[]> {
  const rows = await db(executor)
    .select({
      id: legacyWoCategories.id,
      name: legacyWoCategories.name,
      code: legacyWoCategories.code,
    })
    .from(legacyWoCategories)
    .orderBy(asc(legacyWoCategories.id))
  return rows.map((row) => ({ id: row.id, label: row.name, detail: row.code }))
}

export async function partsLookup(search: string, limit = 20, executor?: Executor) {
  const term = `%${search.trim()}%`
  const rows = await db(executor)
    .select({
      number: parts.partNumber,
      description: parts.name,
      price: parts.sellPrice,
    })
    .from(parts)
    .where(
      search.trim()
        ? or(ilike(parts.partNumber, term), ilike(parts.name, term))
        : sql`true`,
    )
    .orderBy(sql`lower(${parts.partNumber}) asc`, asc(parts.id))
    .limit(limit)
  return rows.map<PartLookupOption>((row) => ({
    partNo: row.number,
    description: row.description ?? '',
    price: row.price,
  }))
}

/* ---------------------------- technicians ---------------------------- */

export async function listTechnicians(executor?: Executor): Promise<TechnicianLookupOption[]> {
  const rows = await db(executor)
    .select({ id: users.id, displayName: users.displayName, email: users.email })
    .from(users)
    .where(and(eq(users.role, 'technician'), eq(users.isEnabled, true)))
    .orderBy(asc(users.displayName))
  return rows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    email: row.email,
  }))
}

export async function userDisplayNames(
  ids: readonly string[],
  executor?: Executor,
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await db(executor)
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, [...ids]))
  return new Map(rows.map((row) => [row.id, row.displayName]))
}
