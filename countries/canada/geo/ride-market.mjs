// Québec ride MARKET settings for the wrapping/rides smart-fare engine (place and calendar facts).
// utcOffsetHours is the engine's fixed offset for peak/night/weekend: Québec is UTC-5 in winter and
// UTC-4 in summer; -5 is used (a one-hour shift of the peak window in summer — to refine later).
export const QUEBEC_RIDE_MARKET = Object.freeze({
  currency: 'CAD',
  fareMinorDigits: 2,              // fares in cents (Uber/Lyft style), not whole dollars
  // Government charges on every ride (Revenu Québec, checked 2026-11-20): $0.90 remunerated passenger
  // transportation dues, shown separately (split on shared rides), then GST 5% + QST 9.975% on the
  // fare + dues. ⚠️ Rates are country settings, pending the accountant's confirmation.
  rideCharges: {
    perTripDuesMinor: 90,
    duesLabel: { fr: 'Redevance transport rémunéré', en: 'Remunerated passenger transportation dues' },
    taxes: [{ code: 'GST', bp: 500, label: { fr: 'TPS', en: 'GST' } }, { code: 'QST', bp: 997.5, label: { fr: 'TVQ', en: 'QST' } }],
    taxStatus: 'PENDING_ACCOUNTANT_CONFIRMATION',
  },
  utcOffsetHours: -5,
  peakHours: [[7, 9], [16, 18]],
  nightHours: [23, 5],
  weekendDays: [6, 0],             // Saturday + Sunday
  fixedHolidays: ['01-01', '06-24', '07-01', '12-25'], // New Year, Fête nationale, Canada Day, Christmas
  ringCenter: { lat: 45.5017, lng: -73.5673 }, // downtown Montréal
  airports: [
    { lat: 45.4706, lng: -73.7408 }, // Montréal-Trudeau (YUL)
    { lat: 46.7911, lng: -71.3933 }, // Québec City Jean-Lesage (YQB)
  ],
  airportRadiusKm: 3,
  qualityFactors: { 'SR Economy': 1, 'SR Comfort': 1.3, 'SR SUV': 1.6 },
  fallbackCategory: 'SR Economy',
  defaultDistanceKm: 6,
})
