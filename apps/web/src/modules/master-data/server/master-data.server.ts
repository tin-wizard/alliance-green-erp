/**
 * Master Data queries. SERVER ONLY.
 *
 * Natural ids are Sage/legacy ids and are never generated or renumbered.
 * Customer/site joins are LEFT joins; a site without an imported billing parent
 * must still be returned, with `customerName: null` in the data layer (the UI
 * labels it explicitly).
 */
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { getDb, type Db } from '@cls/db'
import {
  customers,
  partGroups,
  partPriceHistory,
  partSellingRates,
  partSupplierRates,
  parts,
  siteWarranties,
  sites,
  subcontractorContacts,
  subcontractorDocuments,
  subcontractors,
  supplierContacts,
  suppliers,
} from '@cls/db/schema'
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
import { businessToday, validWsibDocument } from '../lib/compliance'

function like(search: string | undefined): string | undefined {
  const term = search?.trim()
  return term ? `%${term}%` : undefined
}

function pageOffset(page: number, pageSize: number): number {
  return (page - 1) * pageSize
}

/* ------------------------------ customers ------------------------------ */

export async function listCustomers(
  input: { search?: string; page: number; pageSize: number },
  db: Db = getDb(),
): Promise<PageResult<CustomerListRow>> {
  const term = like(input.search)
  const where = term
    ? or(
        ilike(customers.name, term),
        ilike(customers.city, term),
        ilike(customers.contactName, term),
        ilike(customers.contactEmail, term),
      )
    : undefined

  const rows = await db
    .select({
      id: customers.id,
      sageCustomerId: customers.sageCustomerId,
      name: customers.name,
      city: customers.city,
      province: customers.province,
      contactName: customers.contactName,
      contactEmail: customers.contactEmail,
      siteCount: sql<number>`count(${sites.id})::int`,
    })
    .from(customers)
    .leftJoin(sites, eq(sites.customerId, customers.id))
    .where(where)
    .groupBy(customers.id)
    .orderBy(sql`lower(${customers.name}) asc`, asc(customers.id))
    .limit(input.pageSize)
    .offset(pageOffset(input.page, input.pageSize))

  const [totals] = await db.select({ total: count() }).from(customers).where(where)
  return { rows, page: input.page, pageSize: input.pageSize, total: Number(totals?.total ?? 0) }
}

