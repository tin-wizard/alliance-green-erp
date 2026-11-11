/**
 * Candidate loading for duplicate detection. SERVER ONLY.
 *
 * Candidates are deliberately broad; the pure classifier in `lib/duplicates.ts`
 * applies the block/override thresholds.
 */
import { and, eq, ilike, ne, or, sql, type SQL } from 'drizzle-orm'
import type { Executor } from '@cls/db'
import { customers, parts, sites, subcontractors, suppliers } from '@cls/db/schema'
import type { DuplicateCandidate, DuplicateResult } from '../lib/duplicates'
import {
  classifyCustomerDuplicate,
  classifyPartDuplicate,
  classifySiteDuplicate,
  classifyVendorDuplicate,
  normalizePhone,
} from '../lib/duplicates'

const LIMIT = 50

function contains(value: string | undefined | null): string | null {
  const term = value?.trim()
  return term ? `%${term}%` : null
}

function phoneMatch(column: SQL | unknown, phone: string | null): SQL | null {
  const digits = normalizePhone(phone)
  if (digits.length < 10) return null
  return sql`right(regexp_replace(coalesce(${column}, ''), '[^0-9]', '', 'g'), 10) = ${digits}`
}

export async function customerCandidates(
  executor: Executor,
  input: { name?: string; postalCode?: string; phone?: string; email?: string; excludeId?: number },
): Promise<DuplicateCandidate[]> {
  const name = contains(input.name)
  const postal = input.postalCode?.trim().toUpperCase()
  const email = input.email?.trim().toLowerCase()
  const clauses: (SQL | undefined)[] = [
    name ? ilike(customers.name, name) : undefined,
    postal ? eq(customers.postalCode, postal) : undefined,
    email ? eq(customers.contactEmail, email) : undefined,
    phoneMatch(customers.contactNumber, input.phone ?? null) ?? undefined,
  ]
  const match = or(...clauses.filter((clause): clause is SQL => Boolean(clause)))
  const where = input.excludeId ? and(match, ne(customers.id, input.excludeId)) : match
  const rows = await executor
    .select({
      id: customers.id,
      name: customers.name,
      city: customers.city,
      postalCode: customers.postalCode,
      phone: customers.contactNumber,
      email: customers.contactEmail,
    })
    .from(customers)
    .where(where)
    .limit(LIMIT)
  return rows
}

export async function siteCandidates(
  executor: Executor,
  input: {
    name?: string
    street?: string
    city?: string
    postalCode?: string
    customerId?: number | null
    excludeId?: number
  },
): Promise<DuplicateCandidate[]> {
  const name = contains(input.name)
  const street = contains(input.street)
  const city = contains(input.city)
  const postal = input.postalCode?.trim().toUpperCase()
  const clauses: (SQL | undefined)[] = [
    name ? ilike(sites.name, name) : undefined,
    street ? ilike(sites.street, street) : undefined,
    city ? ilike(sites.city, city) : undefined,
    postal ? eq(sites.postalCode, postal) : undefined,
    input.customerId ? eq(sites.customerId, input.customerId) : undefined,
  ]
  const match = or(...clauses.filter((clause): clause is SQL => Boolean(clause)))
  const where = input.excludeId ? and(match, ne(sites.id, input.excludeId)) : match
  const rows = await executor
    .select({
      id: sites.id,
      name: sites.name,
      city: sites.city,
      postalCode: sites.postalCode,
      street: sites.street,
      parentId: sites.customerId,
    })
    .from(sites)
    .where(where)
    .limit(LIMIT)
  return rows
}

