// STAYS CAPSULE — short-term rentals (Airbnb model), country-neutral.
// Pure functions only: no database, no HTTP, no provider. A country plugs in through its profile
// (currency, timezone, taxes, fees, cancellation rules). See stays/README.md.
import { pct, taxLines, sum, assertMinor } from '../core/money.mjs'
import { parseDate, nightsBetween, todayIn, localMidnight } from '../core/dates.mjs'
import { createMachine } from '../core/state-machine.mjs'

// Booking lifecycle. HOLD = dates reserved while the guest pays; it expires on its own.
export const bookingMachine = createMachine('stay', {
  REQUESTED: ['HOLD', 'DECLINED', 'CANCELLED', 'EXPIRED'],   // request-to-book listings
  HOLD: ['CONFIRMED', 'CANCELLED', 'EXPIRED'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'COMPLETED'],
  CHECKED_IN: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  DECLINED: [],
  EXPIRED: [],
})

// Statuses whose dates block the calendar (a HOLD only while not expired).
export const BLOCKING = Object.freeze(['REQUESTED', 'HOLD', 'CONFIRMED', 'CHECKED_IN'])

// Validate dates and guest count against the listing and the country rules.
// Returns { ok:true, checkIn, checkOut, nights } or { ok:false, code, message }.
export function validateStay({ checkIn, checkOut, guests, listing, profile, now = new Date() }) {
  const s = profile.stays
  const a = parseDate(checkIn)
  const b = parseDate(checkOut)
  if (!a || !b) return { ok: false, code: 'DATE_INVALID', message: 'Dates must look like 2026-12-31.' }
  const nights = nightsBetween(a, b)
  if (nights < 1) return { ok: false, code: 'DATE_ORDER', message: 'Check-out must be after check-in.' }
  if (a < todayIn(profile.timezone, now)) return { ok: false, code: 'DATE_PAST', message: 'Check-in cannot be in the past.' }
  const minN = listing.minNights ?? 1
  const maxN = Math.min(listing.maxNights ?? Infinity, s.maxNights ?? Infinity)
  if (nights < minN) return { ok: false, code: 'MIN_NIGHTS', message: `Minimum stay is ${minN} nights.` }
  if (nights > maxN) return { ok: false, code: 'MAX_NIGHTS', message: `Maximum stay is ${maxN} nights.` }
  if (!Number.isInteger(guests) || guests < 1 || guests > (listing.maxGuests ?? 1)) return { ok: false, code: 'GUESTS', message: `This place hosts up to ${listing.maxGuests} guests.` }
  return { ok: true, checkIn: a, checkOut: b, nights }
}

// Half-open date ranges [start, end) overlap test — check-out day is free for the next check-in.
export const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd

// Whether the requested range is free given existing bookings and host blocks.
export function isAvailable({ checkIn, checkOut, bookings = [], blocks = [], now = new Date() }) {
  const live = bookings.filter((x) => BLOCKING.includes(x.status) && !(x.status === 'HOLD' && x.holdExpiresAt && new Date(x.holdExpiresAt) <= now))
  return ![...live, ...blocks].some((x) => overlaps(checkIn, checkOut, new Date(x.checkIn ?? x.startDate), new Date(x.checkOut ?? x.endDate)))
}

