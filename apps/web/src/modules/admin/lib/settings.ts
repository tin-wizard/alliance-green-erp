/**
 * The code-owned settings catalogue. The database stores only values for keys
 * declared here, with the declared type; an unknown key cannot be written.
 */
export type SettingValueType = 'string' | 'number' | 'boolean'

export interface SettingDefinition {
  key: string
  label: string
  description: string
  module: string
  type: SettingValueType
  defaultValue: string | number | boolean
  min?: number
  max?: number
}

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  {
    key: 'company.name',
    label: 'Company name',
    description: 'Trading name shown in the application chrome and generated documents.',
    module: 'company',
    type: 'string',
    defaultValue: 'Alliance Lighting',
  },
  {
    key: 'company.timezone',
    label: 'Business timezone',
    description: 'IANA timezone used for business dates and scheduled reminders.',
    module: 'company',
    type: 'string',
    defaultValue: 'America/Toronto',
  },
  {
    key: 'reports.default_page_size',
    label: 'Default report page size',
    description: 'Rows shown when a report opens. The legacy default is 100.',
    module: 'reports',
    type: 'number',
    defaultValue: 100,
    min: 25,
    max: 500,
  },
  {
    key: 'compliance.expiry_warning_days',
    label: 'Compliance warning window (days)',
    description: 'A current document inside this many days is shown as expiring.',
    module: 'compliance',
    type: 'number',
    defaultValue: 30,
    min: 1,
    max: 365,
  },
] as const

export function settingDefinition(key: string): SettingDefinition | undefined {
  return SETTING_DEFINITIONS.find((definition) => definition.key === key)
}

export function parseSettingValue(
  definition: SettingDefinition,
  raw: unknown,
): string | number | boolean {
  if (definition.type === 'number') {
    const value = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(value)) throw new Error(`${definition.label} must be a number.`)
    if (!Number.isInteger(value)) throw new Error(`${definition.label} must be a whole number.`)
    if (definition.min !== undefined && value < definition.min) {
      throw new Error(`${definition.label} must be at least ${definition.min}.`)
    }
    if (definition.max !== undefined && value > definition.max) {
      throw new Error(`${definition.label} must be at most ${definition.max}.`)
    }
    return value
  }
  if (definition.type === 'boolean') {
    if (typeof raw === 'boolean') return raw
    if (raw === 'true') return true
    if (raw === 'false') return false
    throw new Error(`${definition.label} must be true or false.`)
  }
  if (typeof raw !== 'string') throw new Error(`${definition.label} must be text.`)
  const value = raw.trim()
  if (!value) throw new Error(`${definition.label} cannot be empty.`)
  if (definition.key === 'company.timezone') {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: value })
    } catch {
      throw new Error('Use a valid IANA timezone, e.g. America/Toronto.')
    }
  }
  return value
}
