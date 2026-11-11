/**
 * Master Data writes. SERVER ONLY.
 *
 * One transaction per operation: duplicate check, row change, contacts,
 * idempotency record and audit. Prices never enter this file.
 */
import { count, eq } from 'drizzle-orm'
import { assertPermission } from '../../../server/middleware'
import { ConflictError, ForbiddenError, ValidationError } from '@cls/core'
import type { Tx } from '@cls/db'
import {
  customers,
  parts,
  quoteParts,
  sites,
  subcontractorContacts,
  subcontractors,
  supplierContacts,
  suppliers,
  workOrderParts,
} from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import type {
  CustomerCreateInput,
  CustomerUpdateInput,
  PartCreateInput,
  PartUpdateInput,
  SiteCreateInput,
  SiteUpdateInput,
  SubcontractorCreateInput,
  SubcontractorUpdateInput,
  SupplierCreateInput,
  SupplierUpdateInput,
} from '../lib/write-validation'
import { findPriceFields } from '../lib/write-validation'
import {
  checkCustomerDuplicates,
  checkPartDuplicates,
  checkSiteDuplicates,
  checkVendorDuplicates,
} from './duplicates.server'
import {
  allocateLocalId,
  auditMasterData,
  idempotencyEntityId,
  recordIdempotency,
} from './write-support.server'

export interface WriteResult {
  id: number
  isLocal: boolean
  sageLinked: boolean
}

function requireAdminOverride(
  session: AuthSessionView,
  decision: 'clear' | 'block' | 'override',
  reason: string | null | undefined,
  candidateIds: number[],
): void {
  if (decision === 'block') {
    throw new ValidationError('A likely duplicate already exists.', {
      code: 'DUPLICATE_BLOCKED',
      candidateIds,
    })
  }
  if (decision === 'override') {
    if (!reason || reason.trim().length < 10) {
      throw new ValidationError('This looks like a duplicate. An admin reason is required.', {
        code: 'DUPLICATE_OVERRIDE_REQUIRED',
        candidateIds,
      })
    }
    if (session.user.role !== 'admin') {
      throw new ForbiddenError('admin duplicate override')
    }
  }
}

function linkState(id: number, sageId: number | null): WriteResult {
  return { id, isLocal: id < 0, sageLinked: sageId !== null }
}

/* ------------------------------ customers ------------------------------ */

export async function createCustomer(
  tx: Tx,
  input: CustomerCreateInput,
  session: AuthSessionView,
): Promise<WriteResult> {
  assertPermission(session, 'customer:write')
  const replay = await idempotencyEntityId(tx, 'customer', input.idempotencyKey)
  if (replay !== null) return linkState(replay, null)

  const duplicate = await checkCustomerDuplicates(tx, input)
  requireAdminOverride(
    session,
    duplicate.decision,
    input.duplicateOverride?.reason,
    duplicate.candidateIds,
  )

  const id = await allocateLocalId(tx, 'customer')
  const [row] = await tx
    .insert(customers)
    .values({
      id,
      sageCustomerId: null,
      name: input.name,
      street: input.street,
      city: input.city,
      province: input.province,
      postalCode: input.postalCode,
      contactName: input.contactName,
      contactNumber: input.contactNumber,
      contactEmail: input.contactEmail,
      salesperson: input.salesperson,
      isActive: input.isActive,
    })
    .returning()
  if (!row) throw new ValidationError('The customer could not be created.')

  await recordIdempotency(tx, 'customer', input.idempotencyKey, id)
  await auditMasterData(tx, session, {
    action: 'masterdata.customer.create',
    entityType: 'customer',
    entityId: id,
    permission: 'customer:write',
    summary: `Created local customer ${id} (${input.name}).`,
    after: row as unknown as Record<string, unknown>,
  })
  return linkState(id, null)
}