// Server-authoritative price quote. All rates come from profile.stays (prices are variables).
// listing: { nightlyMinor, cleaningMinor?, taxesMinor?, otherFeesMinor?, weeklyDiscountBp?, monthlyDiscountBp? }
// options: { protection } — guest bought the optional cancellation-protection add-on (if offered).
// Two commission styles: 'LODGING' (Airbnb/Québec: % of stay + cleaning) or
// 'TOTAL_EXCL_PROTECTION' (Syria today: % of everything paid except protection).
export function quoteStay({ listing, nights, profile, protection = false, stayMinor }) {
  const { stays, taxes = {}, currencies } = profile
  assertMinor(listing.nightlyMinor, 'nightlyMinor')
  // stayMinor lets a caller pass a stay subtotal priced elsewhere (weekend nights, seasons).
  const gross = Number.isInteger(stayMinor) ? stayMinor : listing.nightlyMinor * nights
  const discountBp = Number.isInteger(stayMinor) ? 0 : nights >= 28 ? listing.monthlyDiscountBp ?? 0 : nights >= 7 ? listing.weeklyDiscountBp ?? 0 : 0
  const discount = pct(gross, discountBp)
  const accommodation = gross - discount
  // An explicit fee of 0 falls back to the country percentage (matches the live Syria formula).
  const cleaning = listing.cleaningMinor || pct(accommodation, stays.fallbackCleaningBp ?? 0)
  const flatTax = listing.taxesMinor || pct(accommodation, stays.fallbackTaxBp ?? 0)
  const otherFees = listing.otherFeesMinor ?? 0
  const lodgingBase = accommodation + cleaning
  const serviceFee = pct(lodgingBase, stays.guestServiceFeeBp ?? 0)
  const protectionMinor = protection && stays.protectionBp ? pct(accommodation, stays.protectionBp) : 0
  const lines = [
    { code: 'ACCOMMODATION', minor: gross, nights, nightlyMinor: listing.nightlyMinor },
    ...(discount ? [{ code: nights >= 28 ? 'MONTHLY_DISCOUNT' : 'WEEKLY_DISCOUNT', minor: -discount, rateBp: discountBp }] : []),
    { code: 'CLEANING', minor: cleaning },
    ...(serviceFee ? [{ code: 'SERVICE_FEE', minor: serviceFee, rateBp: stays.guestServiceFeeBp }] : []),
    ...(otherFees ? [{ code: 'OTHER_FEES', minor: otherFees }] : []),
    ...(protectionMinor ? [{ code: 'PROTECTION', minor: protectionMinor, rateBp: stays.protectionBp }] : []),
  ]
  // Taxes listed under stays.lodgingTaxes apply to the stay only; stays.salesTaxes also cover the fee.
  const lodgingTax = taxLines(lodgingBase, stays.lodgingTaxes ?? [], taxes)
  const salesTax = taxLines(lodgingBase + serviceFee, stays.salesTaxes ?? [], taxes)
  const taxList = [...lodgingTax, ...salesTax, ...(flatTax ? [{ code: 'TAX', label: { en: 'Taxes' }, minor: flatTax }] : [])]
  const taxMinor = sum(taxList)
  const totalMinor = lodgingBase + serviceFee + otherFees + protectionMinor + taxMinor
  const commissionBaseMinor = stays.commissionBase === 'TOTAL_EXCL_PROTECTION' ? totalMinor - protectionMinor : lodgingBase
  const commission = pct(commissionBaseMinor, stays.hostCommissionBp ?? 0)
  return {
    currency: currencies.default,
    nights,
    lines,
    taxes: taxList,
    taxStatus: taxes.status ?? 'NONE',
    subtotalMinor: lodgingBase + serviceFee + otherFees + protectionMinor,
    taxMinor,
    protectionMinor,
    totalMinor,
    host: { grossMinor: commissionBaseMinor, commissionMinor: commission, payoutMinor: commissionBaseMinor - commission },
  }
}

// Guest cancellation refund. Policies come from profile.stays.cancellationPolicies keyed by the
// listing's policy name, e.g. { flexible: [{ hoursBefore: 24, refundBp: 10000 }], ... }: the first
// tier whose cutoff has not passed wins; otherwise refund 0. Service fee refund follows the profile.
export function guestRefund({ booking, policyName, profile, now = new Date() }) {
  if (booking.status === 'HOLD' || booking.status === 'REQUESTED') return { refundMinor: 0, reason: 'NOT_PAID' }
  const tiers = profile.stays.cancellationPolicies?.[policyName ?? profile.stays.defaultPolicy]
  if (!tiers) throw new Error(`cancellation policy '${policyName}' is not defined in the country profile`)
  const checkIn = localMidnight(new Date(booking.checkIn), profile.timezone)
  for (const tier of [...tiers].sort((x, y) => y.hoursBefore - x.hoursBefore)) {
    if (now.getTime() <= checkIn.getTime() - tier.hoursBefore * 3_600_000) {
      return { refundMinor: pct(booking.totalMinor, tier.refundBp), reason: `TIER_${tier.hoursBefore}H`, refundBp: tier.refundBp }
    }
  }
  return { refundMinor: 0, reason: 'PAST_LAST_CUTOFF' }
}

// A host cancellation always refunds the guest in full.
export const hostCancelRefund = (booking) => ({ refundMinor: booking.totalMinor, reason: 'HOST_CANCELLED' })

// Host payout is released profile.stays.payoutHoldDays after check-out of a COMPLETED stay.
export function payoutEligibleAt(booking, profile) {
  if (!booking.checkOut) return null
  return new Date(new Date(booking.checkOut).getTime() + (profile.stays.payoutHoldDays ?? 0) * 86_400_000)
}
export const isPayoutEligible = (booking, profile, now = new Date()) =>
  booking.status === 'COMPLETED' && payoutEligibleAt(booking, profile) <= now

// A HOLD's expiry instant.
export const holdExpiresAt = (profile, now = new Date()) => new Date(now.getTime() + (profile.stays.holdMinutes ?? 30) * 60_000)

// Listing publication rules for the country (e.g. a mandatory registration number).
export function listingProblems(listing, profile) {
  const p = []
  if (!listing.title) p.push('TITLE_REQUIRED')
  if (!Number.isInteger(listing.nightlyMinor) || listing.nightlyMinor <= 0) p.push('PRICE_REQUIRED')
  if (!Number.isInteger(listing.maxGuests) || listing.maxGuests < 1) p.push('MAX_GUESTS_REQUIRED')
  if (profile.stays.requireRegistrationNumber && !listing.registrationNumber) p.push('REGISTRATION_NUMBER_REQUIRED')
  return p
}
