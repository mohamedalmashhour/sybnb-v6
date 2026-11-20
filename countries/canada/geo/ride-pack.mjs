// Canada (Québec) RIDES PACK for the master ride routes (registered in server/lib/geo-adapter.mjs).
// ⚠️ Prices are variables (owner 2026-11-20): numbers come from countries/canada/profile.mjs and
// stay PENDING accountant confirmation. Fares are whole CAD (rounding $1), like SR's whole-unit fares.
// Categories reuse the master ride/vehicle keys: Standard = 'SR Economy', Comfort = 'SR Comfort',
// XL = 'SR SUV' (display names per country come later). No external geocoder: points come from the
// app (GPS / map pick) or the small place list below.
import { profile } from '../profile.mjs'
import { QUEBEC_RIDE_MARKET } from './ride-market.mjs'
import { createPricingPack } from '../../../wrapping/rides/pricing-pack.mjs'
import { smartFare, haversineKm as engineHaversineKm } from '../../../wrapping/rides/smart-fare.mjs'
import { inBounds } from '../../../wrapping/core/geo.mjs'

const MAP = { 'SR Economy': 'STANDARD', 'SR Comfort': 'COMFORT', 'SR SUV': 'XL' }
export const SR_CATEGORIES = Object.keys(MAP)
const dollars = (cents) => cents / 100
const r = profile.rides

export const CLASS_PROFILES = {
  'SR Economy': { fuelL100: 7.5, carPriceUsd: 28000, maintenanceUsdPerKm: 0.06, pickupKm: 2, baseExtraUsd: 1, minFareUsd: dollars(r.categories.STANDARD.minimumCents) },
  'SR Comfort': { fuelL100: 8.5, carPriceUsd: 40000, maintenanceUsdPerKm: 0.08, pickupKm: 2, baseExtraUsd: 1.5, minFareUsd: dollars(r.categories.COMFORT.minimumCents) },
  'SR SUV': { fuelL100: 10.5, carPriceUsd: 50000, maintenanceUsdPerKm: 0.1, pickupKm: 2, baseExtraUsd: 2, minFareUsd: dollars(r.categories.XL.minimumCents) },
}
export const DEFAULT_COSTS = {
  fuelPriceUsdPerL: 1.6, resalePct: 30, carLifeKm: 250000, insuranceUsdPerKm: 0.05, safetyReserveUsdPerKm: 0.01,
  emptyKmPct: 30, driverIncomeUsdPerMonth: 3500, hoursPerMonth: 160, utilizationPct: 60, trafficUsdPerMin: 0.05,
  platformFeePct: r.driverCommissionBp / 100, maintenanceFactor: 1,
}
export const PRICING_LIMITS = {
  costs: { fuelPriceUsdPerL: [0.5, 5], resalePct: [0, 90], carLifeKm: [50000, 1000000], insuranceUsdPerKm: [0, 1], safetyReserveUsdPerKm: [0, 1], emptyKmPct: [0, 80], driverIncomeUsdPerMonth: [500, 20000], hoursPerMonth: [40, 400], utilizationPct: [20, 100], trafficUsdPerMin: [0, 2], platformFeePct: [0, 50], maintenanceFactor: [0.2, 5] },
  multipliers: { peak: [1, 3], trafficMax: [1, 4], night: [1, 3], schedule: [1, 3], weekend: [1, 3], holiday: [1, 3], demand: [1, 5], fuelSurchargePercent: [0, 100] },
  fees: { ringFeeUsd: [0, 10], ringWidthKm: [0.5, 20], ringCount: [1, 30], airportBaseUsd: [1, 500], airportSurchargeUsd: [0, 50], internationalSurchargeUsd: [0, 200], stopFeeUsd: [0, 20], freeBags: [0, 10], bagFeeUsd: [0, 20], baseRiders: [1, 8], extraRiderFeeUsd: [0, 20], liveTrackingUsd: [0, 5], safetyFeePerTripUsd: [0, 5], roundingUsd: [1, 50], minChargeUsd: [0, 100], bookingFeeUsd: [0, 20] },
  intercity: { thresholdKm: [10, 300], speedKmh: [20, 130], emptyKmPct: [0, 80] },
  avgSpeedKmh: [5, 100],
  rate: { baseUsd: [0, 50], perKmUsd: [0.01, 10], perMinUsd: [0, 5], minFareUsd: [0, 500] },
}