export async function updateCustomer(
  tx: Tx,
  input: CustomerUpdateInput,
  session: AuthSessionView,
): Promise<WriteResult> {
  assertPermission(session, 'customer:write')
  const [before] = await tx.select().from(customers).where(eq(customers.id, input.id)).limit(1)
  if (!before) throw new ValidationError('Customer not found.')
  if (before.updatedAt.toISOString() !== input.updatedAt) {
    throw new ConflictError('Customer changed since you loaded it.')
  }

  const duplicate = await checkCustomerDuplicates(tx, { ...input, excludeId: input.id })
  requireAdminOverride(
    session,
    duplicate.decision,
    input.duplicateOverride?.reason,
    duplicate.candidateIds,
  )

  const [row] = await tx
    .update(customers)
    .set({
      name: input.name,
      street: input.street,
      city: input.city,
      province: input.province,
      postalCode: input.postalCode,
      contactName: input.contactName,
      contactNumber: input.contactNumber,
      contactEmail: input.contactEmail,
      salesperson: input.salesperson,
      isActive: input.isActive,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, input.id))
    .returning()
  if (!row) throw new ConflictError('Customer changed since you loaded it.')

  await auditMasterData(tx, session, {
    action: 'masterdata.customer.update',
    entityType: 'customer',
    entityId: input.id,
    permission: 'customer:write',
    summary: `Updated customer ${input.id}.`,
    before: before as unknown as Record<string, unknown>,
    after: row as unknown as Record<string, unknown>,
  })
  return linkState(row.id, row.sageCustomerId)
}

/* -------------------------------- sites -------------------------------- */

async function validateSiteParent(
  tx: Tx,
  input: { billingParent: 'existing' | 'orphan'; customerId?: number | null },
): Promise<number | null> {
  if (input.billingParent === 'orphan') return null
  if (!input.customerId) throw new ValidationError('Choose the billing customer.')
  const [parent] = await tx
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.id, input.customerId))
    .limit(1)
  if (!parent) throw new ValidationError('That billing customer does not exist.')
  return parent.id
}

export async function createSite(
  tx: Tx,
  input: SiteCreateInput,
  session: AuthSessionView,
): Promise<WriteResult> {
  assertPermission(session, 'customer:write')
  const replay = await idempotencyEntityId(tx, 'site', input.idempotencyKey)
  if (replay !== null) return linkState(replay, null)

  const customerId = await validateSiteParent(tx, input)
  const duplicate = await checkSiteDuplicates(tx, { ...input, customerId })
  requireAdminOverride(
    session,
    duplicate.decision,
    input.duplicateOverride?.reason,
    duplicate.candidateIds,
  )

  const id = await allocateLocalId(tx, 'site')
  const [row] = await tx
    .insert(sites)
    .values({
      id,
      sageSiteId: null,
      customerId,
      name: input.name,
      street: input.street,
      street2: input.street2,
      city: input.city,
      province: input.province,
      postalCode: input.postalCode,
      contactName: input.contactName,
      contactNumber: input.contactNumber,
      warranty: input.warranty,
      warrantyExpiresOn: input.warrantyExpiresOn ?? null,
      warrantyNotes: input.warrantyNotes,
      notes: input.notes,
      dns: input.dns,
      lift: input.lift,
      mall: input.mall,
      isActive: input.isActive,
    })
    .returning()
  if (!row) throw new ValidationError('The site could not be created.')

  await recordIdempotency(tx, 'site', input.idempotencyKey, id)
  await auditMasterData(tx, session, {
    action: 'masterdata.site.create',
    entityType: 'site',
    entityId: id,
    permission: 'customer:write',
    summary:
      customerId === null
        ? `Created local orphan site ${id} (${input.name}).`
        : `Created local site ${id} for customer ${customerId}.`,
    after: row as unknown as Record<string, unknown>,
  })
  return linkState(id, null)
}

