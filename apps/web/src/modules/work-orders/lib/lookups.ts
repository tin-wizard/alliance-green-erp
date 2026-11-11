/**
 * Master-data lookup adapter — the module's only dependency on master data.
 *
 * SERVER ONLY. Do not import from a component or route file.
 *
 * Work Orders does not own customers, sites, subcontractors or parts. Until the
 * Master Data module lands, this adapter reads them from the legacy `public`
 * mirror and returns module-local types. When Master Data ships, replace the
 * bodies here; no UI or server function needs to change (brief §Interim
 * dependency). Nothing in this file writes to a legacy table.
 */
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { getDb, type Executor } from '@cls/db'
import {
  legacyCustomer,
  legacyParts,
  legacySites,
  legacySubcontractor,
  legacySubcontractorWsibInsuranceDocuments,
  legacyWoCategories,
  legacyWoPriority,
  legacyWoServtype,
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
  id: legacySites.id,
  name: legacySites.name,
  street: legacySites.street,
  city: legacySites.city,
  province: legacySites.province,
  postalCode: legacySites.postalcode,
  customerId: legacySites.custid,
  customerName: legacyCustomer.name,
}

export async function searchSites(
  search: string,
  limit = 20,
  executor?: Executor,
): Promise<SiteLookupOption[]> {
  const term = `%${search.trim()}%`
  const rows = await db(executor)
    .select(siteColumns)
    .from(legacySites)
    .leftJoin(legacyCustomer, eq(legacySites.custid, legacyCustomer.id))
    .where(
      search.trim()
        ? or(
            ilike(legacySites.name, term),
            ilike(legacySites.street, term),
            ilike(legacySites.city, term),
            ilike(legacyCustomer.name, term),
          )
        : sql`true`,
    )
    .orderBy(asc(legacySites.name))
    .limit(limit)

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    street: row.street,
    city: row.city,
    province: row.province,
    postalCode: row.postalCode,
    customerId: row.customerId,
    customerName: row.customerName ?? '',
  }))
}

export async function getSite(
  id: number,
  executor?: Executor,
): Promise<SiteLookupOption | null> {
  const rows = await db(executor)
    .select(siteColumns)
    .from(legacySites)
    .leftJoin(legacyCustomer, eq(legacySites.custid, legacyCustomer.id))
    .where(eq(legacySites.id, id))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    street: row.street,
    city: row.city,
    province: row.province,
    postalCode: row.postalCode,
    customerId: row.customerId,
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
      documentType: legacySubcontractorWsibInsuranceDocuments.documentType,
      expirationDate: legacySubcontractorWsibInsuranceDocuments.expirationDate,
      isExpired: legacySubcontractorWsibInsuranceDocuments.isExpired,
    })
    .from(legacySubcontractorWsibInsuranceDocuments)
    .where(eq(legacySubcontractorWsibInsuranceDocuments.subid, subcontractorId))
    .orderBy(sql`${legacySubcontractorWsibInsuranceDocuments.expirationDate} desc`)
  return rows.map((row) => ({
    documentType: row.documentType,
    expirationDate: row.expirationDate,
    isExpired: row.isExpired,
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
      id: legacySubcontractor.id,
      name: legacySubcontractor.name,
      city: legacySubcontractor.city,
      province: legacySubcontractor.province,
      email: legacySubcontractor.cemail1,
    })
    .from(legacySubcontractor)
    .where(search.trim() ? ilike(legacySubcontractor.name, term) : sql`true`)
    .orderBy(asc(legacySubcontractor.name))
    .limit(limit)

  if (rows.length === 0) return []
  const documents = await db(executor)
    .select({
      subid: legacySubcontractorWsibInsuranceDocuments.subid,
      documentType: legacySubcontractorWsibInsuranceDocuments.documentType,
      expirationDate: legacySubcontractorWsibInsuranceDocuments.expirationDate,
      isExpired: legacySubcontractorWsibInsuranceDocuments.isExpired,
    })
    .from(legacySubcontractorWsibInsuranceDocuments)
    .where(
      inArray(
        legacySubcontractorWsibInsuranceDocuments.subid,
        rows.map((row) => row.id),
      ),
    )
  const bySub = new Map<number, WsibDocument[]>()
  for (const document of documents) {
    const list = bySub.get(document.subid) ?? []
    list.push({
      documentType: document.documentType,
      expirationDate: document.expirationDate,
      isExpired: document.isExpired,
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
      id: legacySubcontractor.id,
      name: legacySubcontractor.name,
      city: legacySubcontractor.city,
      province: legacySubcontractor.province,
      email: legacySubcontractor.cemail1,
    })
    .from(legacySubcontractor)
    .where(eq(legacySubcontractor.id, id))
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
      number: legacyParts.number,
      description: legacyParts.name,
      price: legacyParts.sellPrice,
    })
    .from(legacyParts)
    .where(
      search.trim()
        ? and(
            sql`${legacyParts.number} is not null`,
            or(ilike(legacyParts.number, term), ilike(legacyParts.name, term)),
          )
        : and(sql`${legacyParts.number} is not null`),
    )
    .orderBy(asc(legacyParts.number))
    .limit(limit)
  return rows
    .filter((row): row is typeof row & { number: string } => Boolean(row.number))
    .map<PartLookupOption>((row) => ({
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
