// Syria settings for the wrapping/ stays + rides capsules, taken from the values the live platform
// uses today (countries/syria/profile.mjs, server/lib/booking-policy.mjs,
// server/lib/booking-lifecycle.mjs, server/routes/sr-rides.mjs, server/lib/ride-wait.mjs and the
// legacy manual rates in ./geo/sr-pricing.mjs). Rides are priced in USD cents, as SR quotes today.
// No taxes are listed: Syrian tax/VAT treatment is an open external gate (profile.externalGates).
import { profile as base } from './profile.mjs'
import { legacyConfig } from './geo/sr-pricing.mjs'

const usd = (n) => Math.round(n * 100)
const legacy = legacyConfig()
const cat = (r, seats) => ({ baseMinor: usd(r.baseUsd), perKmMinor: usd(r.perKmUsd), perMinMinor: usd(r.perMinUsd), minimumMinor: usd(r.minFareUsd), seats })
const SEATS = { 'SR Bike': 1, 'SR Economy': 4, 'SR Comfort': 4, 'SR SUV': 6, 'SR Van': 8, 'SR VIP': 4 }

// ⚠️ PAYMENTS AND PRICES ARE VARIABLES (owner 2026-11-20): adjust here, per country, later.
export const profile = Object.freeze({
  key: base.key,
  // SYP is quoted in whole pounds in practice, so 0 decimals.
  currencies: { allowed: base.currencies.allowed, default: 'USD', minorDigits: { SYP: 0 } },
  map: { center: { lat: 33.5138, lng: 36.2765 }, zoom: 7, bounds: { minLat: 32.3, maxLat: 37.4, minLng: 35.6, maxLng: 42.4 }, provider: 'leaflet-osm' },
  payments: { methods: ['local_wallet', 'card_stripe', 'cash'], payoutMethods: ['SHAM_CASH', 'BANK', 'CASH_OFFICE'], status: 'CURRENT_LIVE_SETUP_TO_REVIEW' },
  timezone: 'Asia/Damascus',
  defaultLocale: base.defaultLocale,
  taxes: { status: 'NOT_CONFIGURED' },
  stays: {
    guestServiceFeeBp: 0,              // Syria charges the host, not the guest
    hostCommissionBp: 1500,            // STR_COMMISSION_RATE 15%
    protectionBp: 300,                 // optional cancellation-protection add-on, 3% of the stay
    fallbackCleaningBp: 500,           // cleaning when a listing sets none: 5% of the stay
    fallbackTaxBp: 200,                // tax when a listing sets none: 2% of the stay
    commissionBase: 'TOTAL_EXCL_PROTECTION', // commission on everything paid except protection
    lodgingTaxes: [],
    salesTaxes: [],
    holdMinutes: base.bookingPolicy.unpaidExpiryHours * 60,
    maxNights: 30,
    payoutHoldDays: 14,                // PAYOUT_HOLD_DAYS
    requireRegistrationNumber: false,
    defaultPolicy: 'standard',
    // Live Syria rule: full refund up to 72 h before check-in 00:00 (inclusive), then 50% — also
    // after check-in, until the stay ends. With protection: full minus the protection fee until
    // check-in 00:00 (strictly before), then 50% minus the fee. Host cancel = full (capsule).
    cancellationPolicies: {
      standard: {
        tiers: [{ hoursBefore: base.bookingPolicy.fullRefundCutoffHours, refundBp: 10000 }],
        afterLastTierBp: 5000,
        protected: { tiers: [{ hoursBefore: 0, refundBp: 10000, strict: true }], afterLastTierBp: 5000 },
      },
    },
  },
  rides: {
    categories: Object.fromEntries(Object.entries(legacy.manualRates).map(([k, r]) => [k, cat(r, SEATS[k])])),
    bookingFeeMinor: 0,
    perStopMinor: usd(legacy.fees.stopFeeUsd),
    maxStops: 3,
    driverCommissionBp: 2000,          // owner decision 2026-10-18: 20% platform / 80% driver
    taxes: [],
    estimatedKmh: legacy.avgSpeedKmh,
    roadFactor: 1.3,
    maxSurgeBp: 20000,
    minTripMeters: 200,
    searchRadiusM: 8000,
    serviceBounds: { minLat: 32.3, maxLat: 37.4, minLng: 35.6, maxLng: 42.4 },
    cancellation: { graceSeconds: 120, feePercent: 15, noShowPercent: 100, waitMinutes: 10, arrivalRadiusM: 300, minFeeMinor: 100 },
  },
})
