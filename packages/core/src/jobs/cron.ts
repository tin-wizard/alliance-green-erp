/**
 * Five-field cron expressions, evaluated in a named timezone.
 *
 * Supported per field: `*`, `n`, `a-b`, `a,b`, and a step after `*` or after a
 * range (`.../n`). There is no dependency: `Intl.DateTimeFormat` with an
 * explicit `timeZone` is the only DST-aware timezone source Node ships, and
 * `Date` alone is not (ADR 0012 §7).
 *
 * Rules, chosen to match traditional cron where it matters:
 *  - weekday is 0-6 with Sunday 0; 7 is accepted and means Sunday;
 *  - when *both* day-of-month and day-of-week are restricted, a day matches if
 *    either matches, otherwise both must;
 *  - a schedule is evaluated against the local wall clock, so 07:15 is 07:15 in
 *    Toronto on both sides of a daylight-saving change.
 *
 * Two awkward wall clocks are resolved rather than rejected, because a cron
 * expression cannot express them:
 *  - a time that does not exist (spring forward, 02:00-03:00) keeps the same
 *    wall clock shifted by the gap, so once a year a 02:30 job runs at 03:30;
 *  - a time that happens twice (autumn fall back) resolves to the first
 *    occurrence, so nothing runs twice.
 */

/** Raised for an expression that cannot be honoured. Callers treat it as a bug. */
export class CronExpressionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CronExpressionError'
  }
}

export type CronFields = {
  /** Sorted, ascending. */
  minutes: readonly number[]
  hours: readonly number[]
  daysOfMonth: readonly number[]
  months: readonly number[]
  /** 0-6, Sunday 0. */
  daysOfWeek: readonly number[]
  dayOfMonthRestricted: boolean
  dayOfWeekRestricted: boolean
}

type FieldSpec = { name: string; min: number; max: number }

const FIELD_SPECS: readonly FieldSpec[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day-of-month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day-of-week', min: 0, max: 7 },
]

/**
 * How far ahead (and back) the search walks before giving up. Eight years
 * covers 29 February schedules, which can be five years apart.
 */
const MAX_SEARCH_DAYS = 366 * 8

function toInt(text: string, spec: FieldSpec): number {
  if (!/^\d+$/.test(text)) {
    throw new CronExpressionError(`cron field '${spec.name}' has a non-numeric value '${text}'`)
  }
  const value = Number(text)
  if (value < spec.min || value > spec.max) {
    throw new CronExpressionError(
      `cron field '${spec.name}' value ${value} is outside ${spec.min}-${spec.max}`,
    )
  }
  return value
}

function parseField(text: string, spec: FieldSpec): number[] {
  const values = new Set<number>()
  for (const part of text.split(',')) {
    if (part === '') {
      throw new CronExpressionError(`cron field '${spec.name}' has an empty item`)
    }
    const pieces = part.split('/')
    if (pieces.length > 2) {
      throw new CronExpressionError(`cron field '${spec.name}' item '${part}' has two steps`)
    }
    const rangeText = pieces[0] ?? ''
    const stepText = pieces[1]
    const step =
      stepText === undefined
        ? 1
        : toInt(stepText, { name: `${spec.name} step`, min: 1, max: spec.max })

    let start: number
    let end: number
    if (rangeText === '*') {
      start = spec.min
      end = spec.max
    } else if (rangeText.includes('-')) {
      const bounds = rangeText.split('-')
      if (bounds.length !== 2) {
        throw new CronExpressionError(`cron field '${spec.name}' range '${rangeText}' is malformed`)
      }
      start = toInt(bounds[0] ?? '', spec)
      end = toInt(bounds[1] ?? '', spec)
      if (start > end) {
        throw new CronExpressionError(
          `cron field '${spec.name}' range '${rangeText}' runs backwards`,
        )
      }
    } else {
      start = toInt(rangeText, spec)
      // `5/15` means "from 5, every 15, to the top of the field".
      end = stepText === undefined ? start : spec.max
    }
    for (let value = start; value <= end; value += step) values.add(value)
  }
  return [...values].sort((left, right) => left - right)
}

/** Parses and validates a five-field expression. Throws `CronExpressionError`. */
export function parseCron(expression: string): CronFields {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== FIELD_SPECS.length) {
    throw new CronExpressionError(
      `cron expression '${expression}' must have five fields, found ${fields.length}`,
    )
  }
  const [minuteText, hourText, dayOfMonthText, monthText, dayOfWeekText] = fields as [
    string,
    string,
    string,
    string,
    string,
  ]

  const daysOfWeek = new Set<number>()
  for (const value of parseField(dayOfWeekText, FIELD_SPECS[4] as FieldSpec)) {
    daysOfWeek.add(value === 7 ? 0 : value)
  }

  return {
    minutes: parseField(minuteText, FIELD_SPECS[0] as FieldSpec),
    hours: parseField(hourText, FIELD_SPECS[1] as FieldSpec),
    daysOfMonth: parseField(dayOfMonthText, FIELD_SPECS[2] as FieldSpec),
    months: parseField(monthText, FIELD_SPECS[3] as FieldSpec),
    daysOfWeek: [...daysOfWeek].sort((left, right) => left - right),
    dayOfMonthRestricted: dayOfMonthText !== '*',
    dayOfWeekRestricted: dayOfWeekText !== '*',
  }
}

/** The wall clock a `Date` shows in `timeZone`. */
export type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/**
 * Cached formatter per zone. `hourCycle: 'h23'` matters: the default for en-GB
 * is `h24`, which renders midnight as 24 instead of 00 and would move a
 * midnight job a day.
 */
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone)
  if (cached) return cached
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    throw new CronExpressionError(`unknown timezone '${timeZone}'`)
  }
  formatters.set(timeZone, formatter)
  return formatter
}