export async function updateSite(
  tx: Tx,
  input: SiteUpdateInput,
  session: AuthSessionView,
): Promise<WriteResult> {
  assertPermission(session, 'customer:write')
  const [before] = await tx.select().from(sites).where(eq(sites.id, input.id)).limit(1)
  if (!before) throw new ValidationError('Site not found.')
  if (before.updatedAt.toISOString() !== input.updatedAt) {
    throw new ConflictError('Site changed since you loaded it.')
  }

  const customerId = await validateSiteParent(tx, input)
  const duplicate = await checkSiteDuplicates(tx, {
    ...input,
    customerId,
    excludeId: input.id,
  })
  requireAdminOverride(
    session,
    duplicate.decision,
    input.duplicateOverride?.reason,
    duplicate.candidateIds,
  )

  const [row] = await tx
    .update(sites)
    .set({
      customerId,
      name: input.name,
      street: input.street,
      street2: input.street2,
      city: input.city,
      province: input.province,
      postalCode: input.postalCode,
      contactName: input.contactName,
      contactNumber: input.contactNumber,
      warranty: input.warranty,
      warrantyExpiresOn: input.warrantyExpiresOn ?? null,
      warrantyNotes: input.warrantyNotes,
      notes: input.notes,
      dns: input.dns,
      lift: input.lift,
      mall: input.mall,
      isActive: input.isActive,
      updatedAt: new Date(),
    })
    .where(eq(sites.id, input.id))
    .returning()
  if (!row) throw new ConflictError('Site changed since you loaded it.')

  await auditMasterData(tx, session, {
    action: 'masterdata.site.update',
    entityType: 'site',
    entityId: input.id,
    permission: 'customer:write',
    summary: `Updated site ${input.id}.`,
    before: before as unknown as Record<string, unknown>,
    after: row as unknown as Record<string, unknown>,
  })
  return linkState(row.id, row.sageSiteId)
}

/* ---------------------------- subcontractors ---------------------------- */

export async function createSubcontractor(
  tx: Tx,
  input: SubcontractorCreateInput,
  session: AuthSessionView,
): Promise<WriteResult> {
  assertPermission(session, 'subcontractor:write')
  const replay = await idempotencyEntityId(tx, 'subcontractor', input.idempotencyKey)
  if (replay !== null) return linkState(replay, null)

  const duplicate = await checkVendorDuplicates(tx, 'subcontractor', input)
  requireAdminOverride(
    session,
    duplicate.decision,
    input.duplicateOverride?.reason,
    duplicate.candidateIds,
  )

  const id = await allocateLocalId(tx, 'subcontractor')
  const [row] = await tx
    .insert(subcontractors)
    .values({
      id,
      sageSubcontractorId: null,
      name: input.name,
      street: input.street,
      city: input.city,
      province: input.province,
      postalCode: input.postalCode,
      contactName: input.contactName,
      contactNumber: input.contactNumber,
      contactEmail: input.contactEmail,
      email2: input.email2,
      email3: input.email3,
      rateInterior: input.rateInterior,
      rateExterior: input.rateExterior,
      rateOther: input.rateOther,
      isActive: input.isActive,
    })
    .returning()
  if (!row) throw new ValidationError('The subcontractor could not be created.')

  if (input.contacts.length > 0) {
    await tx.insert(subcontractorContacts).values(
      input.contacts.map((contact) => ({
        subcontractorId: id,
        contactName: contact.contactName,
        phone: contact.phone,
        phoneExt: contact.phoneExt,
      })),
    )
  }

  await recordIdempotency(tx, 'subcontractor', input.idempotencyKey, id)
  await auditMasterData(tx, session, {
    action: 'masterdata.subcontractor.create',
    entityType: 'subcontractor',
    entityId: id,
    permission: 'subcontractor:write',
    summary: `Created local subcontractor ${id} (${input.name}).`,
    after: row as unknown as Record<string, unknown>,
  })
  return linkState(id, null)
}

