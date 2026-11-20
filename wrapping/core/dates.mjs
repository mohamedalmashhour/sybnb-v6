// Country-neutral calendar helpers. Stay dates are plain 'YYYY-MM-DD' strings; instants such as a
// cancellation cutoff are computed in the country's IANA timezone (profile.timezone).

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

// Returns a UTC-midnight Date, or null when the string is not a real calendar date.
export function parseDate(value) {
  const m = typeof value === 'string' ? DATE_RE.exec(value) : null
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null
  return d && d.toISOString().slice(0, 10) === value ? d : null
}

export const toDateString = (d) => d.toISOString().slice(0, 10)
export const nightsBetween = (checkIn, checkOut) => Math.round((checkOut - checkIn) / DAY_MS)

// Today's calendar date in the zone, as a UTC-midnight Date.
export function todayIn(timezone, now = new Date()) {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  return parseDate(s)
}

function zoneOffsetMs(timezone, instant) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(instant).map((p) => [p.type, p.value]),
  )
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

// The instant at which local midnight of `date` (a UTC-midnight Date) happens in the zone.
export function localMidnight(date, timezone) {
  const guess = new Date(date.getTime() - zoneOffsetMs(timezone, date))
  return new Date(date.getTime() - zoneOffsetMs(timezone, guess))
}