export async function getCustomer(id: number, db: Db = getDb()): Promise<CustomerDetail | null> {
  const [row] = await db.select().from(customers).where(eq(customers.id, id)).limit(1)
  if (!row) return null
  const customerSites = await db
    .select({
      id: sites.id,
      name: sites.name,
      street: sites.street,
      city: sites.city,
      province: sites.province,
    })
    .from(sites)
    .where(eq(sites.customerId, id))
    .orderBy(sql`lower(${sites.name}) asc`, asc(sites.id))

  return {
    id: row.id,
    sageCustomerId: row.sageCustomerId,
    name: row.name,
    street: row.street,
    city: row.city,
    province: row.province,
    postalCode: row.postalCode,
    contactName: row.contactName,
    contactNumber: row.contactNumber,
    contactEmail: row.contactEmail,
    salesperson: row.salesperson,
    isActive: row.isActive,
    sites: customerSites,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/* -------------------------------- sites -------------------------------- */

export async function listSites(
  input: {
    search?: string
    page: number
    pageSize: number
    parent?: 'all' | 'present' | 'missing'
  },
  db: Db = getDb(),
): Promise<PageResult<SiteListRow>> {
  const term = like(input.search)
  const searchWhere = term
    ? or(
        ilike(sites.name, term),
        ilike(sites.street, term),
        ilike(sites.city, term),
        ilike(customers.name, term),
      )
    : undefined
  const parentWhere: SQL | undefined =
    input.parent === 'missing'
      ? isNull(customers.id)
      : input.parent === 'present'
        ? sql`${customers.id} is not null`
        : undefined
  const where = searchWhere && parentWhere ? and(searchWhere, parentWhere) : (searchWhere ?? parentWhere)

  const rows = await db
    .select({
      id: sites.id,
      sageSiteId: sites.sageSiteId,
      name: sites.name,
      street: sites.street,
      city: sites.city,
      province: sites.province,
      customerId: sites.customerId,
      customerName: customers.name,
      warranty: sites.warranty,
      warrantyExpiresOn: sites.warrantyExpiresOn,
    })
    .from(sites)
    .leftJoin(customers, eq(sites.customerId, customers.id))
    .where(where)
    .orderBy(sql`lower(${sites.name}) asc`, asc(sites.id))
    .limit(input.pageSize)
    .offset(pageOffset(input.page, input.pageSize))

  const [totals] = await db
    .select({ total: count() })
    .from(sites)
    .leftJoin(customers, eq(sites.customerId, customers.id))
    .where(where)
  return { rows, page: input.page, pageSize: input.pageSize, total: Number(totals?.total ?? 0) }
}

export async function getSite(id: number, db: Db = getDb()): Promise<SiteDetail | null> {
  const [row] = await db
    .select({
      site: sites,
      customerName: customers.name,
    })
    .from(sites)
    .leftJoin(customers, eq(sites.customerId, customers.id))
    .where(eq(sites.id, id))
    .limit(1)
  if (!row) return null
  const warranties = await db
    .select({
      id: siteWarranties.id,
      description: siteWarranties.description,
      expiresOn: siteWarranties.expiresOn,
      documentKey: siteWarranties.documentKey,
    })
    .from(siteWarranties)
    .where(eq(siteWarranties.siteId, id))
    .orderBy(desc(siteWarranties.expiresOn))

  const site = row.site
  return {
    id: site.id,
    sageSiteId: site.sageSiteId,
    name: site.name,
    street: site.street,
    street2: site.street2,
    city: site.city,
    province: site.province,
    postalCode: site.postalCode,
    contactName: site.contactName,
    contactNumber: site.contactNumber,
    customerId: site.customerId,
    customerName: row.customerName,
    warranty: site.warranty,
    warrantyExpiresOn: site.warrantyExpiresOn,
    warrantyNotes: site.warrantyNotes,
    notes: site.notes,
    dns: site.dns,
    lift: site.lift,
    mall: site.mall,
    isActive: site.isActive,
    warranties,
    createdAt: site.createdAt.toISOString(),
    updatedAt: site.updatedAt.toISOString(),
  }
}

/* ---------------------------- subcontractors ---------------------------- */

const validDocumentExists = sql`exists (
  select 1 from app.subcontractor_documents d
  where d.subcontractor_id = ${subcontractors.id}
    and d.kind in ('wsib', 'insurance')
    and d.is_expired = false
    and d.expires_on >= current_date
)`

export async function listSubcontractors(
  input: {
    search?: string
    page: number
    pageSize: number
    wsib?: 'all' | 'valid' | 'missing'
  },
  db: Db = getDb(),
): Promise<PageResult<SubcontractorListRow>> {
  const term = like(input.search)
  const searchWhere = term
    ? or(
        ilike(subcontractors.name, term),
        ilike(subcontractors.city, term),
        ilike(subcontractors.contactEmail, term),
      )
    : undefined
  const wsibWhere: SQL | undefined =
    input.wsib === 'valid'
      ? validDocumentExists
      : input.wsib === 'missing'
        ? sql`not ${validDocumentExists}`
        : undefined
  const where =
    searchWhere && wsibWhere ? and(searchWhere, wsibWhere) : (searchWhere ?? wsibWhere)

  const rows = await db
    .select({
      id: subcontractors.id,
      sageSubcontractorId: subcontractors.sageSubcontractorId,
      name: subcontractors.name,
      city: subcontractors.city,
      province: subcontractors.province,
      contactEmail: subcontractors.contactEmail,
      isActive: subcontractors.isActive,
    })
    .from(subcontractors)
    .where(where)
    .orderBy(sql`lower(${subcontractors.name}) asc`, asc(subcontractors.id))
    .limit(input.pageSize)
    .offset(pageOffset(input.page, input.pageSize))

  const [totals] = await db.select({ total: count() }).from(subcontractors).where(where)
  const ids = rows.map((row) => row.id)
  const documents = ids.length
    ? await db
        .select({
          subcontractorId: subcontractorDocuments.subcontractorId,
          documentType: subcontractorDocuments.documentType,
          expirationDate: subcontractorDocuments.expiresOn,
          isExpired: subcontractorDocuments.isExpired,
        })
        .from(subcontractorDocuments)
        .where(
          and(
            inArray(subcontractorDocuments.subcontractorId, ids),
            inArray(subcontractorDocuments.kind, ['wsib', 'insurance']),
          ),
        )
    : []
  const today = businessToday()
  const bySub = new Map<number, typeof documents>()
  for (const document of documents) {
    const list = bySub.get(document.subcontractorId) ?? []
    list.push(document)
    bySub.set(document.subcontractorId, list)
  }

  return {
    rows: rows.map((row) => {
      const valid = validWsibDocument(
        (bySub.get(row.id) ?? []).map((document) => ({
          documentType: document.documentType,
          expirationDate: document.expirationDate,
          isExpired: document.isExpired ? 1 : 0,
        })),
        today,
      )
      return {
        ...row,
        wsibValid: valid !== null,
        wsibExpirationDate: valid?.expirationDate ?? null,
      }
    }),
    page: input.page,
    pageSize: input.pageSize,
    total: Number(totals?.total ?? 0),
  }
}

export async function getSubcontractor(
  id: number,
  db: Db = getDb(),
): Promise<SubcontractorDetail | null> {
  const [row] = await db.select().from(subcontractors).where(eq(subcontractors.id, id)).limit(1)
  if (!row) return null

  const [contacts, documents] = await Promise.all([
    db
      .select()
      .from(subcontractorContacts)
      .where(eq(subcontractorContacts.subcontractorId, id))
      .orderBy(asc(subcontractorContacts.contactName)),
    db
      .select()
      .from(subcontractorDocuments)
      .where(eq(subcontractorDocuments.subcontractorId, id))
      .orderBy(desc(subcontractorDocuments.expiresOn)),
  ])
  const valid = validWsibDocument(
    documents
      .filter((document) => document.kind !== 'other')
      .map((document) => ({
        documentType: document.documentType,
        expirationDate: document.expiresOn,
        isExpired: document.isExpired ? 1 : 0,
      })),
    businessToday(),
  )

  return {
    id: row.id,
    sageSubcontractorId: row.sageSubcontractorId,
    name: row.name,
    street: row.street,
    city: row.city,
    province: row.province,
    postalCode: row.postalCode,
    contactName: row.contactName,
    contactNumber: row.contactNumber,
    contactEmail: row.contactEmail,
    email2: row.email2,
    email3: row.email3,
    rateInterior: row.rateInterior,
    rateExterior: row.rateExterior,
    rateOther: row.rateOther,
    isActive: row.isActive,
    wsibValid: valid !== null,
    wsibExpirationDate: valid?.expirationDate ?? null,
    contacts: contacts.map((contact) => ({
      id: contact.id,
      contactName: contact.contactName,
      phone: contact.phone,
      phoneExt: contact.phoneExt,
    })),
    documents: documents.map((document) => ({
      id: document.id,
      kind: document.kind,
      documentType: document.documentType,
      documentName: document.documentName,
      fileName: document.fileName,
      storageKey: document.storageKey,
      contentType: document.contentType,
      sizeBytes: document.sizeBytes,
      checksumSha256: document.checksumSha256,
      expiresOn: document.expiresOn,
      isExpired: document.isExpired,
      supersededAt: document.supersededAt?.toISOString() ?? null,
      uploadedAt: document.uploadedAt.toISOString(),
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/* ------------------------------- suppliers ------------------------------- */

export async function listSuppliers(
  input: { search?: string; page: number; pageSize: number },
  db: Db = getDb(),
): Promise<PageResult<SupplierListRow>> {
  const term = like(input.search)
  const where = term
    ? or(
        ilike(suppliers.name, term),
        ilike(suppliers.city, term),
        ilike(suppliers.contactPerson, term),
        sql`cast(${suppliers.sageVendorId} as text) ilike ${term}`,
      )
    : undefined
  const rows = await db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      city: suppliers.city,
      province: suppliers.province,
      sageVendorId: suppliers.sageVendorId,
      bypassPoApproval: suppliers.bypassPoApproval,
      isUnderCls: suppliers.isUnderCls,
      isActive: suppliers.isActive,
    })
    .from(suppliers)
    .where(where)
    .orderBy(sql`lower(${suppliers.name}) asc`, asc(suppliers.id))
    .limit(input.pageSize)
    .offset(pageOffset(input.page, input.pageSize))
  const [totals] = await db.select({ total: count() }).from(suppliers).where(where)
  return { rows, page: input.page, pageSize: input.pageSize, total: Number(totals?.total ?? 0) }
}

export async function getSupplier(id: number, db: Db = getDb()): Promise<SupplierDetail | null> {
  const [row] = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1)
  if (!row) return null
  const contacts = await db
    .select()
    .from(supplierContacts)
    .where(eq(supplierContacts.supplierId, id))
    .orderBy(asc(supplierContacts.contactName))
  return {
    ...row,
    contacts: contacts.map((contact) => ({
      id: contact.id,
      contactName: contact.contactName,
      phone: contact.phone,
      phoneExt: contact.phoneExt,
      email: contact.email,
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  } as SupplierDetail
}

/* --------------------------------- parts --------------------------------- */

export async function listParts(
  input: { search?: string; page: number; pageSize: number },
  db: Db = getDb(),
): Promise<PageResult<PartListRow>> {
  const term = like(input.search)
  const where = term
    ? or(ilike(parts.partNumber, term), ilike(parts.name, term), ilike(partGroups.name, term))
    : undefined
  const rows = await db
    .select({
      id: parts.id,
      partNumber: parts.partNumber,
      name: parts.name,
      groupName: partGroups.name,
      sellPrice: parts.sellPrice,
      activeInSage: parts.activeInSage,
      subignore: parts.subignore,
    })
    .from(parts)
    .leftJoin(partGroups, eq(parts.partGroupId, partGroups.id))
    .where(where)
    .orderBy(sql`lower(${parts.partNumber}) asc`, asc(parts.id))
    .limit(input.pageSize)
    .offset(pageOffset(input.page, input.pageSize))
  const [totals] = await db
    .select({ total: count() })
    .from(parts)
    .leftJoin(partGroups, eq(parts.partGroupId, partGroups.id))
    .where(where)
  return { rows, page: input.page, pageSize: input.pageSize, total: Number(totals?.total ?? 0) }
}

export async function getPart(id: number, db: Db = getDb()): Promise<PartDetail | null> {
  const [row] = await db
    .select({ part: parts, groupName: partGroups.name })
    .from(parts)
    .leftJoin(partGroups, eq(parts.partGroupId, partGroups.id))
    .where(eq(parts.id, id))
    .limit(1)
  if (!row) return null
  const [supplierRates, sellingRates, history] = await Promise.all([
    db
      .select({
        id: partSupplierRates.id,
        supplierId: partSupplierRates.supplierId,
        supplierName: suppliers.name,
        costPrice: partSupplierRates.costPrice,
        sellPrice: partSupplierRates.sellPrice,
        markup: partSupplierRates.markup,
        modelNumber1: partSupplierRates.modelNumber1,
        modelNumber2: partSupplierRates.modelNumber2,
        modelNumber3: partSupplierRates.modelNumber3,
        defaultRate: partSupplierRates.defaultRate,
      })
      .from(partSupplierRates)
      .leftJoin(suppliers, eq(partSupplierRates.supplierId, suppliers.id))
      .where(eq(partSupplierRates.partId, id))
      .orderBy(desc(partSupplierRates.defaultRate), asc(partSupplierRates.supplierId)),
    db
      .select({
        id: partSellingRates.id,
        listId: partSellingRates.listId,
        sellPrice: partSellingRates.sellPrice,
        installPrice: partSellingRates.installPrice,
        recyclePrice: partSellingRates.recyclePrice,
        dateInserted: partSellingRates.dateInserted,
      })
      .from(partSellingRates)
      .where(eq(partSellingRates.partId, id))
      .orderBy(desc(partSellingRates.dateInserted))
      .limit(50),
    db
      .select({
        id: partPriceHistory.id,
        fieldName: partPriceHistory.fieldName,
        lastValue: partPriceHistory.lastValue,
        newValue: partPriceHistory.newValue,
        sectionName: partPriceHistory.sectionName,
        changedAt: partPriceHistory.changedAt,
      })
      .from(partPriceHistory)
      .where(eq(partPriceHistory.partId, id))
      .orderBy(desc(partPriceHistory.changedAt))
      .limit(50),
  ])

  const part = row.part
  return {
    id: part.id,
    partNumber: part.partNumber,
    name: part.name,
    partGroupId: part.partGroupId,
    groupName: row.groupName,
    cost: part.cost,
    sellPrice: part.sellPrice,
    sageItemId: part.sageItemId,
    activeInSage: part.activeInSage,
    subignore: part.subignore,
    parentPartNumber: part.parentPartNumber,
    clsLinkedPartCode: part.clsLinkedPartCode,
    warranty: part.warranty,
    labourWarranty: part.labourWarranty,
    installCostPerUnit: part.installCostPerUnit,
    installProfitFormula: part.installProfitFormula,
    recycleProfitFormula: part.recycleProfitFormula,
    notes: part.notes,
    supplierRates,
    sellingRates: sellingRates.map((rate) => ({
      ...rate,
      dateInserted: rate.dateInserted.toISOString(),
    })),
    priceHistory: history.map((entry) => ({
      ...entry,
      changedAt: entry.changedAt.toISOString(),
    })),
    createdAt: part.createdAt.toISOString(),
    updatedAt: part.updatedAt.toISOString(),
  }
}
