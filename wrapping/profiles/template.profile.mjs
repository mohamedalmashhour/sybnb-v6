// COUNTRY PROFILE TEMPLATE for the stays + rides capsules.
// Copy to countries/<country>/capsules.profile.mjs and fill in. Every amount is in the currency's
// minor unit; every rate is in basis points (1 bp = 0.01%). Values below are PLACEHOLDERS, not
// legal, tax or pricing advice — each must be confirmed for the country before launch.
// ⚠️ NOTICE (owner decision 2026-11-20): PAYMENTS AND PRICES ARE VARIABLES. Every payment method,
// price, fee, commission, tax and fare below is set per country here and adjusted later — never
// hard-coded in wrapping/, server/ or src/.
export const profile = Object.freeze({
  key: 'example',
  // CURRENCY: change `default` (an ISO code) — decimals and formatting follow automatically.
  currencies: { allowed: ['XXX'], default: 'XXX' /*, minorDigits: { XXX: 0 } */ },

  // MAP: where maps open, zoom, service area (bounds) and provider.
  map: { center: { lat: 0, lng: 0 }, zoom: 11, bounds: null, provider: 'leaflet-osm' },
  timezone: 'UTC',
  defaultLocale: 'en',

  // PAYMENTS: which payment solutions this country uses (chosen per country, adjusted later).
  // Examples: 'local_wallet', 'card_stripe', 'mada', 'apple_pay', 'bank_transfer', 'cash'.
  payments: { methods: [], payoutMethods: [], status: 'TO_BE_DECIDED' },

  // Tax table. status stays PENDING until an accountant confirms the rates.
  taxes: {
    status: 'PENDING_ACCOUNTANT_CONFIRMATION',
    // VAT: { bp: 0, label: { en: 'VAT' } },
  },

  stays: {
    guestServiceFeeBp: 1200,
    hostCommissionBp: 300,
    lodgingTaxes: [],          // tax codes applied to the stay only
    salesTaxes: [],            // tax codes applied to stay + service fee
    holdMinutes: 30,
    maxNights: 30,
    payoutHoldDays: 1,
    requireRegistrationNumber: false,
    defaultPolicy: 'moderate',
    cancellationPolicies: {
      flexible: [{ hoursBefore: 24, refundBp: 10000 }],
      moderate: [{ hoursBefore: 120, refundBp: 10000 }, { hoursBefore: 24, refundBp: 5000 }],
      strict: [{ hoursBefore: 336, refundBp: 10000 }, { hoursBefore: 168, refundBp: 5000 }],
    },
  },

  rides: {
    categories: {
      STANDARD: { baseMinor: 0, perKmMinor: 0, perMinMinor: 0, minimumMinor: 0, seats: 4 },
    },
    bookingFeeMinor: 0,
    perStopMinor: 0,
    maxStops: 2,
    driverCommissionBp: 2500,
    taxes: [],
    estimatedKmh: 30,
    roadFactor: 1.3,
    maxSurgeBp: 15000,
    minTripMeters: 200,
    searchRadiusM: 8000,
    serviceBounds: null,       // { minLat, maxLat, minLng, maxLng }
    cancellation: { graceSeconds: 120, feePercent: 15, noShowPercent: 100, waitMinutes: 5, arrivalRadiusM: 300, minFeeMinor: 0 },
  },
})
