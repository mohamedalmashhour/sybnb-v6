// Server-authoritative CAD pricing for stays and rides — now a thin adapter over the country-neutral
// capsules in wrapping/ (one base, owner direction 2026-11-20) configured by the Canada settings.
// Integer cents only; each line rounds half-up once, totals are sums of the rounded lines.
// The response shapes below are unchanged for the QC routes and apps (fields named *Cents).
// ⚠️ Prices are variables: rates live in countries/canada/profile.mjs, never in this file.
import { pct as capsulePct } from '../../../wrapping/core/money.mjs'
import { haversineM as capsuleHaversineM } from '../../../wrapping/core/geo.mjs'
import { quoteStay } from '../../../wrapping/stays/index.mjs'
import { quoteRide } from '../../../wrapping/rides/index.mjs'
import { toCapsuleProfile } from '../../../countries/canada/capsules.profile.mjs'

export const pct = capsulePct
export const haversineM = capsuleHaversineM

const capsuleCache = new WeakMap()
const capsuleFor = (profile) => {
  if (!capsuleCache.has(profile)) capsuleCache.set(profile, toCapsuleProfile(profile))
  return capsuleCache.get(profile)
}
const taxToCents = (t) => ({ code: t.code, label: t.label, rateBp: t.rateBp, baseCents: t.baseMinor, cents: t.minor })

export function stayQuote({ listing, nights, profile }) {
  const cp = capsuleFor(profile)
  const q = quoteStay({ listing: { nightlyMinor: listing.nightlyCents, cleaningMinor: listing.cleaningCents }, nights, profile: cp })
  const line = (code) => q.lines.find((l) => l.code === code)?.minor || 0
  return {
    currency: q.currency,
    lines: [
      { code: 'ACCOMMODATION', cents: line('ACCOMMODATION'), nights, nightlyCents: listing.nightlyCents },
      { code: 'CLEANING', cents: line('CLEANING') },
      { code: 'SERVICE_FEE', cents: line('SERVICE_FEE'), rateBp: cp.stays.guestServiceFeeBp },
    ],
    taxes: q.taxes.map(taxToCents),
    taxStatus: q.taxStatus,
    subtotalCents: q.subtotalMinor,
    taxCents: q.taxMinor,
    totalCents: q.totalMinor,
    host: { grossCents: q.host.grossMinor, commissionCents: q.host.commissionMinor, payoutCents: q.host.payoutMinor },
  }
}

export function rideQuote({ pickup, dropoff, category, profile, surgeBp = 10_000 }) {
  const q = quoteRide({ pickup, dropoff, category, profile: capsuleFor(profile), surge: surgeBp })
  const fare = q.lines.find((l) => l.code === 'FARE')
  const booking = q.lines.find((l) => l.code === 'BOOKING_FEE')
  return {
    distanceM: q.distanceM,
    durationS: q.durationS,
    breakdown: {
      currency: q.currency,
      estimate: q.estimate,
      lines: [
        { code: 'FARE', cents: fare.minor, surgeBp: fare.surgeBp, minimumApplied: fare.minimumApplied },
        { code: 'BOOKING_FEE', cents: booking.minor },
      ],
      taxes: q.taxes.map(taxToCents),
      taxStatus: q.taxStatus,
      taxCents: q.taxMinor,
      totalCents: q.totalMinor,
      driver: { grossCents: q.driver.grossMinor, commissionCents: q.driver.commissionMinor, payoutCents: q.driver.payoutMinor },
    },
    totalCents: q.totalMinor,
  }
}