export function legacyConfig() {
  const manualRates = Object.fromEntries(Object.entries(MAP).map(([cat, key]) => {
    const c = r.categories[key]
    return [cat, { baseUsd: dollars(c.baseCents), perKmUsd: dollars(c.perKmCents), perMinUsd: dollars(c.perMinCents), minFareUsd: dollars(c.minimumCents) }]
  }))
  return {
    version: 1, source: 'legacy', mode: 'manual', costs: { ...DEFAULT_COSTS }, manualRates,
    multipliers: { peak: 1, trafficMax: Math.min(4, r.maxSurgeBp / 10000), night: 1, schedule: 1, weekend: 1, holiday: 1, demand: 1, fuelSurchargePercent: 0 },
    fees: { ringFeeUsd: 0, ringWidthKm: 5, ringCount: 1, airportBaseUsd: 45, airportSurchargeUsd: 0, internationalSurchargeUsd: 0, stopFeeUsd: 0, freeBags: 2, bagFeeUsd: 0, baseRiders: 4, extraRiderFeeUsd: 0, liveTrackingUsd: 0, safetyFeePerTripUsd: 0, roundingUsd: 1, minChargeUsd: 0, bookingFeeUsd: dollars(r.bookingFeeCents) },
    intercity: { thresholdKm: 60, speedKmh: 90, emptyKmPct: 40 },
    avgSpeedKmh: r.estimatedKmh,
    holidays: [],
  }
}
export function recommendedConfig() {
  return { ...legacyConfig(), source: 'custom', mode: 'formula' }
}

const pack = createPricingPack({ categories: SR_CATEGORIES, classProfiles: CLASS_PROFILES, defaultCosts: DEFAULT_COSTS, limits: PRICING_LIMITS, legacyConfig, recommendedConfig, fallbackCategory: 'SR Economy' })
export const { deriveClassRates, deriveAllRates, normalizePricing, storableConfig, getActivePricing, setActivePricing, resetActivePricing } = pack

// Small place list (owner can extend); anything else must come with coordinates from the app.
const PLACES = [
  { keys: ['montreal', 'montréal', 'centre-ville', 'downtown'], lat: 45.5017, lng: -73.5673 },
  { keys: ['plateau'], lat: 45.522, lng: -73.585 },
  { keys: ['laval'], lat: 45.6066, lng: -73.7124 },
  { keys: ['longueuil'], lat: 45.5312, lng: -73.5181 },
  { keys: ['trudeau', 'yul', 'aéroport', 'aeroport', 'airport'], lat: 45.4706, lng: -73.7408 },
  { keys: ['québec', 'quebec city', 'ville de québec'], lat: 46.8139, lng: -71.208 },
]
const norm = (t) => String(t || '').toLowerCase().normalize('NFC')
export function resolvePlaceDetailed(text) {
  const n = norm(text)
  const hit = PLACES.find((p) => p.keys.some((k) => n.includes(k)))
  return hit ? { lat: hit.lat, lng: hit.lng, international: false } : null
}
export function resolvePlaceText(text) {
  const p = resolvePlaceDetailed(text)
  return p ? { lat: p.lat, lng: p.lng } : null
}
export const haversineKm = engineHaversineKm
const okCoords = (c) => c && Number.isFinite(c.lat) && Number.isFinite(c.lng) && inBounds(c, r.serviceBounds)

export function quoteSrRide({ pickup, dropoff, category, lowDataMode, pickupCoordsOverride, dropoffCoordsOverride, stops, stopCoordsOverrides,
  riderCount, bagCount, scheduled, distanceKmOverride, estimatedMinutesOverride, trafficMultiplierOverride, now, pricing }) {
  const cfg = pricing && pricing.rates ? pricing : getActivePricing()
  const pickupCoords = okCoords(pickupCoordsOverride) ? pickupCoordsOverride : resolvePlaceText(pickup)
  const dropoffCoords = okCoords(dropoffCoordsOverride) ? dropoffCoordsOverride : resolvePlaceText(dropoff)
  const stopList = Array.isArray(stops) ? stops : []
  const stopCoords = stopList.map((t, i) => (okCoords(stopCoordsOverrides?.[i]) ? stopCoordsOverrides[i] : resolvePlaceText(t)))
  const fare = smartFare({ cfg, market: QUEBEC_RIDE_MARKET, category, pickupCoords, dropoffCoords, stopCoords, stopsCount: stopList.length,
    riderCount, bagCount, scheduled, lowDataMode, distanceKmOverride, estimatedMinutesOverride, trafficMultiplierOverride, now })
  return { ...fare, pickupCoords, dropoffCoords, stopCoords }
}
