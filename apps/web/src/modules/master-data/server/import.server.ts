/**
 * Sage re-import: dry-run diff and reviewed apply. SERVER ONLY.
 *
 * Source is the read-only legacy/Sage mirror. Matching is by explicit Sage link
 * first, then a unique business-key candidate for local drafts. Field ownership
 * is enforced: Sage-owned fields set, seed fields apply only when untouched since
 * the previous import, local-only fields never move. Nothing is deleted and no
 * id is renumbered.
 */
import { and, eq, ilike, isNull, sql } from 'drizzle-orm'
import { ValidationError } from '@cls/core'
import type { Tx } from '@cls/db'
import {
  customers,
  importConflicts,
  importState,
  parts,
  sites,
  subcontractors,
  suppliers,
} from '@cls/db/schema'
import {
  legacyCustomer,
  legacyParts,
  legacySites,
  legacySubcontractor,
  legacySuppliers,
} from '@cls/db/schema'
import type { AuthSessionView } from '../../../server/auth.types'
import { auditMasterData } from './write-support.server'

export type ImportEntity = 'customers' | 'sites' | 'subcontractors' | 'suppliers' | 'parts'

export type ImportAction = 'create' | 'link' | 'update' | 'unchanged' | 'conflict'

export interface ImportEvent {
  entity: ImportEntity
  sageId: number
  localId: number | null
  action: ImportAction
  fields: string[]
}

export interface ImportEntitySummary {
  entity: ImportEntity
  source: number
  create: number
  link: number
  update: number
  unchanged: number
  conflicts: number
  missing: number
}

export interface ImportResult {
  applied: boolean
  summaries: ImportEntitySummary[]
  events: ImportEvent[]
  conflicts: Array<{ entity: ImportEntity; localId: number; sageId: number; field: string }>
  missing: Array<{ entity: ImportEntity; localId: number }>
}

const ALL_ENTITIES: ImportEntity[] = [
  'customers',
  'sites',
  'subcontractors',
  'suppliers',
  'parts',
]

function emptySummary(entity: ImportEntity): ImportEntitySummary {
  return {
    entity,
    source: 0,
    create: 0,
    link: 0,
    update: 0,
    unchanged: 0,
    conflicts: 0,
    missing: 0,
  }
}

function blank(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}

function same(left: unknown, right: unknown): boolean {
  if (blank(left) && blank(right)) return true
  return String(left ?? '') === String(right ?? '')
}

interface FieldConflict {
  field: string
  sageValue: string | null
  localValue: string | null
}

/**
 * `lastSnapshot` is what the previous import wrote. A local field that still
 * equals it is safe to refresh; anything else is an operator edit and becomes a
 * conflict that keeps the local value.
 */
function decideFields<T extends Record<string, unknown>>(
  source: Record<string, unknown>,
  local: T,
  lastSnapshot: Record<string, unknown> | null,
  fields: string[],
): { updates: Record<string, unknown>; conflicts: FieldConflict[] } {
  const updates: Record<string, unknown> = {}
  const conflicts: FieldConflict[] = []
  for (const field of fields) {
    const sageValue = source[field]
    const localValue = local[field]
    if (same(localValue, sageValue)) continue
    if (blank(localValue)) {
      updates[field] = sageValue ?? null
      continue
    }
    if (lastSnapshot && same(localValue, lastSnapshot[field])) {
      updates[field] = sageValue ?? null
      continue
    }
    conflicts.push({
      field,
      sageValue: sageValue === null || sageValue === undefined ? null : String(sageValue),
      localValue: localValue === null || localValue === undefined ? null : String(localValue),
    })
  }
  return { updates, conflicts }
}

async function stateFor(tx: Tx, entity: ImportEntity, localId: number) {
  const [row] = await tx
    .select()
    .from(importState)
    .where(and(eq(importState.entity, entity), eq(importState.localId, localId)))
    .limit(1)
  return row ?? null
}