export async function updateSubcontractor(
  tx: Tx,
  input: SubcontractorUpdateInput,
  session: AuthSessionView,
): Promise<WriteResult> {
  assertPermission(session, 'subcontractor:write')
  const [before] = await tx
    .select()
    .from(subcontractors)
    .where(eq(subcontractors.id, input.id))
    .limit(1)
  if (!before) throw new ValidationError('Subcontractor not found.')
  if (before.updatedAt.toISOString() !== input.updatedAt) {
    throw new ConflictError('Subcontractor changed since you loaded it.')
  }

  const duplicate = await checkVendorDuplicates(tx, 'subcontractor', {
    ...input,
    excludeId: input.id,
  })
  requireAdminOverride(
    session,
    duplicate.decision,
    input.duplicateOverride?.reason,
    duplicate.candidateIds,
  )

  const [row] = await tx
    .update(subcontractors)
    .set({
      name: input.name,
      street: input.street,
      city: input.city,
      province: input.province,
      postalCode: input.postalCode,
      contactName: input.contactName,
      contactNumber: input.contactNumber,
      contactEmail: input.contactEmail,
      email2: input.email2,
      email3: input.email3,
      rateInterior: input.rateInterior,
      rateExterior: input.rateExterior,
      rateOther: input.rateOther,
      isActive: input.isActive,
      updatedAt: new Date(),
    })
    .where(eq(subcontractors.id, input.id))
    .returning()
  if (!row) throw new ConflictError('Subcontractor changed since you loaded it.')

  await tx
    .delete(subcontractorContacts)
    .where(eq(subcontractorContacts.subcontractorId, input.id))
  if (input.contacts.length > 0) {
    await tx.insert(subcontractorContacts).values(
      input.contacts.map((contact) => ({
        subcontractorId: input.id,
        contactName: contact.contactName,
        phone: contact.phone,
        phoneExt: contact.phoneExt,
      })),
    )
  }

  await auditMasterData(tx, session, {
    action: 'masterdata.subcontractor.update',
    entityType: 'subcontractor',
    entityId: input.id,
    permission: 'subcontractor:write',
    summary: `Updated subcontractor ${input.id}.`,
    before: before as unknown as Record<string, unknown>,
    after: row as unknown as Record<string, unknown>,
  })
  return linkState(row.id, row.sageSubcontractorId)
}

/* ------------------------------- suppliers ------------------------------- */

export async function createSupplier(
  tx: Tx,
  input: SupplierCreateInput,
  session: AuthSessionView,
): Promise<WriteResult> {
  assertPermission(session, 'supplier:write')
  const replay = await idempotencyEntityId(tx, 'supplier', input.idempotencyKey)
  if (replay !== null) return linkState(replay, null)

  const duplicate = await checkVendorDuplicates(tx, 'supplier', input)
  requireAdminOverride(
    session,
    duplicate.decision,
    input.duplicateOverride?.reason,
    duplicate.candidateIds,
  )

  const id = await allocateLocalId(tx, 'supplier')
  const [row] = await tx
    .insert(suppliers)
    .values({
      id,
      sageVendorId: null,
      name: input.name,
      address: input.address,
      city: input.city,
      province: input.province,
      postalCode: input.postalCode,
      contactPerson: input.contactPerson,
      contactNumber: input.contactNumber,
      additionalEmails: input.additionalEmails,
      additionalEmailsAccounting: input.additionalEmailsAccounting,
      isUnderCls: input.isUnderCls,
      isOnlineVendor: input.isOnlineVendor,
      bypassPoApproval: input.bypassPoApproval,
      poNotes: input.poNotes,
      isActive: input.isActive,
    })
    .returning()
  if (!row) throw new ValidationError('The supplier could not be created.')

  if (input.contacts.length > 0) {
    await tx.insert(supplierContacts).values(
      input.contacts.map((contact) => ({
        supplierId: id,
        contactName: contact.contactName,
        phone: contact.phone,
        phoneExt: contact.phoneExt,
        email: contact.email,
      })),
    )
  }

  await recordIdempotency(tx, 'supplier', input.idempotencyKey, id)
  await auditMasterData(tx, session, {
    action: 'masterdata.supplier.create',
    entityType: 'supplier',
    entityId: id,
    permission: 'supplier:write',
    summary: `Created local supplier ${id} (${input.name}).`,
    after: row as unknown as Record<string, unknown>,
  })
  return linkState(id, null)
}

