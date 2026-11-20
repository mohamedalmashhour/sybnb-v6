// DRAFT — United Arab Emirates settings for the wrapping/ capsules (one-base, owner 2026-11-20).
// ⚠️ PAYMENTS AND PRICES ARE VARIABLES (owner 2026-11-20): every amount below is a placeholder to
// be decided and adjusted later. Not registered in server/lib/country.mjs: no UAE service runs.
// Facts checked 2026-11-20: VAT 5% (Federal Tax Authority); public-sector weekend Saturday–Sunday
// with Friday a half day; Dubai holiday homes need a DTCM permit and carry the Tourism Dirham fee
// per night (amount to confirm). Tax rates stay PENDING until an accountant confirms them.
export const profile = Object.freeze({
  key: 'uae',
  status: 'DRAFT',
  payments: { methods: [], payoutMethods: [], status: 'TO_BE_DECIDED' }, // e.g. card, apple_pay
  currencies: { allowed: ['AED'], default: 'AED' },
  map: { center: { lat: 25.2048, lng: 55.2708 }, zoom: 11, bounds: { minLat: 22.6, maxLat: 26.1, minLng: 51.5, maxLng: 56.4 }, provider: 'google' }, // Dubai
  timezone: 'Asia/Dubai',
  defaultLocale: 'ar-AE',
  taxes: { status: 'PENDING_ACCOUNTANT_CONFIRMATION', VAT: { bp: 500, label: { ar: 'ضريبة القيمة المضافة', en: 'VAT' } } },
  stays: {
    guestServiceFeeBp: 0, hostCommissionBp: 0, protectionBp: 0, fallbackCleaningBp: 0, fallbackTaxBp: 0,
    commissionBase: 'LODGING',
    lodgingTaxes: [], salesTaxes: ['VAT'],
    holdMinutes: 30, maxNights: 30, payoutHoldDays: 1,
    requireRegistrationNumber: true, // DTCM holiday-home permit (Dubai)
    defaultPolicy: 'moderate',
    cancellationPolicies: {
      flexible: { tiers: [{ hoursBefore: 24, refundBp: 10000 }], afterLastTierBp: 0 },
      moderate: { tiers: [{ hoursBefore: 120, refundBp: 10000 }, { hoursBefore: 24, refundBp: 5000 }], afterLastTierBp: 0 },
      strict: { tiers: [{ hoursBefore: 336, refundBp: 10000 }, { hoursBefore: 168, refundBp: 5000 }], afterLastTierBp: 0 },
    },
  },
  rides: {
    categories: {
      ECONOMY: { baseMinor: 0, perKmMinor: 0, perMinMinor: 0, minimumMinor: 0, seats: 4 },
      COMFORT: { baseMinor: 0, perKmMinor: 0, perMinMinor: 0, minimumMinor: 0, seats: 4 },
      XL: { baseMinor: 0, perKmMinor: 0, perMinMinor: 0, minimumMinor: 0, seats: 6 },
    },
    bookingFeeMinor: 0, perStopMinor: 0, maxStops: 2, driverCommissionBp: 0, taxes: ['VAT'],
    estimatedKmh: 35, roadFactor: 1.3, maxSurgeBp: 15000, minTripMeters: 200, searchRadiusM: 10000,
    serviceBounds: { minLat: 22.6, maxLat: 26.1, minLng: 51.5, maxLng: 56.4 },
    cancellation: { graceSeconds: 120, feePercent: 0, noShowPercent: 0, waitMinutes: 5, arrivalRadiusM: 300, minFeeMinor: 0 },
    market: {
      currency: 'AED', utcOffsetHours: 4, peakHours: [[7, 9], [17, 20]], nightHours: [23, 5], weekendDays: [6, 0],
      fixedHolidays: ['01-01', '12-02', '12-03'], // New Year, Eid Al Etihad; Eids come from the pricing config each year
      ringCenter: { lat: 25.2048, lng: 55.2708 },
      airports: [
        { lat: 25.2532, lng: 55.3657 }, // Dubai International
        { lat: 24.8960, lng: 55.1610 }, // Dubai World Central
        { lat: 24.4330, lng: 54.6511 }, // Abu Dhabi (Zayed International)
        { lat: 25.3286, lng: 55.5172 }, // Sharjah
      ],
      airportRadiusKm: 4, qualityFactors: { ECONOMY: 1, COMFORT: 1.3, XL: 1.6 }, fallbackCategory: 'ECONOMY', defaultDistanceKm: 8,
    },
  },
  externalGates: [
    'DTCM holiday-home permit rules for platforms and hosts; Tourism Dirham fee amount per emirate',
    'RTA (Dubai) / ITC (Abu Dhabi) ride-hailing licensing — limousine/taxi partnership model',
    'FTA VAT registration (threshold AED 375,000) and e-invoicing timeline',
    'Operating entity in the UAE and payment provider onboarding',
  ],
})