export async function vendorCandidates(
  executor: Executor,
  table: typeof subcontractors | typeof suppliers,
  input: { name?: string; city?: string; phone?: string; email?: string; excludeId?: number },
): Promise<DuplicateCandidate[]> {
  const name = contains(input.name)
  const city = contains(input.city)
  const email = input.email?.trim().toLowerCase()
  const rows =
    table === subcontractors
      ? await executor
          .select({
            id: subcontractors.id,
            name: subcontractors.name,
            city: subcontractors.city,
            phone: subcontractors.contactNumber,
            email: subcontractors.contactEmail,
          })
          .from(subcontractors)
          .where(
            and(
              or(
                name ? ilike(subcontractors.name, name) : undefined,
                city ? ilike(subcontractors.city, city) : undefined,
                email ? eq(subcontractors.contactEmail, email) : undefined,
                phoneMatch(subcontractors.contactNumber, input.phone ?? null) ?? undefined,
              ),
              input.excludeId ? ne(subcontractors.id, input.excludeId) : undefined,
            ),
          )
          .limit(LIMIT)
      : await executor
          .select({
            id: suppliers.id,
            name: suppliers.name,
            city: suppliers.city,
            phone: suppliers.contactNumber,
          })
          .from(suppliers)
          .where(
            and(
              or(
                name ? ilike(suppliers.name, name) : undefined,
                city ? ilike(suppliers.city, city) : undefined,
                phoneMatch(suppliers.contactNumber, input.phone ?? null) ?? undefined,
              ),
              input.excludeId ? ne(suppliers.id, input.excludeId) : undefined,
            ),
          )
          .limit(LIMIT)
  return rows
}

export async function partCandidates(
  executor: Executor,
  input: {
    partNumber?: string
    name?: string
    partGroupId?: number | null
    excludeId?: number
  },
): Promise<DuplicateCandidate[]> {
  const number = input.partNumber?.trim().toUpperCase()
  const name = contains(input.name)
  const rows = await executor
    .select({
      id: parts.id,
      name: parts.name,
      partNumber: parts.partNumber,
      partGroupId: parts.partGroupId,
    })
    .from(parts)
    .where(
      and(
        or(
          number ? eq(parts.partNumber, number) : undefined,
          name ? ilike(parts.name, name) : undefined,
        ),
        input.excludeId ? ne(parts.id, input.excludeId) : undefined,
      ),
    )
    .limit(LIMIT)
  return rows.map((row) => ({ ...row, name: row.name ?? '' }))
}

export async function checkCustomerDuplicates(
  executor: Executor,
  input: {
    name: string
    postalCode?: string | null
    phone?: string | null
    email?: string | null
    city?: string | null
    excludeId?: number | null
  },
): Promise<DuplicateResult & { candidates: DuplicateCandidate[] }> {
  const candidates = await customerCandidates(executor, {
    name: input.name,
    postalCode: input.postalCode ?? undefined,
    phone: input.phone ?? undefined,
    email: input.email ?? undefined,
    excludeId: input.excludeId ?? undefined,
  })
  return { ...classifyCustomerDuplicate(input, candidates), candidates }
}

export async function checkSiteDuplicates(
  executor: Executor,
  input: {
    name: string
    street?: string | null
    city?: string | null
    postalCode?: string | null
    customerId?: number | null
    excludeId?: number | null
  },
): Promise<DuplicateResult & { candidates: DuplicateCandidate[] }> {
  const candidates = await siteCandidates(executor, {
    name: input.name,
    street: input.street ?? undefined,
    city: input.city ?? undefined,
    postalCode: input.postalCode ?? undefined,
    customerId: input.customerId ?? null,
    excludeId: input.excludeId ?? undefined,
  })
  return { ...classifySiteDuplicate(input, candidates), candidates }
}

export async function checkVendorDuplicates(
  executor: Executor,
  entity: 'subcontractor' | 'supplier',
  input: {
    name: string
    city?: string | null
    phone?: string | null
    email?: string | null
    excludeId?: number | null
  },
): Promise<DuplicateResult & { candidates: DuplicateCandidate[] }> {
  const candidates = await vendorCandidates(
    executor,
    entity === 'subcontractor' ? subcontractors : suppliers,
    {
      name: input.name,
      city: input.city ?? undefined,
      phone: input.phone ?? undefined,
      email: input.email ?? undefined,
      excludeId: input.excludeId ?? undefined,
    },
  )
  return { ...classifyVendorDuplicate(input, candidates), candidates }
}

export async function checkPartDuplicates(
  executor: Executor,
  input: {
    partNumber: string
    name?: string | null
    partGroupId?: number | null
    excludeId?: number | null
  },
): Promise<DuplicateResult & { candidates: DuplicateCandidate[] }> {
  const candidates = await partCandidates(executor, {
    partNumber: input.partNumber,
    name: input.name ?? undefined,
    partGroupId: input.partGroupId ?? null,
    excludeId: input.excludeId ?? undefined,
  })
  return { ...classifyPartDuplicate(input, candidates), candidates }
}

/** `and` keeps the type helper exported for future composite filters. */
