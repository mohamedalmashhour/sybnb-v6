// Syria ride MARKET settings for the wrapping/rides smart-fare engine (fixed facts about the place
// and calendar, not prices — prices live in the admin pricing config, sr-pricing.mjs).
export const SYRIA_RIDE_MARKET = Object.freeze({
  currency: 'USD',               // SR fares are quoted in USD
  utcOffsetHours: 3,             // Damascus, fixed UTC+3 (no daylight saving since 2022)
  peakHours: [[7, 10], [16, 20]],
  nightHours: [22, 6],           // 22:00-05:59
  weekendDays: [5, 6],           // Friday + Saturday
  fixedHolidays: ['01-01', '03-08', '04-17', '05-01', '05-06', '12-25'], // movable ones (Eid, Ramadan) via the pricing config
  ringCenter: { lat: 33.5138, lng: 36.2765 }, // Umayyad Square, central Damascus
  airports: [
    { lat: 33.4114, lng: 36.5156 }, // Damascus International
    { lat: 36.1807, lng: 37.2244 }, // Aleppo International
    { lat: 35.4011, lng: 35.9487 }, // Basel al-Assad (Latakia)
    { lat: 35.2854, lng: 40.176 },  // Deir ez-Zor
    { lat: 37.0206, lng: 41.1914 }, // Qamishli
  ],
  airportRadiusKm: 3,
  qualityFactors: { 'SR Bike': 0.7, 'SR Economy': 1, 'SR Comfort': 1.25, 'SR SUV': 1.5, 'SR Van': 1.8, 'SR VIP': 2.4 },
  fallbackCategory: 'SR Economy',
  defaultDistanceKm: 5,
})
