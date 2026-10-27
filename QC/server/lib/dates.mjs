// Québec-local calendar dates. Stay dates are plain 'YYYY-MM-DD' strings stored as Postgres DATE;
// instants (cancellation cutoffs, scheduled rides) are computed in the profile's IANA timezone.
import { badRequest } from './http.mjs'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

export function parseDate(value, field) {
  const m = typeof value === 'string' ? DATE_RE.exec(value) : null
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null
  if (!d || d.toISOString().slice(0, 10) !== value) throw badRequest('FIELD_INVALID', `${field} must be a date like 2026-12-31.`, { field })
  return d
}

export const toDateString = (d) => d.toISOString().slice(0, 10)
export const nightsBetween = (checkIn, checkOut) => Math.round((checkOut - checkIn) / DAY_MS)

// Today's calendar date in the zone, as a UTC-midnight Date (comparable to parsed dates).
export function todayIn(timezone, now = new Date()) {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  return parseDate(s, 'today')
}

// Offset (ms) of the zone from UTC at the given instant.
function zoneOffsetMs(timezone, instant) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(instant).map((p) => [p.type, p.value]),
  )
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

// The instant at which local midnight of `date` (UTC-midnight Date) occurs in the zone.
export function localMidnight(date, timezone) {
  const guess = new Date(date.getTime() - zoneOffsetMs(timezone, date))
  return new Date(date.getTime() - zoneOffsetMs(timezone, guess))
}