async function recordState(
  tx: Tx,
  entity: ImportEntity,
  localId: number,
  sageId: number,
  snapshot: Record<string, unknown>,
): Promise<void> {
  await tx
    .insert(importState)
    .values({
      entity,
      localId,
      sageId,
      lastSnapshot: snapshot,
      lastImportHash: null,
      lastSeenAt: new Date(),
      lastImportedAt: new Date(),
      sageMissingSince: null,
    })
    .onConflictDoUpdate({
      target: [importState.entity, importState.localId],
      set: {
        sageId,
        lastSnapshot: snapshot,
        lastSeenAt: new Date(),
        lastImportedAt: new Date(),
        sageMissingSince: null,
      },
    })
}

async function recordConflict(
  tx: Tx,
  entity: ImportEntity,
  localId: number,
  sageId: number,
  conflict: FieldConflict,
): Promise<void> {
  await tx
    .insert(importConflicts)
    .values({
      entity,
      localId,
      sageId,
      field: conflict.field,
      sageValue: conflict.sageValue,
      localValue: conflict.localValue,
      status: 'open',
    })
    .onConflictDoNothing({
      target: [
        importConflicts.entity,
        importConflicts.localId,
        importConflicts.field,
        importConflicts.status,
      ],
    })
}

/* ------------------------------ map sources ------------------------------ */

function customerSnapshot(row: typeof legacyCustomer.$inferSelect): Record<string, unknown> {
  return {
    name: row.name ?? '',
    street: row.street,
    city: row.city,
    province: row.province,
    postalCode: row.postalcode,
    contactName: row.cname,
    contactNumber: row.cnumber,
    contactEmail: row.cemail1,
    salesperson: row.salesp,
  }
}

function siteSnapshot(row: typeof legacySites.$inferSelect): Record<string, unknown> {
  return {
    customerId: row.custid,
    name: row.name,
    street: row.street,
    street2: row.street2,
    city: row.city,
    province: row.province,
    postalCode: row.postalcode,
    contactName: row.cname,
    contactNumber: row.cnumber,
    warranty: row.warranty === 1,
    warrantyExpiresOn: row.warrantyExp,
    warrantyNotes: row.warrantyNotes,
    notes: row.notes,
    dns: row.dns,
    lift: row.lift,
    mall: row.mall,
  }
}

function subcontractorSnapshot(row: typeof legacySubcontractor.$inferSelect): Record<string, unknown> {
  return {
    name: row.name,
    street: row.street,
    city: row.city,
    province: row.province,
    postalCode: row.postalcode,
    contactName: row.cname,
    contactNumber: row.cnumber,
    contactEmail: row.cemail1,
    email2: row.cemail2,
    email3: row.cemail3,
  }
}

function supplierSnapshot(row: typeof legacySuppliers.$inferSelect): Record<string, unknown> {
  return {
    name: row.name ?? '',
    address: row.address,
    city: row.city,
    province: row.province,
    postalCode: row.postalcode,
    contactPerson: row.contactPerson,
    contactNumber: row.contactNumber,
    additionalEmails: row.additionalEmails,
    additionalEmailsAccounting: row.additionalEmailsAccounting,
    isUnderCls: row.isUnderCls === 1,
    isOnlineVendor: row.isOnlineVendor === 1,
    bypassPoApproval: row.bypassPoApproval === 1,
    poNotes: row.popnotes,
  }
}

function partSnapshot(row: typeof legacyParts.$inferSelect): Record<string, unknown> {
  return {
    partNumber: (row.number ?? '').toUpperCase(),
    name: row.name,
    partGroupId: row.partGroupId,
    activeInSage: row.activeInSage === 1,
    parentPartNumber: row.parentPartnumber,
    clsLinkedPartCode: row.clsLinkedPartcode,
    warranty: row.warranty,
    labourWarranty: row.laborWarranty,
    installProfitFormula: row.installProfitFormula,
    recycleProfitFormula: row.recycleProfitFormula,
    subignore: row.subignore === 1,
  }
}

