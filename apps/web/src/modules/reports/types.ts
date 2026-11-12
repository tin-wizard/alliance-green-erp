/** Report catalogue and shared view types. */
import { z } from 'zod'

export const REPORT_KEYS = [
  'client-invoices',
  'client-outstanding',
  'work-orders',
  'site-visits',
  'parts-stock',
] as const

export type ReportKey = (typeof REPORT_KEYS)[number]

export const REPORT_PAGE_SIZE_DEFAULT = 100
export const REPORT_PAGE_SIZE_MAX = 500
export const REPORT_EXPORT_ROW_LIMIT = 5000

/**
 * The legacy customer family was fifteen near-identical PHP pages. It is one
 * report with a client preset; the pattern is matched against
 * `app.customers.name`.
 */
export const CLIENT_PRESETS = [
  { key: 'all', label: 'All clients', patterns: [] },
  { key: 'bell', label: 'Bell Mobility', patterns: ['Bell Mobility Inc%'] },
  { key: 'telus', label: 'Telus / Koodo', patterns: ['Telus%', 'Koodo%'] },
  { key: 'tjx', label: 'TJX', patterns: ['TJX%'] },
  { key: 'tjx-pma', label: 'TJX PMA', patterns: ['TJX%'], workOrderFlag: 'isPmaOrder' },
  { key: 'tjx-projects', label: 'TJX Projects', patterns: ['TJX%'], workOrderFlag: 'isProject' },
  { key: 'easyhome', label: 'easyHome', patterns: ['easyHome%'] },
  { key: 'thesource', label: 'The Source', patterns: ['The Source%'] },
  { key: 'bbe', label: 'BBE', patterns: ['BBE%'] },
  { key: 'bdi', label: 'BDI', patterns: ['BDI%', 'B.D.I.%'] },
  { key: 'tbs', label: 'TBS', patterns: ['TBS%'] },
  { key: 'goeasy', label: 'GoEasy', patterns: ['GoEasy%'] },
  { key: 'mobileklinik', label: 'Mobile Klinik', patterns: ['Mobile Klinik%'] },
] as const

export type ClientPresetKey = (typeof CLIENT_PRESETS)[number]['key']

export interface ClientPreset {
  key: ClientPresetKey
  label: string
  patterns: readonly string[]
  workOrderFlag?: 'isPmaOrder' | 'isProject'
}

export const REPORT_TITLES: Record<ReportKey, string> = {
  'client-invoices': 'Client invoices',
  'client-outstanding': 'Client outstanding work',
  'work-orders': 'Work-order summary',
  'site-visits': 'Site visits',
  'parts-stock': 'Parts stock',
}

export const SERVICE_SCOPES = ['all', 'work', 'maintenance'] as const
export type ServiceScope = (typeof SERVICE_SCOPES)[number]

export const STOCK_SCOPES = ['all', 'in-stock', 'low', 'out'] as const
export type StockScope = (typeof STOCK_SCOPES)[number]

export type ReportColumnFormat = 'text' | 'date' | 'money' | 'number'

export interface ReportColumn {
  key: string
  label: string
  format: ReportColumnFormat
  align: 'left' | 'right'
}

export interface ReportRequest {
  key: ReportKey
  client: ClientPresetKey
  startDate?: string
  endDate?: string
  serviceScope: ServiceScope
  province: string
  category: 'all' | 'local' | 'project'
  search: string
  stockScope: StockScope
  page: number
  pageSize: number
}

export interface ReportResult {
  key: ReportKey
  title: string
  subtitle: string
  generatedOn: string
  filters: string[]
  columns: ReportColumn[]
  rows: Record<string, string>[]
  totals: Record<string, string> | null
  totalRows: number
  page: number
  pageSize: number
}

export interface ReportExportResult {
  fileName: string
  contentType: string
  base64: string
  rowCount: number
  truncated: boolean
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')

export const reportRequestSchema = z.object({
  key: z.enum(REPORT_KEYS),
  client: z.enum(CLIENT_PRESETS.map((preset) => preset.key) as [ClientPresetKey, ...ClientPresetKey[]]).default('all'),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  serviceScope: z.enum(SERVICE_SCOPES).default('all'),
  province: z.string().trim().max(3).default(''),
  category: z.enum(['all', 'local', 'project']).default('all'),
  search: z.string().trim().max(120).default(''),
  stockScope: z.enum(STOCK_SCOPES).default('all'),
  page: z.number().int().min(1).default(1),
  pageSize: z
    .number()
    .int()
    .min(1)
    .default(REPORT_PAGE_SIZE_DEFAULT)
    .transform((value) => Math.min(value, REPORT_PAGE_SIZE_MAX)),
})

export const reportExportSchema = reportRequestSchema.extend({
  format: z.enum(['pdf', 'xlsx']),
})

export type ReportExportRequest = z.infer<typeof reportExportSchema>

export function clientPreset(key: ClientPresetKey): ClientPreset {
  return (
    (CLIENT_PRESETS.find((preset) => preset.key === key) as ClientPreset | undefined) ??
    CLIENT_PRESETS[0]
  )
}
