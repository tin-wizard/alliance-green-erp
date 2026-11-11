import { z } from 'zod'

/** URL search contracts for Master Data lists. Page is 1-based. */

const base = z.object({
  q: z.string().trim().max(200).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
})

export const listSearchSchema = base
export type ListSearch = z.infer<typeof listSearchSchema>

export const siteListSearchSchema = base.extend({
  parent: z.enum(['all', 'present', 'missing']).optional().catch(undefined),
})
export type SiteListSearch = z.infer<typeof siteListSearchSchema>

export const subcontractorListSearchSchema = base.extend({
  wsib: z.enum(['all', 'valid', 'missing']).optional().catch(undefined),
})
export type SubcontractorListSearch = z.infer<typeof subcontractorListSearchSchema>

export function parseListSearch(search: Record<string, unknown>): ListSearch {
  return listSearchSchema.parse(search)
}

export function parseSiteListSearch(search: Record<string, unknown>): SiteListSearch {
  return siteListSearchSchema.parse(search)
}

export function parseSubcontractorListSearch(
  search: Record<string, unknown>,
): SubcontractorListSearch {
  return subcontractorListSearchSchema.parse(search)
}