/* ------------------------------- importers ------------------------------- */

async function importCustomers(
  tx: Tx,
  apply: boolean,
  summary: ImportEntitySummary,
  events: ImportEvent[],
  conflicts: ImportResult['conflicts'],
  seen: Set<number>,
  onlySageIds?: number[],
): Promise<void> {
  const source = (await tx.select().from(legacyCustomer)).filter(
    (row) => !onlySageIds || onlySageIds.includes(row.id),
  )
  summary.source = source.length
  for (const row of source) {
    const snapshot = customerSnapshot(row)
    seen.add(row.id)
    const [byLink] = await tx
      .select()
      .from(customers)
      .where(sql`${customers.sageCustomerId} = ${row.id} or ${customers.id} = ${row.id}`)
      .limit(1)
    if (byLink) {
      const state = await stateFor(tx, 'customers', byLink.id)
      const { updates, conflicts: fieldConflicts } = decideFields(
        snapshot,
        byLink as unknown as Record<string, unknown>,
        state?.lastSnapshot ?? null,
        ['name', 'street', 'city', 'province', 'postalCode', 'contactName', 'contactNumber', 'contactEmail', 'salesperson'],
      )
      let action: ImportAction = 'unchanged'
      if (Object.keys(updates).length > 0) action = 'update'
      if (fieldConflicts.length > 0) {
        action = 'conflict'
        summary.conflicts += fieldConflicts.length
      }
      if (action !== 'conflict') summary[action] += 1
      events.push({ entity: 'customers', sageId: row.id, localId: byLink.id, action, fields: Object.keys(updates) })
      for (const conflict of fieldConflicts) conflicts.push({ entity: 'customers', localId: byLink.id, sageId: row.id, field: conflict.field })
      if (apply) {
        if (Object.keys(updates).length > 0) {
          await tx
            .update(customers)
            .set({ ...updates, sageCustomerId: row.id, updatedAt: new Date() } as never)
            .where(eq(customers.id, byLink.id))
        } else if (byLink.sageCustomerId !== row.id) {
          await tx.update(customers).set({ sageCustomerId: row.id }).where(eq(customers.id, byLink.id))
        }
        for (const conflict of fieldConflicts) await recordConflict(tx, 'customers', byLink.id, row.id, conflict)
        await recordState(tx, 'customers', byLink.id, row.id, snapshot)
      }
      continue
    }

    const name = row.name ?? ''
    const candidates = await tx
      .select()
      .from(customers)
      .where(and(isNull(customers.sageCustomerId), ilike(customers.name, name)))
      .limit(10)
    const matching = candidates.filter(
      (candidate) =>
        candidate.postalCode?.toUpperCase() === row.postalcode?.toUpperCase() &&
        candidate.name.toLowerCase() === name.toLowerCase(),
    )
    const draft = matching.length === 1 ? matching[0] : null
    if (draft) {
      summary.link += 1
      events.push({ entity: 'customers', sageId: row.id, localId: draft.id, action: 'link', fields: [] })
      if (apply) {
        await tx
          .update(customers)
          .set({ sageCustomerId: row.id, updatedAt: new Date() })
          .where(eq(customers.id, draft.id))
        await recordState(tx, 'customers', draft.id, row.id, snapshot)
      }
    } else {
      summary.create += 1
      events.push({ entity: 'customers', sageId: row.id, localId: row.id, action: 'create', fields: Object.keys(snapshot) })
      if (apply) {
        await tx.insert(customers).values({
          id: row.id,
          sageCustomerId: row.id,
          name: snapshot.name as string,
          street: snapshot.street as string | null,
          city: snapshot.city as string | null,
          province: snapshot.province as string | null,
          postalCode: snapshot.postalCode as string | null,
          contactName: snapshot.contactName as string | null,
          contactNumber: snapshot.contactNumber as string | null,
          contactEmail: snapshot.contactEmail as string | null,
          salesperson: snapshot.salesperson as string | null,
        })
        await recordState(tx, 'customers', row.id, row.id, snapshot)
      }
    }
  }
}

