// Canada (Québec) settings for the wrapping/ stays + rides capsules, DERIVED from ./profile.mjs so
// the numbers live in one place. Tax rates stay PENDING_ACCOUNTANT_CONFIRMATION (see profile.taxes).
import { profile as base } from './profile.mjs'
import { canadaMapPresentation } from './maps.public.mjs'

const cat = (c) => ({ baseMinor: c.baseCents, perKmMinor: c.perKmCents, perMinMinor: c.perMinCents, minimumMinor: c.minimumCents, seats: c.seats })

// ⚠️ PAYMENTS AND PRICES ARE VARIABLES (owner 2026-11-20): adjust here, per country, later.
export const profile = Object.freeze({
  key: base.key,
  currencies: base.currencies,
  map: { center: canadaMapPresentation.center, zoom: 11, bounds: base.rides.serviceBounds, provider: 'google' },
  payments: { methods: ['card_stripe'], payoutMethods: ['bank_transfer'], status: 'TO_BE_DECIDED' },
  timezone: base.timezone,
  defaultLocale: base.defaultLocale,
  taxes: base.taxes,
  stays: {
    guestServiceFeeBp: base.stays.guestServiceFeeBp,
    hostCommissionBp: base.stays.hostCommissionBp,
    lodgingTaxes: base.taxes.stays.filter((k) => k === 'LODGING'),
    salesTaxes: base.taxes.stays.filter((k) => k !== 'LODGING'),
    holdMinutes: base.stays.holdMinutes,
    maxNights: base.stays.maxNights,
    payoutHoldDays: 1,
    requireRegistrationNumber: base.stays.requireRegistrationNumber,
    defaultPolicy: 'standard',
    cancellationPolicies: {
      standard: [{ hoursBefore: base.stays.fullRefundCutoffHours, refundBp: 10000 }, { hoursBefore: 0, refundBp: base.stays.lateCancelRefundBp }],
    },
  },
  rides: {
    categories: Object.fromEntries(Object.entries(base.rides.categories).map(([k, c]) => [k, cat(c)])),
    bookingFeeMinor: base.rides.bookingFeeCents,
    perStopMinor: 0,
    maxStops: 0,
    driverCommissionBp: base.rides.driverCommissionBp,
    taxes: base.taxes.rides,
    estimatedKmh: base.rides.estimatedKmh,
    roadFactor: base.rides.roadFactor,
    maxSurgeBp: base.rides.maxSurgeBp,
    minTripMeters: 200,
    searchRadiusM: 8000,
    serviceBounds: base.rides.serviceBounds,
    cancellation: { graceSeconds: 120, feePercent: 15, noShowPercent: 100, waitMinutes: 5, arrivalRadiusM: 300, minFeeMinor: 0 },
  },
})
