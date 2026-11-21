// RIDES CAPSULE — on-demand rides (Uber model), country-neutral.
// Pure functions only: no database, no HTTP, no provider. A country plugs in through its profile
// (currency, categories, fares, surge cap, cancellation and no-show rules, service area).
import { pct, taxLines, sum } from '../core/money.mjs'
import { haversineM, inBounds, isPoint } from '../core/geo.mjs'
import { createMachine } from '../core/state-machine.mjs'

export const tripMachine = createMachine('ride', {
  PAYMENT_PENDING: ['REQUESTED', 'CANCELLED'],
  REQUESTED: ['ACCEPTED', 'CANCELLED', 'NO_DRIVER'],
  ACCEPTED: ['ARRIVED', 'REQUESTED', 'CANCELLED'],   // back to REQUESTED when the driver drops it
  ARRIVED: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
  NO_DRIVER: [],
})
export const ACTIVE = Object.freeze(['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'])

// Validate pickup / drop-off against the country's service area.
export function validateTrip({ pickup, dropoff, stops = [], profile }) {
  const r = profile.rides
  for (const [name, p] of [['pickup', pickup], ['dropoff', dropoff], ...stops.map((s, i) => [`stop${i + 1}`, s])]) {
    if (!isPoint(p)) return { ok: false, code: 'POINT_INVALID', field: name }
    if (!inBounds(p, r.serviceBounds)) return { ok: false, code: 'OUT_OF_SERVICE_AREA', field: name }
  }
  if (stops.length > (r.maxStops ?? 0)) return { ok: false, code: 'TOO_MANY_STOPS' }
  if (haversineM(pickup, dropoff) < (r.minTripMeters ?? 200) && !stops.length) return { ok: false, code: 'TRIP_TOO_SHORT' }
  return { ok: true }
}

// Distance/duration estimate. When a routing provider gives real numbers, pass them in `route`.
export function estimateRoute({ pickup, dropoff, stops = [], profile, route }) {
  if (route && Number.isFinite(route.distanceM) && Number.isFinite(route.durationS)) return { distanceM: Math.round(route.distanceM), durationS: Math.round(route.durationS), estimate: 'ROUTED' }
  const pts = [pickup, ...stops, dropoff]
  let straight = 0
  for (let i = 1; i < pts.length; i++) straight += haversineM(pts[i - 1], pts[i])
  const distanceM = Math.round(straight * (profile.rides.roadFactor ?? 1.3))
  const durationS = Math.round((distanceM / 1000 / (profile.rides.estimatedKmh ?? 30)) * 3600)
  return { distanceM, durationS, estimate: 'STRAIGHT_LINE_X_ROAD_FACTOR' }
}

// Surge from live demand: ratio of open requests to online drivers, capped by the country.
export function surgeBp({ openRequests, onlineDrivers, profile }) {
  const cap = profile.rides.maxSurgeBp ?? 10_000
  if (!onlineDrivers) return cap
  const ratio = openRequests / onlineDrivers
  if (ratio <= 1) return 10_000
  return Math.min(cap, Math.round(10_000 + (ratio - 1) * 2_500))
}

// Server-authoritative fare quote for one category.
// options: { pet } adds the country's pet fee (taxed like the fare, paid in full to the driver).
// A country may set rides.regulatoryFee { minor, taxable } — a per-trip government levy collected for
// remittance (not platform or driver revenue). Both are country settings, never hard-coded here.
export function quoteRide({ pickup, dropoff, stops = [], category, profile, surge = 10_000, route, options = {} }) {
  const { rides, taxes = {}, currencies } = profile
  const c = rides.categories[category]
  if (!c) throw new Error(`ride category '${category}' is not offered in this country`)
  const { distanceM, durationS, estimate } = estimateRoute({ pickup, dropoff, stops, profile, route })
  const s = Math.min(Math.max(surge, 10_000), rides.maxSurgeBp ?? 10_000)
  const metered = c.baseMinor + Math.round((distanceM / 1000) * c.perKmMinor) + Math.round((durationS / 60) * c.perMinMinor)
  const fare = pct(Math.max(metered, c.minimumMinor), s)
  const stopsFee = stops.length * (rides.perStopMinor ?? 0)
  const booking = rides.bookingFeeMinor ?? 0
  const petFee = options.pet ? (rides.options?.petFeeMinor ?? 0) : 0
  const levy = rides.regulatoryFee?.minor ?? 0
  const levyTaxable = Boolean(rides.regulatoryFee?.taxable)
  const tax = taxLines(fare + stopsFee + booking + petFee + (levyTaxable ? levy : 0), rides.taxes ?? [], taxes)
  const taxMinor = sum(tax)
  const commission = pct(fare + stopsFee, rides.driverCommissionBp ?? 0)
  const total = fare + stopsFee + booking + petFee + levy + taxMinor
  return {
    currency: currencies.default,
    category,
    distanceM,
    durationS,
    estimate,
    lines: [
      { code: 'FARE', minor: fare, surgeBp: s, minimumApplied: metered < c.minimumMinor },
      ...(stopsFee ? [{ code: 'STOPS', minor: stopsFee, stops: stops.length }] : []),
      { code: 'BOOKING_FEE', minor: booking },
      ...(petFee ? [{ code: 'PET_FEE', minor: petFee }] : []),
      ...(levy ? [{ code: 'REGULATORY_FEE', minor: levy, taxable: levyTaxable }] : []),
    ],
    taxes: tax,
    taxStatus: taxes.status ?? 'NONE',
    taxMinor,
    totalMinor: total,
    driver: { grossMinor: fare + stopsFee + petFee, commissionMinor: commission, payoutMinor: fare + stopsFee + petFee - commission },
    governmentMinor: levy,
  }
}