async function importSites(
  tx: Tx,
  apply: boolean,
  summary: ImportEntitySummary,
  events: ImportEvent[],
  conflicts: ImportResult['conflicts'],
  seen: Set<number>,
  onlySageIds?: number[],
): Promise<void> {
  const source = (await tx.select().from(legacySites)).filter(
    (row) => !onlySageIds || onlySageIds.includes(row.id),
  )
  summary.source = source.length
  for (const row of source) {
    seen.add(row.id)
    const snapshot = siteSnapshot(row)
    const [parent] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(sql`${customers.sageCustomerId} = ${row.custid} or ${customers.id} = ${row.custid}`)
      .limit(1)
    snapshot.customerId = parent?.id ?? null
    const [byLink] = await tx
      .select()
      .from(sites)
      .where(sql`${sites.sageSiteId} = ${row.id} or ${sites.id} = ${row.id}`)
      .limit(1)
    if (byLink) {
      const state = await stateFor(tx, 'sites', byLink.id)
      const { updates, conflicts: fieldConflicts } = decideFields(
        snapshot,
        byLink as unknown as Record<string, unknown>,
        state?.lastSnapshot ?? null,
        ['customerId', 'name', 'street', 'street2', 'city', 'province', 'postalCode', 'contactName', 'contactNumber', 'warranty', 'warrantyExpiresOn', 'warrantyNotes', 'notes', 'dns', 'lift', 'mall'],
      )
      const action: ImportAction = fieldConflicts.length > 0 ? 'conflict' : Object.keys(updates).length > 0 ? 'update' : 'unchanged'
      if (fieldConflicts.length > 0) summary.conflicts += fieldConflicts.length
      if (action !== 'conflict') summary[action] += 1
      events.push({ entity: 'sites', sageId: row.id, localId: byLink.id, action, fields: Object.keys(updates) })
      for (const conflict of fieldConflicts) conflicts.push({ entity: 'sites', localId: byLink.id, sageId: row.id, field: conflict.field })
      if (apply) {
        if (Object.keys(updates).length > 0) {
          await tx
            .update(sites)
            .set({ ...updates, sageSiteId: row.id, updatedAt: new Date() } as never)
            .where(eq(sites.id, byLink.id))
        } else if (byLink.sageSiteId !== row.id) {
          await tx.update(sites).set({ sageSiteId: row.id }).where(eq(sites.id, byLink.id))
        }
        for (const conflict of fieldConflicts) await recordConflict(tx, 'sites', byLink.id, row.id, conflict)
        await recordState(tx, 'sites', byLink.id, row.id, snapshot)
      }
      continue
    }

    const candidates = await tx
      .select()
      .from(sites)
      .where(and(isNull(sites.sageSiteId), eq(sites.name, row.name)))
      .limit(10)
    const draft =
      candidates.find(
        (candidate) =>
          candidate.street?.toLowerCase() === row.street.toLowerCase() &&
          candidate.city?.toLowerCase() === row.city.toLowerCase(),
      ) ?? null
    if (draft) {
      summary.link += 1
      events.push({ entity: 'sites', sageId: row.id, localId: draft.id, action: 'link', fields: [] })
      if (apply) {
        await tx.update(sites).set({ sageSiteId: row.id, updatedAt: new Date() }).where(eq(sites.id, draft.id))
        await recordState(tx, 'sites', draft.id, row.id, snapshot)
      }
    } else {
      summary.create += 1
      events.push({ entity: 'sites', sageId: row.id, localId: row.id, action: 'create', fields: Object.keys(snapshot) })
      if (apply) {
        await tx.insert(sites).values({
          id: row.id,
          sageSiteId: row.id,
          customerId: snapshot.customerId as number | null,
          name: row.name,
          street: row.street,
          street2: row.street2,
          city: row.city,
          province: row.province,
          postalCode: row.postalcode,
          contactName: row.cname,
          contactNumber: row.cnumber,
          warranty: row.warranty === 1,
          warrantyExpiresOn: row.warrantyExp,
          warrantyNotes: row.warrantyNotes,
          notes: row.notes,
          dns: row.dns,
          lift: row.lift,
          mall: row.mall,
        })
        await recordState(tx, 'sites', row.id, row.id, snapshot)
      }
    }
  }
}

