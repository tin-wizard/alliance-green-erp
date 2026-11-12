/**
 * Parity: every group states its anchors as SQL, the harness runs them against
 * staging (old) and `app` (new) on the same database, and the report says match
 * or differ. Anchors are data in each transformer so a new module brings its own
 * proof instead of editing this file.
 */
import { sql } from 'drizzle-orm'
import type { Db } from '@cls/db'
import { GROUPS } from './manifest'
import { loadGroupTransformer } from './runner'
import type { ParityAnchor } from './types'

export interface AnchorResult {
  group: string
  label: string
  mode: 'compare' | 'oldOnly'
  oldValue: string | null
  newValue: string | null
  match: boolean
  error: string | null
}

/** Staging holds every dump ever loaded; an anchor must read exactly one. */
export function scopeToDump(query: string, dumpId: string): string {
  const literal = dumpId.replace(/'/g, "''")
  return query.replace(
    /migration\."(stg_[a-z0-9_]+)"/g,
    (_match, table: string) =>
      `(select * from migration."${table}" where "_dump_id" = '${literal}')`,
  )
}

export interface ParityReport {
  total: number
  matched: number
  differed: number
  errored: number
  anchors: AnchorResult[]
}

async function queryValue(db: Db, query: string): Promise<string | null> {
  const rows = (await db.execute(sql.raw(query))) as unknown as Array<Record<string, unknown>>
  if (rows.length === 0) return null
  const first = rows[0]!
  if (Object.keys(first).length === 1) {
    const value = Object.values(first)[0]
    return value === null || value === undefined ? null : String(value)
  }
  return JSON.stringify(rows, (_key, value) => (typeof value === 'bigint' ? String(value) : value))
}

/** `1234.5` and `1234.50` are the same money; `1234` and `1235` are not. */
export function sameValue(oldValue: string | null, newValue: string | null): boolean {
  if (oldValue === null || newValue === null) return oldValue === newValue
  const oldNumber = Number(oldValue)
  const newNumber = Number(newValue)
  if (
    oldValue.trim() !== '' &&
    newValue.trim() !== '' &&
    Number.isFinite(oldNumber) &&
    Number.isFinite(newNumber)
  ) {
    return oldNumber === newNumber
  }
  return oldValue === newValue
}

/**
 * A rehearsal runs against a database that already has data. The honest question
 * is "what did this dump add", so the new side is measured as a delta from the
 * baseline taken before the import. On a fresh target the baseline is zero and
 * the delta is the absolute count.
 */
export type Baseline = Map<string, string | null>

export function anchorKey(anchor: Pick<ParityAnchor, 'group' | 'label'>): string {
  return `${anchor.group}::${anchor.label}`
}

function asNumber(value: string | null): number | null {
  if (value === null) return null
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Numeric delta, or a per-key delta for a `[{ status, rows }]` histogram. */
export function deltaValue(after: string | null, before: string | null): string | null {
  if (after === null || before === null) return after
  const afterNumber = asNumber(after)
  const beforeNumber = asNumber(before)
  if (afterNumber !== null && beforeNumber !== null) {
    const difference = afterNumber - beforeNumber
    // Integer counts print as integers; money keeps its decimals.
    return Number.isInteger(difference) ? String(difference) : difference.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  }
  try {
    const afterJson = JSON.parse(after) as unknown
    const beforeJson = JSON.parse(before) as unknown
    if (Array.isArray(afterJson) && Array.isArray(beforeJson)) {
      const beforeByKey = new Map<string, number>()
      for (const entry of beforeJson) {
        if (entry && typeof entry === 'object') {
          const record = entry as Record<string, unknown>
          const key = String(record.status ?? record.key ?? JSON.stringify(entry))
          const rows = asNumber(String(record.rows ?? record.value ?? ''))
          if (rows !== null) beforeByKey.set(key, rows)
        }
      }
      return JSON.stringify(
        afterJson.map((entry) => {
          if (!entry || typeof entry !== 'object') return entry
          const record = { ...(entry as Record<string, unknown>) }
          const key = String(record.status ?? record.key ?? JSON.stringify(entry))
          const rows = asNumber(String(record.rows ?? record.value ?? ''))
          if (rows !== null) {
            const previous = beforeByKey.get(key) ?? 0
            if ('rows' in record) record.rows = rows - previous
            else if ('value' in record) record.value = rows - previous
          }
          return record
        }),
      )
    }
  } catch {
    // Not JSON; fall through to the raw value.
  }
  return after
}

export async function collectAnchors(groups?: string[]): Promise<ParityAnchor[]> {
  const anchors: ParityAnchor[] = []
  for (const group of GROUPS) {
    if (groups && !groups.includes(group.name)) continue
    const transformer = await loadGroupTransformer(group)
    for (const anchor of transformer?.parity ?? []) {
      anchors.push({ ...anchor, group: anchor.group || group.name })
    }
  }
  return anchors
}

export async function captureBaseline(
  db: Db,
  options: { dumpId: string; anchors?: ParityAnchor[]; groups?: string[] } = { dumpId: '' },
): Promise<Baseline> {
  const anchors = options.anchors ?? (await collectAnchors(options.groups))
  const baseline: Baseline = new Map()
  for (const anchor of anchors) {
    if ((anchor.mode ?? 'compare') !== 'compare') continue
    try {
      baseline.set(anchorKey(anchor), await queryValue(db, anchor.newSql))
    } catch {
      baseline.set(anchorKey(anchor), null)
    }
  }
  return baseline
}

export async function runParity(
  db: Db,
  options: {
    dumpId: string
    groups?: string[]
    anchors?: ParityAnchor[]
    /** Values captured before the import; when present the new side is a delta. */
    baseline?: Baseline
  },
): Promise<ParityReport> {
  const anchors = options.anchors ?? (await collectAnchors(options.groups))
  const results: AnchorResult[] = []

  for (const anchor of anchors) {
    const mode = anchor.mode ?? 'compare'
    let oldValue: string | null = null
    let newValue: string | null = null
    let error: string | null = null
    try {
      oldValue = await queryValue(db, scopeToDump(anchor.oldSql, options.dumpId))
      if (mode === 'compare') {
        const after = await queryValue(db, anchor.newSql)
        newValue = options.baseline
          ? deltaValue(after, options.baseline.get(anchorKey(anchor)) ?? null)
          : after
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    }
    results.push({
      group: anchor.group,
      label: anchor.label,
      mode,
      oldValue,
      newValue,
      match: error === null && (mode === 'oldOnly' || sameValue(oldValue, newValue)),
      error,
    })
  }

  const compared = results.filter((result) => result.mode === 'compare')
  return {
    total: results.length,
    matched: compared.filter((result) => result.match).length,
    differed: compared.filter((result) => !result.match && result.error === null).length,
    errored: results.filter((result) => result.error !== null).length,
    anchors: results,
  }
}

export function parityMarkdown(report: ParityReport): string {
  const lines: string[] = []
  lines.push('# Parity anchors')
  lines.push('')
  lines.push(
    `${report.matched} matched, ${report.differed} differed, ${report.errored} errored, of ${report.total} anchors.`,
  )
  lines.push('')
  lines.push('| Group | Anchor | Old (staging) | New (app) | Result |')
  lines.push('|---|---|---:|---:|---|')
  for (const anchor of report.anchors) {
    const result = anchor.error
      ? `error: ${anchor.error}`
      : anchor.mode === 'oldOnly'
        ? 'counted'
        : anchor.match
          ? 'match'
          : 'DIFFERS'
    lines.push(
      `| ${anchor.group} | ${anchor.label} | ${anchor.oldValue ?? 'null'} | ${anchor.newValue ?? '-'} | ${result} |`,
    )
  }
  return `${lines.join('\n')}\n`
}