/** Throws `CronExpressionError` for a zone the runtime does not know. */
export function assertTimeZone(timeZone: string): void {
  formatterFor(timeZone)
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const collected = new Map<string, number>()
  for (const part of formatterFor(timeZone).formatToParts(date)) {
    if (part.type === 'literal') continue
    collected.set(part.type, Number(part.value))
  }
  const read = (type: string): number => {
    const value = collected.get(type)
    if (value === undefined || Number.isNaN(value)) {
      throw new CronExpressionError(`could not read '${type}' in timezone '${timeZone}'`)
    }
    return value
  }
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  }
}

/** `YYYY-MM-DD` as the clock in `timeZone` reads it. */
export function businessDateFor(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone)
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(
    parts.day,
  ).padStart(2, '0')}`
}

/**
 * The offset of `timeZone` at `instantMs`, in milliseconds to add to UTC.
 *
 * Derived by reading the instant's wall clock back as if it were UTC: the
 * difference is exactly the offset, and it needs no table and no dependency.
 */
function zoneOffsetMs(timeZone: string, instantMs: number): number {
  const parts = zonedParts(new Date(instantMs), timeZone)
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )
  return asUtc - Math.floor(instantMs / 1000) * 1000
}

/** Calendar-only addition, so the result never depends on the host clock. */
function addDays(
  date: { year: number; month: number; day: number },
  days: number,
): {
  year: number
  month: number
  day: number
} {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/**
 * The instant a wall clock reading describes.
 *
 * Two passes: guess with the offset that applies when the wall time is read as
 * UTC, then correct with the offset at the guess. Each guess is verified by
 * formatting it back, which is what tells a real wall time from one skipped by
 * a spring-forward gap.
 */
function instantFor(
  day: { year: number; month: number; day: number },
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const wall = Date.UTC(day.year, day.month - 1, day.day, hour, minute, 0, 0)
  const showsWallClock = (instantMs: number): boolean => {
    const back = zonedParts(new Date(instantMs), timeZone)
    return (
      back.year === day.year &&
      back.month === day.month &&
      back.day === day.day &&
      back.hour === hour &&
      back.minute === minute
    )
  }

  const guess = wall - zoneOffsetMs(timeZone, wall)
  if (showsWallClock(guess)) return new Date(guess)

  const refined = wall - zoneOffsetMs(timeZone, guess)
  if (showsWallClock(refined)) return new Date(refined)

  // Inside a spring-forward gap: keep the same wall clock shifted by the gap.
  return new Date(guess)
}

function dayMatches(
  fields: CronFields,
  day: { year: number; month: number; day: number },
): boolean {
  if (!fields.months.includes(day.month)) return false
  const dayOfMonthMatch = fields.daysOfMonth.includes(day.day)
  const dayOfWeekMatch = fields.daysOfWeek.includes(weekdayOf(day.year, day.month, day.day))
  if (fields.dayOfMonthRestricted && fields.dayOfWeekRestricted) {
    return dayOfMonthMatch || dayOfWeekMatch
  }
  return dayOfMonthMatch && dayOfWeekMatch
}

/**
 * The first slot strictly after `after`.
 *
 * Throws `CronExpressionError` if the expression is valid but unsatisfiable
 * (31 February) — better a loud configuration error than a job that silently
 * never runs.
 */
export function nextOccurrence(expression: string, timeZone: string, after: Date): Date {
  const fields = parseCron(expression)
  const afterMs = after.getTime()
  const start = zonedParts(after, timeZone)
  const startDay = { year: start.year, month: start.month, day: start.day }

  for (let offset = 0; offset <= MAX_SEARCH_DAYS; offset += 1) {
    const day = addDays(startDay, offset)
    if (!dayMatches(fields, day)) continue
    for (const hour of fields.hours) {
      for (const minute of fields.minutes) {
        const candidate = instantFor(day, hour, minute, timeZone)
        if (candidate.getTime() > afterMs) return candidate
      }
    }
  }
  throw new CronExpressionError(
    `cron expression '${expression}' has no occurrence within ${MAX_SEARCH_DAYS} days`,
  )
}

/**
 * The last slot at or before `at`, or `null` when the expression never matches.
 *
 * Walks backwards exactly as `nextOccurrence` walks forwards, which keeps a
 * one-minute job cheap: the answer is usually on the first day inspected.
 */
export function previousOccurrence(expression: string, timeZone: string, at: Date): Date | null {
  const fields = parseCron(expression)
  const atMs = at.getTime()
  const start = zonedParts(at, timeZone)
  const startDay = { year: start.year, month: start.month, day: start.day }

  for (let offset = 0; offset <= MAX_SEARCH_DAYS; offset += 1) {
    const day = addDays(startDay, -offset)
    if (!dayMatches(fields, day)) continue
    for (let hourIndex = fields.hours.length - 1; hourIndex >= 0; hourIndex -= 1) {
      const hour = fields.hours[hourIndex] as number
      for (let minuteIndex = fields.minutes.length - 1; minuteIndex >= 0; minuteIndex -= 1) {
        const minute = fields.minutes[minuteIndex] as number
        const candidate = instantFor(day, hour, minute, timeZone)
        if (candidate.getTime() <= atMs) return candidate
      }
    }
  }
  return null
}

/** True when `date` is a slot of the expression in `timeZone`. */
export function isOccurrence(expression: string, timeZone: string, date: Date): boolean {
  const fields = parseCron(expression)
  const parts = zonedParts(date, timeZone)
  if (!fields.minutes.includes(parts.minute)) return false
  if (!fields.hours.includes(parts.hour)) return false
  return dayMatches(fields, { year: parts.year, month: parts.month, day: parts.day })
}