async function importSubcontractors(
  tx: Tx,
  apply: boolean,
  summary: ImportEntitySummary,
  events: ImportEvent[],
  conflicts: ImportResult['conflicts'],
  seen: Set<number>,
  onlySageIds?: number[],
): Promise<void> {
  const source = (await tx.select().from(legacySubcontractor)).filter(
    (row) => !onlySageIds || onlySageIds.includes(row.id),
  )
  summary.source = source.length
  for (const row of source) {
    seen.add(row.id)
    const snapshot = subcontractorSnapshot(row)
    const [byLink] = await tx
      .select()
      .from(subcontractors)
      .where(sql`${subcontractors.sageSubcontractorId} = ${row.id} or ${subcontractors.id} = ${row.id}`)
      .limit(1)
    if (byLink) {
      const state = await stateFor(tx, 'subcontractors', byLink.id)
      const { updates, conflicts: fieldConflicts } = decideFields(
        snapshot,
        byLink as unknown as Record<string, unknown>,
        state?.lastSnapshot ?? null,
        ['name', 'street', 'city', 'province', 'postalCode', 'contactName', 'contactNumber', 'contactEmail', 'email2', 'email3'],
      )
      const action: ImportAction = fieldConflicts.length > 0 ? 'conflict' : Object.keys(updates).length > 0 ? 'update' : 'unchanged'
      if (fieldConflicts.length > 0) summary.conflicts += fieldConflicts.length
      if (action !== 'conflict') summary[action] += 1
      events.push({ entity: 'subcontractors', sageId: row.id, localId: byLink.id, action, fields: Object.keys(updates) })
      for (const conflict of fieldConflicts) conflicts.push({ entity: 'subcontractors', localId: byLink.id, sageId: row.id, field: conflict.field })
      if (apply) {
        if (Object.keys(updates).length > 0) {
          await tx
            .update(subcontractors)
            .set({ ...updates, sageSubcontractorId: row.id, updatedAt: new Date() } as never)
            .where(eq(subcontractors.id, byLink.id))
        } else if (byLink.sageSubcontractorId !== row.id) {
          await tx.update(subcontractors).set({ sageSubcontractorId: row.id }).where(eq(subcontractors.id, byLink.id))
        }
        for (const conflict of fieldConflicts) await recordConflict(tx, 'subcontractors', byLink.id, row.id, conflict)
        await recordState(tx, 'subcontractors', byLink.id, row.id, snapshot)
      }
      continue
    }
    const draft = await tx
      .select()
      .from(subcontractors)
      .where(and(isNull(subcontractors.sageSubcontractorId), ilike(subcontractors.name, row.name)))
      .limit(2)
    if (draft.length === 1) {
      summary.link += 1
      events.push({ entity: 'subcontractors', sageId: row.id, localId: draft[0]!.id, action: 'link', fields: [] })
      if (apply) {
        await tx.update(subcontractors).set({ sageSubcontractorId: row.id, updatedAt: new Date() }).where(eq(subcontractors.id, draft[0]!.id))
        await recordState(tx, 'subcontractors', draft[0]!.id, row.id, snapshot)
      }
    } else {
      summary.create += 1
      events.push({ entity: 'subcontractors', sageId: row.id, localId: row.id, action: 'create', fields: Object.keys(snapshot) })
      if (apply) {
        await tx.insert(subcontractors).values({
          id: row.id,
          sageSubcontractorId: row.id,
          name: row.name,
          street: row.street,
          city: row.city,
          province: row.province,
          postalCode: row.postalcode,
          contactName: row.cname,
          contactNumber: row.cnumber,
          contactEmail: row.cemail1,
          email2: row.cemail2,
          email3: row.cemail3,
        })
        await recordState(tx, 'subcontractors', row.id, row.id, snapshot)
      }
    }
  }
}

