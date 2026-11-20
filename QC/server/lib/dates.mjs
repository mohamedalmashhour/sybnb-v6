// Québec-local calendar dates — a thin adapter over the country-neutral wrapping/core/dates helpers
// (one base, owner direction 2026-11-20). Stay dates are plain 'YYYY-MM-DD' strings stored as
// Postgres DATE; instants (cancellation cutoffs, scheduled rides) use the profile's IANA timezone.
import { badRequest } from './http.mjs'
import * as core from '../../../wrapping/core/dates.mjs'

export function parseDate(value, field) {
  const d = core.parseDate(value)
  if (!d) throw badRequest('FIELD_INVALID', `${field} must be a date like 2026-12-31.`, { field })
  return d
}

export const toDateString = core.toDateString
export const nightsBetween = core.nightsBetween

export function todayIn(timezone, now = new Date()) {
  return core.todayIn(timezone, now)
}

export const localMidnight = core.localMidnight