// Quotes for every category the country offers, cheapest first (the rider's choice screen).
export function quoteAll(args) {
  return Object.keys(args.profile.rides.categories).map((category) => quoteRide({ ...args, category })).sort((a, b) => a.totalMinor - b.totalMinor)
}

// Rider cancellation fee (Uber-aligned): free before a driver accepts and within the grace window
// after acceptance; then cancelPercent of the fare; after the driver arrived, the no-show percent.
// Never below minCancelFeeMinor and never above the fare.
export function riderCancelFee({ status, fareMinor, acceptedAt, profile, now = new Date() }) {
  const r = profile.rides.cancellation ?? {}
  const clamp = (fee) => (fee <= 0 ? 0 : Math.min(Math.max(fee, r.minFeeMinor ?? 0), fareMinor))
  if (status === 'PAYMENT_PENDING' || status === 'REQUESTED') return { feeMinor: 0, reason: 'BEFORE_ACCEPT' }
  if (status === 'ARRIVED') return { feeMinor: clamp(pct(fareMinor, (r.noShowPercent ?? 100) * 100)), reason: 'AFTER_ARRIVAL' }
  if (status === 'ACCEPTED') {
    const graceMs = (r.graceSeconds ?? 120) * 1000
    if (acceptedAt && now - new Date(acceptedAt) <= graceMs) return { feeMinor: 0, reason: 'GRACE' }
    return { feeMinor: clamp(pct(fareMinor, (r.feePercent ?? 15) * 100)), reason: 'LATE_CANCEL' }
  }
  return { feeMinor: null, reason: 'NOT_CANCELLABLE' }
}

// No-show: allowed only after the wait window ends and when the driver is near the pickup.
export function canMarkNoShow({ arrivedAt, driverAt, pickup, profile, now = new Date() }) {
  const r = profile.rides.cancellation ?? {}
  const waited = arrivedAt && now - new Date(arrivedAt) >= (r.waitMinutes ?? 5) * 60_000
  const near = isPoint(driverAt) && haversineM(driverAt, pickup) <= (r.arrivalRadiusM ?? 300)
  return { ok: Boolean(waited && near), waited: Boolean(waited), near }
}

// Driver matching: online, same category, not busy, within the search radius — nearest first,
// rating as tie-breaker. drivers: [{ id, online, busy, category, at:{lat,lng}, rating }].
export function rankDrivers({ pickup, category, drivers, profile }) {
  const radius = profile.rides.searchRadiusM ?? 8_000
  return drivers
    .filter((d) => d.online && !d.busy && d.category === category && isPoint(d.at))
    .map((d) => ({ ...d, distanceM: Math.round(haversineM(d.at, pickup)) }))
    .filter((d) => d.distanceM <= radius)
    .sort((a, b) => a.distanceM - b.distanceM || (b.rating ?? 0) - (a.rating ?? 0))
}

// Pickup ETA (seconds) for a ranked driver.
export const pickupEtaS = (driver, profile) => Math.round(((driver.distanceM * (profile.rides.roadFactor ?? 1.3)) / 1000 / (profile.rides.estimatedKmh ?? 30)) * 3600)