async function importSuppliers(
  tx: Tx,
  apply: boolean,
  summary: ImportEntitySummary,
  events: ImportEvent[],
  conflicts: ImportResult['conflicts'],
  seen: Set<number>,
  onlySageIds?: number[],
): Promise<void> {
  const source = (await tx.select().from(legacySuppliers)).filter(
    (row) => !onlySageIds || onlySageIds.includes(row.sageVendorId ?? row.id),
  )
  summary.source = source.length
  for (const row of source) {
    const sageId = row.sageVendorId ?? row.id
    seen.add(sageId)
    const snapshot = supplierSnapshot(row)
    const [byLink] = await tx
      .select()
      .from(suppliers)
      .where(sql`${suppliers.sageVendorId} = ${sageId} or ${suppliers.id} = ${sageId}`)
      .limit(1)
    if (byLink) {
      const state = await stateFor(tx, 'suppliers', byLink.id)
      const { updates, conflicts: fieldConflicts } = decideFields(
        snapshot,
        byLink as unknown as Record<string, unknown>,
        state?.lastSnapshot ?? null,
        ['name', 'address', 'city', 'province', 'postalCode', 'contactPerson', 'contactNumber'],
      )
      const action: ImportAction = fieldConflicts.length > 0 ? 'conflict' : Object.keys(updates).length > 0 ? 'update' : 'unchanged'
      if (fieldConflicts.length > 0) summary.conflicts += fieldConflicts.length
      if (action !== 'conflict') summary[action] += 1
      events.push({ entity: 'suppliers', sageId, localId: byLink.id, action, fields: Object.keys(updates) })
      for (const conflict of fieldConflicts) conflicts.push({ entity: 'suppliers', localId: byLink.id, sageId, field: conflict.field })
      if (apply) {
        if (Object.keys(updates).length > 0) {
          await tx.update(suppliers).set({ ...updates, sageVendorId: sageId, updatedAt: new Date() } as never).where(eq(suppliers.id, byLink.id))
        } else if (byLink.sageVendorId !== sageId) {
          await tx.update(suppliers).set({ sageVendorId: sageId }).where(eq(suppliers.id, byLink.id))
        }
        for (const conflict of fieldConflicts) await recordConflict(tx, 'suppliers', byLink.id, sageId, conflict)
        await recordState(tx, 'suppliers', byLink.id, sageId, snapshot)
      }
      continue
    }
    const draft = await tx
      .select()
      .from(suppliers)
      .where(and(isNull(suppliers.sageVendorId), ilike(suppliers.name, row.name ?? '')))
      .limit(2)
    if (draft.length === 1) {
      summary.link += 1
      events.push({ entity: 'suppliers', sageId, localId: draft[0]!.id, action: 'link', fields: [] })
      if (apply) {
        await tx.update(suppliers).set({ sageVendorId: sageId, updatedAt: new Date() }).where(eq(suppliers.id, draft[0]!.id))
        await recordState(tx, 'suppliers', draft[0]!.id, sageId, snapshot)
      }
    } else {
      summary.create += 1
      events.push({ entity: 'suppliers', sageId, localId: sageId, action: 'create', fields: Object.keys(snapshot) })
      if (apply) {
        await tx.insert(suppliers).values({
          id: sageId,
          sageVendorId: sageId,
          name: row.name ?? 'Unnamed supplier',
          address: row.address,
          city: row.city,
          province: row.province,
          postalCode: row.postalcode,
          contactPerson: row.contactPerson,
          contactNumber: row.contactNumber,
          additionalEmails: row.additionalEmails,
          additionalEmailsAccounting: row.additionalEmailsAccounting,
          isUnderCls: row.isUnderCls === 1,
          isOnlineVendor: row.isOnlineVendor === 1,
          bypassPoApproval: row.bypassPoApproval === 1,
          poNotes: row.popnotes,
        })
        await recordState(tx, 'suppliers', sageId, sageId, snapshot)
      }
    }
  }
}

