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
  // Government money (taxes whose country setting names an account, e.g. Québec LODGING_TAX and
  // GST_QST): collected from the guest, held by the company in that account, paid to the government
  // — never part of the host payout or the platform revenue.
  const govTaxes = taxList.filter((t) => t.account && t.minor > 0)
  const governmentCharges = govTaxes.length
    ? { taxes: govTaxes.map(({ code, account, baseMinor, rateBp, minor }) => ({ code, account, baseMinor, rateBp, minor })), totalMinor: sum(govTaxes), status: taxes.status ?? 'NONE' }
    : null
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
    ...(governmentCharges ? { governmentCharges, serviceFeeMinor: serviceFee } : {}),
  }
}

// Guest cancellation refund — rules are country settings (profile.stays.cancellationPolicies).
// A policy is either a list of tiers or { tiers, afterLastTierBp, protected }:
//   tiers: [{ hoursBefore, refundBp, strict? }] — refundBp applies while now is at/before
//          (check-in local midnight - hoursBefore); strict: true means strictly before.
//   afterLastTierBp: refund once every tier has passed (Syria: 50%; Airbnb strict: 0).
//   protected: the same shape, used when the guest bought the protection add-on; the protection
//              fee itself is never refunded to a guest who cancels.
// startMs lets the caller supply the check-in start instant (else local midnight in profile.timezone).
export function policyFor(profile, policyName) {
  const raw = profile.stays.cancellationPolicies?.[policyName ?? profile.stays.defaultPolicy]
  if (!raw) throw new Error(`cancellation policy '${policyName ?? profile.stays.defaultPolicy}' is not defined in the country profile`)
  return Array.isArray(raw) ? { tiers: raw, afterLastTierBp: 0 } : raw
}

function refundBpAt(rules, startMs, nowMs, cutoffHoursOverride) {
  const tiers = [...(rules.tiers || [])].sort((x, y) => y.hoursBefore - x.hoursBefore)
  if (startMs == null) return { refundBp: tiers[0]?.refundBp ?? rules.afterLastTierBp ?? 0, tier: 'NO_DATE', deadlineMs: null }
  for (let i = 0; i < tiers.length; i++) {
    const hours = i === 0 && Number.isFinite(cutoffHoursOverride) ? cutoffHoursOverride : tiers[i].hoursBefore
    const deadline = startMs - hours * 3_600_000
    if (tiers[i].strict ? nowMs < deadline : nowMs <= deadline) return { refundBp: tiers[i].refundBp, tier: `TIER_${hours}H`, deadlineMs: deadline }
  }
  const firstHours = tiers.length ? (Number.isFinite(cutoffHoursOverride) ? cutoffHoursOverride : tiers[0].hoursBefore) : 0
  return { refundBp: rules.afterLastTierBp ?? 0, tier: 'AFTER_LAST_TIER', deadlineMs: startMs - firstHours * 3_600_000 }
}

const ruleName = (bp) => (bp >= 10_000 ? 'FULL' : bp === 5_000 ? 'HALF' : bp <= 0 ? 'NONE' : 'PARTIAL')

// Returns { rule, refundMinor, retainedProtectionMinor, refundBp, deadlineMs }.
export function cancellationRefund({ paidMinor, protectionPurchased = false, protectionMinor = 0, checkIn, now = new Date(), cancelledBy = 'GUEST', profile, policyName, startMs, cutoffHoursOverride }) {
  const paid = Math.max(0, Math.round(Number(paidMinor) || 0))
  const protection = protectionPurchased ? Math.min(Math.max(0, Math.round(protectionMinor || 0)), paid) : 0
  if (!paid) return { rule: 'UNPAID', refundMinor: 0, retainedProtectionMinor: 0, refundBp: 0, deadlineMs: null }
  if (cancelledBy === 'HOST') return { rule: 'FULL', refundMinor: paid, retainedProtectionMinor: 0, refundBp: 10_000, deadlineMs: null }
  const policy = policyFor(profile, policyName)
  const start = startMs !== undefined ? startMs : checkIn ? localMidnight(new Date(checkIn), profile.timezone).getTime() : null
  const nowMs = new Date(now).getTime()
  if (protectionPurchased && policy.protected) {
    const { refundBp, deadlineMs } = refundBpAt(policy.protected, start, nowMs)
    const base = paid - protection
    return { rule: `${ruleName(refundBp)}_MINUS_PROTECTION`, refundMinor: refundBp >= 10_000 ? base : pct(base, refundBp), retainedProtectionMinor: protection, refundBp, deadlineMs }
  }
  const { refundBp, deadlineMs } = refundBpAt(policy, start, nowMs, cutoffHoursOverride)
  return { rule: ruleName(refundBp), refundMinor: refundBp >= 10_000 ? paid : pct(paid, refundBp), retainedProtectionMinor: 0, refundBp, deadlineMs }
}

// Back-compatible simple form used by earlier callers/tests: refund on booking.totalMinor.
export function guestRefund({ booking, policyName, profile, now = new Date() }) {
  if (booking.status === 'HOLD' || booking.status === 'REQUESTED') return { refundMinor: 0, reason: 'NOT_PAID' }
  const r = cancellationRefund({ paidMinor: booking.totalMinor, checkIn: booking.checkIn, now, profile, policyName })
  return { refundMinor: r.refundMinor, reason: r.rule === 'NONE' ? 'PAST_LAST_CUTOFF' : r.rule, refundBp: r.refundBp }
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