export async function updateSupplier(
  tx: Tx,
  input: SupplierUpdateInput,
  session: AuthSessionView,
): Promise<WriteResult> {
  assertPermission(session, 'supplier:write')
  const [before] = await tx.select().from(suppliers).where(eq(suppliers.id, input.id)).limit(1)
  if (!before) throw new ValidationError('Supplier not found.')
  if (before.updatedAt.toISOString() !== input.updatedAt) {
    throw new ConflictError('Supplier changed since you loaded it.')
  }

  const duplicate = await checkVendorDuplicates(tx, 'supplier', {
    ...input,
    excludeId: input.id,
  })
  requireAdminOverride(
    session,
    duplicate.decision,
    input.duplicateOverride?.reason,
    duplicate.candidateIds,
  )

  const [row] = await tx
    .update(suppliers)
    .set({
      name: input.name,
      address: input.address,
      city: input.city,
      province: input.province,
      postalCode: input.postalCode,
      contactPerson: input.contactPerson,
      contactNumber: input.contactNumber,
      additionalEmails: input.additionalEmails,
      additionalEmailsAccounting: input.additionalEmailsAccounting,
      isUnderCls: input.isUnderCls,
      isOnlineVendor: input.isOnlineVendor,
      bypassPoApproval: input.bypassPoApproval,
      poNotes: input.poNotes,
      isActive: input.isActive,
      updatedAt: new Date(),
    })
    .where(eq(suppliers.id, input.id))
    .returning()
  if (!row) throw new ConflictError('Supplier changed since you loaded it.')

  await tx.delete(supplierContacts).where(eq(supplierContacts.supplierId, input.id))
  if (input.contacts.length > 0) {
    await tx.insert(supplierContacts).values(
      input.contacts.map((contact) => ({
        supplierId: input.id,
        contactName: contact.contactName,
        phone: contact.phone,
        phoneExt: contact.phoneExt,
        email: contact.email,
      })),
    )
  }

  await auditMasterData(tx, session, {
    action: 'masterdata.supplier.update',
    entityType: 'supplier',
    entityId: input.id,
    permission: 'supplier:write',
    summary: `Updated supplier ${input.id}.`,
    before: before as unknown as Record<string, unknown>,
    after: row as unknown as Record<string, unknown>,
  })
  return linkState(row.id, row.sageVendorId)
}

/* --------------------------------- parts --------------------------------- */

export function rejectPriceFields(input: unknown): void {
  const fields = findPriceFields(input)
  if (fields.length > 0) {
    throw new ValidationError(
      'Prices and rate cards cannot be written from Master Data.',
      { code: 'PRICE_FIELD_NOT_WRITABLE', fields },
    )
  }
}