async function importParts(
  tx: Tx,
  apply: boolean,
  summary: ImportEntitySummary,
  events: ImportEvent[],
  conflicts: ImportResult['conflicts'],
  seen: Set<number>,
  onlySageIds?: number[],
): Promise<void> {
  const source = (await tx.select().from(legacyParts)).filter(
    (row) => !onlySageIds || onlySageIds.includes(row.id),
  )
  summary.source = source.length
  for (const row of source) {
    seen.add(row.id)
    const snapshot = partSnapshot(row)
    const [byLink] = await tx
      .select()
      .from(parts)
      .where(sql`${parts.sageItemId} = ${row.sageId ?? row.id} or ${parts.id} = ${row.id}`)
      .limit(1)
    if (byLink) {
      const state = await stateFor(tx, 'parts', byLink.id)
      const { updates, conflicts: fieldConflicts } = decideFields(
        snapshot,
        byLink as unknown as Record<string, unknown>,
        state?.lastSnapshot ?? null,
        ['name', 'partGroupId', 'activeInSage', 'parentPartNumber', 'clsLinkedPartCode', 'warranty', 'labourWarranty', 'installProfitFormula', 'recycleProfitFormula', 'subignore'],
      )
      const action: ImportAction = fieldConflicts.length > 0 ? 'conflict' : Object.keys(updates).length > 0 ? 'update' : 'unchanged'
      if (fieldConflicts.length > 0) summary.conflicts += fieldConflicts.length
      if (action !== 'conflict') summary[action] += 1
      events.push({ entity: 'parts', sageId: row.sageId ?? row.id, localId: byLink.id, action, fields: Object.keys(updates) })
      for (const conflict of fieldConflicts) conflicts.push({ entity: 'parts', localId: byLink.id, sageId: row.sageId ?? row.id, field: conflict.field })
      if (apply) {
        if (Object.keys(updates).length > 0) {
          await tx.update(parts).set({ ...updates, updatedAt: new Date() } as never).where(eq(parts.id, byLink.id))
        }
        for (const conflict of fieldConflicts) await recordConflict(tx, 'parts', byLink.id, row.sageId ?? row.id, conflict)
        await recordState(tx, 'parts', byLink.id, row.sageId ?? row.id, snapshot)
      }
      continue
    }
    const draft = row.number
      ? await tx.select().from(parts).where(eq(parts.partNumber, row.number.toUpperCase())).limit(1)
      : []
    if (draft.length === 1 && draft[0]!.id < 0) {
      summary.link += 1
      events.push({ entity: 'parts', sageId: row.sageId ?? row.id, localId: draft[0]!.id, action: 'link', fields: [] })
      if (apply) {
        await tx
          .update(parts)
          .set({ sageItemId: row.sageId ?? null, activeInSage: row.activeInSage === 1, updatedAt: new Date() })
          .where(eq(parts.id, draft[0]!.id))
        await recordState(tx, 'parts', draft[0]!.id, row.sageId ?? row.id, snapshot)
      }
    } else {
      summary.create += 1
      events.push({ entity: 'parts', sageId: row.sageId ?? row.id, localId: row.id, action: 'create', fields: Object.keys(snapshot) })
      if (apply) {
        await tx.insert(parts).values({
          id: row.id,
          partNumber: snapshot.partNumber as string,
          name: row.name,
          partGroupId: row.partGroupId,
          sageItemId: row.sageId,
          activeInSage: row.activeInSage === 1,
          subignore: row.subignore === 1,
          parentPartNumber: row.parentPartnumber,
          clsLinkedPartCode: row.clsLinkedPartcode,
          warranty: row.warranty,
          labourWarranty: row.laborWarranty,
          installProfitFormula: row.installProfitFormula,
          recycleProfitFormula: row.recycleProfitFormula,
        })
        await recordState(tx, 'parts', row.id, row.sageId ?? row.id, snapshot)
      }
    }
  }
}

