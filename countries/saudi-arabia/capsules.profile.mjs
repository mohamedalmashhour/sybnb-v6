// DRAFT — Saudi Arabia settings for the wrapping/ capsules (one-base, owner direction 2026-11-20).
// ⚠️ PAYMENTS AND PRICES ARE VARIABLES (owner 2026-11-20): every amount below is a placeholder to
// be decided and adjusted later. Not registered in server/lib/country.mjs: no Saudi service runs.
// Facts checked 2026-11-20: VAT 15% (ZATCA, since July 2020; Airbnb charges it on listing price +
// cleaning); weekend Friday–Saturday; a Ministry of Tourism permit is required for every
// short-term rental. Tax rates stay PENDING until an accountant confirms them.
export const profile = Object.freeze({
  key: 'saudi-arabia',
  status: 'DRAFT',
  payments: { methods: [], payoutMethods: [], status: 'TO_BE_DECIDED' }, // e.g. mada, apple_pay, card, stc_pay
  currencies: { allowed: ['SAR'], default: 'SAR' },
  map: { center: { lat: 24.7136, lng: 46.6753 }, zoom: 11, bounds: { minLat: 16.3, maxLat: 32.2, minLng: 34.5, maxLng: 55.7 }, provider: 'google' }, // Riyadh
  timezone: 'Asia/Riyadh',
  defaultLocale: 'ar-SA',
  taxes: { status: 'PENDING_ACCOUNTANT_CONFIRMATION', VAT: { bp: 1500, label: { ar: 'ضريبة القيمة المضافة', en: 'VAT' } } },
  stays: {
    guestServiceFeeBp: 0, hostCommissionBp: 0, protectionBp: 0, fallbackCleaningBp: 0, fallbackTaxBp: 0,
    commissionBase: 'LODGING',
    lodgingTaxes: [], salesTaxes: ['VAT'],
    holdMinutes: 30, maxNights: 30, payoutHoldDays: 1,
    requireRegistrationNumber: true, // Ministry of Tourism permit number on every listing
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
    serviceBounds: { minLat: 16.3, maxLat: 32.2, minLng: 34.5, maxLng: 55.7 },
    cancellation: { graceSeconds: 120, feePercent: 0, noShowPercent: 0, waitMinutes: 5, arrivalRadiusM: 300, minFeeMinor: 0 },
    market: {
      currency: 'SAR', utcOffsetHours: 3, peakHours: [[7, 9], [16, 19]], nightHours: [23, 5], weekendDays: [5, 6],
      fixedHolidays: ['02-22', '09-23'], // Founding Day, National Day; Eids come from the pricing config each year
      ringCenter: { lat: 24.7136, lng: 46.6753 },
      airports: [
        { lat: 24.9576, lng: 46.6988 }, // Riyadh King Khalid
        { lat: 21.6796, lng: 39.1565 }, // Jeddah King Abdulaziz
        { lat: 26.4712, lng: 49.7979 }, // Dammam King Fahd
        { lat: 24.5534, lng: 39.7051 }, // Madinah Prince Mohammad bin Abdulaziz
      ],
      airportRadiusKm: 4, qualityFactors: { ECONOMY: 1, COMFORT: 1.3, XL: 1.6 }, fallbackCategory: 'ECONOMY', defaultDistanceKm: 8,
    },
  },
  externalGates: [
    'Ministry of Tourism private tourism accommodation permit rules for platforms and hosts',
    'Transport General Authority licensing for ride-hailing (drivers, vehicles, platform)',
    'ZATCA VAT registration and FATOORAH e-invoicing',
    'Operating entity (Saudi company, e.g. mm3a) and payment provider onboarding (mada, Apple Pay)',
  ],
})