export async function createPart(
  tx: Tx,
  input: PartCreateInput,
  session: AuthSessionView,
): Promise<WriteResult> {
  assertPermission(session, 'inventory:write')
  rejectPriceFields(input)
  const replay = await idempotencyEntityId(tx, 'part', input.idempotencyKey)
  if (replay !== null) return linkState(replay, null)

  const duplicate = await checkPartDuplicates(tx, input)
  requireAdminOverride(
    session,
    duplicate.decision,
    input.duplicateOverride?.reason,
    duplicate.candidateIds,
  )

  const id = await allocateLocalId(tx, 'part')
  const [row] = await tx
    .insert(parts)
    .values({
      id,
      partNumber: input.partNumber,
      name: input.name,
      partGroupId: input.partGroupId,
      sageItemId: null,
      activeInSage: false,
      subignore: input.subignore,
      parentPartNumber: input.parentPartNumber,
      clsLinkedPartCode: input.clsLinkedPartCode,
      warranty: input.warranty,
      labourWarranty: input.labourWarranty,
      installProfitFormula: input.installProfitFormula,
      recycleProfitFormula: input.recycleProfitFormula,
      notes: input.notes,
    })
    .returning()
  if (!row) throw new ValidationError('The part could not be created.')

  await recordIdempotency(tx, 'part', input.idempotencyKey, id)
  await auditMasterData(tx, session, {
    action: 'masterdata.part.create',
    entityType: 'part',
    entityId: id,
    permission: 'inventory:write',
    summary: `Created local part ${input.partNumber} (${id}).`,
    after: row as unknown as Record<string, unknown>,
  })
  return linkState(id, null)
}

async function assertPartNumberChangeable(
  tx: Tx,
  id: number,
  beforeNumber: string,
  nextNumber: string,
  sageItemId: number | null,
): Promise<void> {
  if (beforeNumber === nextNumber) return
  if (id > 0 || sageItemId !== null) {
    throw new ValidationError('The part number is immutable for an imported part.')
  }
  const [woRefs] = await tx
    .select({ total: count() })
    .from(workOrderParts)
    .where(eq(workOrderParts.partNo, beforeNumber))
  const [quoteRefs] = await tx
    .select({ total: count() })
    .from(quoteParts)
    .where(eq(quoteParts.partNo, beforeNumber))
  if (Number(woRefs?.total ?? 0) + Number(quoteRefs?.total ?? 0) > 0) {
    throw new ValidationError('The part number is referenced by a work order or quote.')
  }
}

export async function updatePart(
  tx: Tx,
  input: PartUpdateInput,
  session: AuthSessionView,
): Promise<WriteResult> {
  assertPermission(session, 'inventory:write')
  rejectPriceFields(input)
  const [before] = await tx.select().from(parts).where(eq(parts.id, input.id)).limit(1)
  if (!before) throw new ValidationError('Part not found.')
  if (before.updatedAt.toISOString() !== input.updatedAt) {
    throw new ConflictError('Part changed since you loaded it.')
  }
  await assertPartNumberChangeable(
    tx,
    input.id,
    before.partNumber,
    input.partNumber,
    before.sageItemId,
  )

  const duplicate = await checkPartDuplicates(tx, { ...input, excludeId: input.id })
  requireAdminOverride(
    session,
    duplicate.decision,
    input.duplicateOverride?.reason,
    duplicate.candidateIds,
  )

  const [row] = await tx
    .update(parts)
    .set({
      partNumber: input.partNumber,
      name: input.name,
      partGroupId: input.partGroupId,
      subignore: input.subignore,
      parentPartNumber: input.parentPartNumber,
      clsLinkedPartCode: input.clsLinkedPartCode,
      warranty: input.warranty,
      labourWarranty: input.labourWarranty,
      installProfitFormula: input.installProfitFormula,
      recycleProfitFormula: input.recycleProfitFormula,
      notes: input.notes,
      updatedAt: new Date(),
    })
    .where(eq(parts.id, input.id))
    .returning()
  if (!row) throw new ConflictError('Part changed since you loaded it.')

  await auditMasterData(tx, session, {
    action: 'masterdata.part.update',
    entityType: 'part',
    entityId: input.id,
    permission: 'inventory:write',
    summary: `Updated part ${input.partNumber}. Prices were not part of this change.`,
    before: before as unknown as Record<string, unknown>,
    after: row as unknown as Record<string, unknown>,
  })
  return linkState(row.id, row.sageItemId)
}
