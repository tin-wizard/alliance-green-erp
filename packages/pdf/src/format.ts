/** Display formatting for DTO values. Never changes money strings. */
import type { AddressBlockData } from './types'

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

/**
 * Formats a validated ISO date (`2026-11-11`) as `Nov 11, 2026`.
 * A value that is not an ISO date is printed unchanged; the DTO schema is the
 * gate, not this helper.
 */
export function formatIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value
  const [, year, month, day] = match
  const monthLabel = month === undefined ? undefined : MONTHS[Number(month) - 1]
  if (!year || !day || !monthLabel) return value
  return `${monthLabel} ${Number(day)}, ${year}`
}

/** Address lines below the recipient name, in print order. */
export function addressLines(data: AddressBlockData): string[] {
  const lines: string[] = []
  if (data.contact) lines.push(data.contact)
  if (data.street) lines.push(data.street)
  if (data.street2) lines.push(data.street2)

  const region = [data.province, data.postalCode].filter((part): part is string => !!part).join('  ')
  const locality = data.city && region ? `${data.city}, ${region}` : (data.city ?? region)
  if (locality) lines.push(locality)

  if (data.phone) lines.push(data.phone)
  return lines
}
