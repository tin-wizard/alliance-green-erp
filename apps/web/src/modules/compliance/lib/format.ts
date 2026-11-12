/** Human wording for a document or warranty's remaining days. */
export function complianceWindowLabel(days: number): string {
  if (days < 0) return `expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`
  if (days === 0) return 'expires today'
  return `${days} day${days === 1 ? '' : 's'} left`
}