export async function runSageImport(
  tx: Tx,
  input: { apply: boolean; entities: ImportEntity[]; onlySageIds?: number[] },
  session: AuthSessionView,
): Promise<ImportResult> {
  const selected = input.entities.length > 0 ? input.entities : ALL_ENTITIES
  const summaries = selected.map(emptySummary)
  const events: ImportEvent[] = []
  const conflicts: ImportResult['conflicts'] = []
  const seenByEntity = new Map<ImportEntity, Set<number>>()
  for (const entity of selected) seenByEntity.set(entity, new Set())

  for (const entity of selected) {
    const summary = summaries.find((item) => item.entity === entity)!
    const seen = seenByEntity.get(entity)!
    if (entity === 'customers') await importCustomers(tx, input.apply, summary, events, conflicts, seen, input.onlySageIds)
    if (entity === 'sites') await importSites(tx, input.apply, summary, events, conflicts, seen, input.onlySageIds)
    if (entity === 'subcontractors') await importSubcontractors(tx, input.apply, summary, events, conflicts, seen, input.onlySageIds)
    if (entity === 'suppliers') await importSuppliers(tx, input.apply, summary, events, conflicts, seen, input.onlySageIds)
    if (entity === 'parts') await importParts(tx, input.apply, summary, events, conflicts, seen, input.onlySageIds)
  }

  const missing: ImportResult['missing'] = []
  for (const entity of selected) {
    const seen = seenByEntity.get(entity)!
    const table =
      entity === 'customers'
        ? customers
        : entity === 'sites'
          ? sites
          : entity === 'subcontractors'
            ? subcontractors
            : entity === 'suppliers'
              ? suppliers
              : parts
    const linkColumn =
      entity === 'customers'
        ? customers.sageCustomerId
        : entity === 'sites'
          ? sites.sageSiteId
          : entity === 'subcontractors'
            ? subcontractors.sageSubcontractorId
            : entity === 'suppliers'
              ? suppliers.sageVendorId
              : parts.sageItemId
    const rows = await tx
      .select({ id: table.id, link: linkColumn })
      .from(table)
      .where(sql`${linkColumn} is not null`)
    for (const row of rows) {
      if (input.onlySageIds && (row.link === null || !input.onlySageIds.includes(row.link))) continue
      if (row.link !== null && seen.has(row.link)) continue
      missing.push({ entity, localId: row.id })
      const summary = summaries.find((item) => item.entity === entity)!
      summary.missing += 1
      if (input.apply) {
        await tx
          .update(importState)
          .set({ sageMissingSince: new Date() })
          .where(and(eq(importState.entity, entity), eq(importState.localId, row.id), isNull(importState.sageMissingSince)))
      }
    }
  }

  if (input.apply) {
    const totals = summaries
      .map((summary) => `${summary.entity}: +${summary.create}/~${summary.update}/!${summary.conflicts}`)
      .join(', ')
    await auditMasterData(tx, session, {
      action: 'masterdata.sage_import.apply',
      entityType: 'sage_import',
      entityId: 'run',
      permission: 'customer:write',
      summary: `Applied Sage import (${totals}).`,
      after: { summaries, conflicts: conflicts.length, missing: missing.length },
    })
  }

  return { applied: input.apply, summaries, events: events.slice(0, 200), conflicts, missing }
}

export async function runSageImportDryRun(
  tx: Tx,
  entities: ImportEntity[],
  session: AuthSessionView,
): Promise<ImportResult> {
  return runSageImport(tx, { apply: false, entities }, session)
}

export function assertImportable(tx: Tx): void {
  if (!tx) throw new ValidationError('Import requires a transaction.')
}
