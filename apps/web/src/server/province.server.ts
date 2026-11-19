import { logger } from '@cls/core/logger'
import { isKnownSalesProvince } from '@cls/pricing'

/** Unknown non-blank provinces fall back to ON 13%; record the legacy divergence. */
export function warnUnknownSalesProvince(
  province: string | null | undefined,
  surface: string,
): void {
  const value = (province ?? '').trim()
  if (!value || isKnownSalesProvince(value)) return
  logger.warn('Unknown sales province; using ON 13%', { province: value, surface })
}
