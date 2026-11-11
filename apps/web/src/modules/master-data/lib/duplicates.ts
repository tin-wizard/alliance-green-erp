/**
 * Duplicate detection. Pure functions so the thresholds are testable without a
 * database. The server supplies candidates; the classifier decides.
 */

export type DuplicateDecision = 'clear' | 'block' | 'override'

export interface DuplicateCandidate {
  id: number
  name: string
  city?: string | null
  postalCode?: string | null
  phone?: string | null
  email?: string | null
  parentId?: number | null
  street?: string | null
  partNumber?: string | null
  partGroupId?: number | null
}

export interface DuplicateResult {
  decision: DuplicateDecision
  reason: string | null
  candidateIds: number[]
}

const LEGAL_SUFFIXES = new Set([
  'ltd',
  'limited',
  'inc',
  'incorporated',
  'corp',
  'corporation',
  'co',
  'company',
])

export function normalizeName(value: string | null | undefined): string {
  const words = (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1]!)) words.pop()
  return words.join(' ')
}

const ADDRESS_SUFFIXES: Record<string, string> = {
  st: 'street',
  rd: 'road',
  ave: 'avenue',
  av: 'avenue',
  dr: 'drive',
  blvd: 'boulevard',
  cres: 'crescent',
  ct: 'court',
  pl: 'place',
  hwy: 'highway',
}

export function normalizeAddress(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => ADDRESS_SUFFIXES[word] ?? word)
    .join(' ')
}

export function normalizePhone(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '').slice(-10)
}

export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/** Dice coefficient over character bigrams, 0..1. */
export function similarity(left: string, right: string): number {
  if (!left || !right) return 0
  if (left === right) return 1
  if (left.length < 2 || right.length < 2) return 0
  const bigrams = new Map<string, number>()
  for (let index = 0; index < left.length - 1; index += 1) {
    const gram = left.slice(index, index + 2)
    bigrams.set(gram, (bigrams.get(gram) ?? 0) + 1)
  }
  let overlap = 0
  for (let index = 0; index < right.length - 1; index += 1) {
    const gram = right.slice(index, index + 2)
    const count = bigrams.get(gram) ?? 0
    if (count > 0) {
      overlap += 1
      bigrams.set(gram, count - 1)
    }
  }
  return (2 * overlap) / (left.length - 1 + (right.length - 1))
}

const OVERRIDE_SIMILARITY = 0.92

function result(
  decision: DuplicateDecision,
  reason: string | null,
  candidates: readonly DuplicateCandidate[],
): DuplicateResult {
  return { decision, reason, candidateIds: candidates.map((candidate) => candidate.id) }
}

export function classifyCustomerDuplicate(
  input: {
    name: string
    postalCode?: string | null
    phone?: string | null
    email?: string | null
    city?: string | null
  },
  candidates: readonly DuplicateCandidate[],
): DuplicateResult {
  const nameKey = normalizeName(input.name)
  const postal = (input.postalCode ?? '').trim().toUpperCase()
  const phone = normalizePhone(input.phone)
  const email = normalizeEmail(input.email)
  const city = normalizeName(input.city)

  const blocked: DuplicateCandidate[] = []
  const overridden: DuplicateCandidate[] = []
  for (const candidate of candidates) {
    const candidateName = normalizeName(candidate.name)
    const sameName = candidateName === nameKey
    const samePostal = postal.length > 0 && (candidate.postalCode ?? '').trim().toUpperCase() === postal
    const samePhone = phone.length >= 10 && normalizePhone(candidate.phone) === phone
    const sameEmail = email.length > 0 && normalizeEmail(candidate.email) === email
    const sameCity = city.length > 0 && normalizeName(candidate.city) === city

    if (sameName && (samePostal || samePhone || sameEmail)) blocked.push(candidate)
    else if (!sameName && (samePhone || sameEmail)) overridden.push(candidate)
    else if (similarity(candidateName, nameKey) >= OVERRIDE_SIMILARITY && sameCity) {
      overridden.push(candidate)
    }
  }
  if (blocked.length > 0) {
    return result('block', 'An existing customer has the same name and postal code, phone or email.', blocked)
  }
  if (overridden.length > 0) {
    return result(
      'override',
      'A similar customer already exists. An admin must confirm this is a different customer.',
      overridden,
    )
  }
  return result('clear', null, [])
}

