/**
 * The enumerated TJX part family. This is a constant, not a computed rule:
 * it matches the historical `WIN-` family plus the five loose part numbers.
 */
export const TJX_PART_NUMBERS = ['1240', '10000', '10002', '10003', '10098'] as const

export function normalizeTjxPartNo(value: string): string {
  return value.trim().toUpperCase()
}

export function isTjxPartNo(value: string): boolean {
  const partNo = normalizeTjxPartNo(value)
  return partNo.startsWith('WIN-') || (TJX_PART_NUMBERS as readonly string[]).includes(partNo)
}
