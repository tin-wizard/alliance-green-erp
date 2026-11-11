/**
 * WSIB/insurance validity. Pure and timezone-explicit, matching the legacy rule
 * and the Work Orders adapter: a document counts only when it is not flagged
 * expired and its expiry date is today or later in America/Toronto.
 */
export interface WsibDocument {
  documentType: string | null
  expirationDate: string | null
  isExpired: number | null
}

export function businessToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function validWsibDocument(
  documents: readonly WsibDocument[],
  today: string,
): WsibDocument | null {
  const day = today.slice(0, 10)
  for (const document of documents) {
    if (document.isExpired === 1) continue
    const expiry = (document.expirationDate ?? '').slice(0, 10)
    if (!expiry) continue
    if (expiry >= day) return document
  }
  return null
}