export function classifySiteDuplicate(
  input: {
    name: string
    street?: string | null
    city?: string | null
    postalCode?: string | null
    customerId?: number | null
  },
  candidates: readonly DuplicateCandidate[],
): DuplicateResult {
  const nameKey = normalizeName(input.name)
  const street = normalizeAddress(input.street)
  const city = normalizeName(input.city)
  const postal = (input.postalCode ?? '').trim().toUpperCase()

  const blocked: DuplicateCandidate[] = []
  const overridden: DuplicateCandidate[] = []
  for (const candidate of candidates) {
    const sameParent = (candidate.parentId ?? null) === (input.customerId ?? null)
    const candidateStreet = normalizeAddress(candidate.street)
    const sameAddress =
      sameParent &&
      ((street.length > 0 && candidateStreet === street) ||
        (postal.length > 0 && (candidate.postalCode ?? '').trim().toUpperCase() === postal))
    const sameName = normalizeName(candidate.name) === nameKey
    const sameCity = city.length > 0 && normalizeName(candidate.city) === city

    if (sameAddress) blocked.push(candidate)
    else if (sameName && sameCity) overridden.push(candidate)
  }
  if (blocked.length > 0) {
    return result('block', 'This billing customer already has a site at that address.', blocked)
  }
  if (overridden.length > 0) {
    return result(
      'override',
      'A site with the same name and city exists. An admin must confirm it is different.',
      overridden,
    )
  }
  return result('clear', null, [])
}

export function classifyVendorDuplicate(
  input: { name: string; city?: string | null; phone?: string | null; email?: string | null },
  candidates: readonly DuplicateCandidate[],
): DuplicateResult {
  const nameKey = normalizeName(input.name)
  const city = normalizeName(input.city)
  const phone = normalizePhone(input.phone)
  const email = normalizeEmail(input.email)

  const blocked: DuplicateCandidate[] = []
  const overridden: DuplicateCandidate[] = []
  for (const candidate of candidates) {
    const sameName = normalizeName(candidate.name) === nameKey
    const samePhone = phone.length >= 10 && normalizePhone(candidate.phone) === phone
    const sameEmail = email.length > 0 && normalizeEmail(candidate.email) === email
    const sameCity = city.length > 0 && normalizeName(candidate.city) === city

    if (sameName && (samePhone || sameEmail)) blocked.push(candidate)
    else if (sameName && sameCity) overridden.push(candidate)
  }
  if (blocked.length > 0) {
    return result('block', 'A vendor with the same name and phone or email already exists.', blocked)
  }
  if (overridden.length > 0) {
    return result(
      'override',
      'A vendor with the same name and city exists. An admin must confirm it is different.',
      overridden,
    )
  }
  return result('clear', null, [])
}

export function classifyPartDuplicate(
  input: { partNumber: string; name?: string | null; partGroupId?: number | null },
  candidates: readonly DuplicateCandidate[],
): DuplicateResult {
  const number = input.partNumber.trim().toUpperCase()
  const nameKey = normalizeName(input.name)
  const blocked: DuplicateCandidate[] = []
  const overridden: DuplicateCandidate[] = []
  for (const candidate of candidates) {
    if ((candidate.partNumber ?? '').trim().toUpperCase() === number) blocked.push(candidate)
    else if (
      nameKey.length > 0 &&
      normalizeName(candidate.name) === nameKey &&
      (candidate.partGroupId ?? null) === (input.partGroupId ?? null)
    ) {
      overridden.push(candidate)
    }
  }
  if (blocked.length > 0) {
    return result('block', 'That part number already exists.', blocked)
  }
  if (overridden.length > 0) {
    return result(
      'override',
      'A part with the same description and group exists. An admin must confirm it is different.',
      overridden,
    )
  }
  return result('clear', null, [])
}

export const DUPLICATE_THRESHOLDS = {
  overrideSimilarity: OVERRIDE_SIMILARITY,
  legalSuffixes: [...LEGAL_SUFFIXES],
} as const
