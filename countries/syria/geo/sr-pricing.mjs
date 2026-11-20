// SR pricing configuration + cost formula. Pure, no I/O.
//
// Two ways to price a class, chosen by `mode`:
//   'formula' : rates are DERIVED from real cost inputs (fuel, maintenance, car wear, insurance, safety
//               reserve, empty km, driver income target, traffic time, platform fee).
//   'manual'  : the admin types the rates by hand.
// Everything else (multipliers, fees, rings, rounding) is a plain number the admin can change. Every
// number is clamped to a safe range, so a typo can never produce a free or a absurd fare.
//
// With no stored config the engine behaves exactly like before (legacyConfig, from env). The
// "recommended" preset below is the cost-based proposal from the pricing study.

import { createPricingPack } from '../../../wrapping/rides/pricing-pack.mjs'

const num = (name, def, min, max) => {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw >= min && raw <= max ? raw : def
}

export const SR_CATEGORIES = ['SR Bike', 'SR Economy', 'SR Comfort', 'SR SUV', 'SR Van', 'SR VIP']

// Per-class vehicle profile used by the formula. Figures are estimates (flagged in the pricing study),
// the admin can change the shared inputs; these class profiles are code defaults that scale them.
export const CLASS_PROFILES = {
  'SR Bike': { fuelL100: 2.5, carPriceUsd: 1200, maintenanceUsdPerKm: 0.015, pickupKm: 1.5, baseExtraUsd: 0.3, minFareUsd: 2 },
  'SR Economy': { fuelL100: 8.5, carPriceUsd: 7000, maintenanceUsdPerKm: 0.04, pickupKm: 2, baseExtraUsd: 0.5, minFareUsd: 3 },
  'SR Comfort': { fuelL100: 9.5, carPriceUsd: 11000, maintenanceUsdPerKm: 0.05, pickupKm: 2, baseExtraUsd: 0.7, minFareUsd: 4 },
  'SR SUV': { fuelL100: 12, carPriceUsd: 18000, maintenanceUsdPerKm: 0.065, pickupKm: 2, baseExtraUsd: 1.0, minFareUsd: 6 },
  'SR Van': { fuelL100: 13, carPriceUsd: 16000, maintenanceUsdPerKm: 0.07, pickupKm: 2, baseExtraUsd: 1.3, minFareUsd: 7 },
  'SR VIP': { fuelL100: 10, carPriceUsd: 30000, maintenanceUsdPerKm: 0.09, pickupKm: 2, baseExtraUsd: 2.0, minFareUsd: 10 },
}

// [min, max] for every number the admin may set. Anything outside is replaced by the default.
export const PRICING_LIMITS = {
  costs: {
    fuelPriceUsdPerL: [0.1, 10],
    resalePct: [0, 90],
    carLifeKm: [20000, 1000000],
    insuranceUsdPerKm: [0, 1],
    safetyReserveUsdPerKm: [0, 1],
    emptyKmPct: [0, 80],
    driverIncomeUsdPerMonth: [50, 3000],
    hoursPerMonth: [40, 400],
    utilizationPct: [20, 100],
    trafficUsdPerMin: [0, 1],
    platformFeePct: [0, 50],
    maintenanceFactor: [0.2, 5],
  },
  multipliers: {
    peak: [1, 3], trafficMax: [1, 4], night: [1, 3], schedule: [1, 3], weekend: [1, 3], holiday: [1, 3],
    demand: [1, 5], fuelSurchargePercent: [0, 100],
  },
  fees: {
    ringFeeUsd: [0, 10], ringWidthKm: [0.5, 20], ringCount: [1, 30], airportBaseUsd: [1, 500],
    airportSurchargeUsd: [0, 50], internationalSurchargeUsd: [0, 200], stopFeeUsd: [0, 20], freeBags: [0, 10],
    bagFeeUsd: [0, 20], baseRiders: [1, 8], extraRiderFeeUsd: [0, 20], liveTrackingUsd: [0, 5],
    safetyFeePerTripUsd: [0, 5], roundingUsd: [1, 50], minChargeUsd: [0, 100],
  },
  intercity: { thresholdKm: [10, 200], speedKmh: [20, 120], emptyKmPct: [0, 80] },
  avgSpeedKmh: [5, 100],
  rate: { baseUsd: [0, 50], perKmUsd: [0.01, 5], perMinUsd: [0, 2], minFareUsd: [0, 200] },
}

// The shared cost inputs of the formula. Defaults are the figures in the pricing study.
export const DEFAULT_COSTS = {
  fuelPriceUsdPerL: 1.4, // Ministry of Energy, gasoline 90, Sept 2026 (about 185 SYP)
  resalePct: 30, // value the car keeps at the end of its life
  carLifeKm: 200000,
  insuranceUsdPerKm: 0.01,
  safetyReserveUsdPerKm: 0.01, // tyres/brakes inspection, accident reserve, first aid
  emptyKmPct: 35, // share of driven km with no passenger (looking for the next ride)
  driverIncomeUsdPerMonth: 450, // owner target: 400-500
  hoursPerMonth: 208, // 8 h x 26 days
  utilizationPct: 60, // share of working time that is a paid trip
  trafficUsdPerMin: 0.02, // extra wear/fuel while crawling in traffic
  platformFeePct: 20,
  maintenanceFactor: 1, // 1 = class default, 1.2 = +20% (bad roads)
}

// ---- Presets ------------------------------------------------------------------------------------
export function legacyConfig() {
  const intercity = { thresholdKm: 40, speedKmh: 60, emptyKmPct: 40 }
  const manual = {
    'SR Bike': { baseUsd: 0.8, perKmUsd: 0.11, perMinUsd: 0.015, minFareUsd: 3 },
    'SR Economy': { baseUsd: 1.2, perKmUsd: 0.18, perMinUsd: 0.02, minFareUsd: 4 },
    'SR Comfort': { baseUsd: 1.5, perKmUsd: 0.22, perMinUsd: 0.028, minFareUsd: 5 },
    'SR SUV': { baseUsd: 2.2, perKmUsd: 0.32, perMinUsd: 0.045, minFareUsd: 7 },
    'SR Van': { baseUsd: 2.8, perKmUsd: 0.38, perMinUsd: 0.055, minFareUsd: 9 },
    'SR VIP': { baseUsd: 3.5, perKmUsd: 0.5, perMinUsd: 0.07, minFareUsd: 12 },
  }
  return {
    version: 1,
    source: 'legacy',
    mode: 'manual',
    costs: { ...DEFAULT_COSTS },
    manualRates: manual,
    multipliers: {
      peak: num('SR_PEAK_SURGE_MULTIPLIER', 1.25, 1, 3), trafficMax: num('SR_TRAFFIC_MAX', 2, 1, 4),
      night: num('SR_NIGHT_MULTIPLIER', 1.15, 1, 3), schedule: num('SR_SCHEDULE_MULTIPLIER', 1.1, 1, 3),
      weekend: num('SR_WEEKEND_MULTIPLIER', 1.08, 1, 3), holiday: num('SR_HOLIDAY_MULTIPLIER', 1.2, 1, 3),
      demand: num('SR_DEMAND_SURGE_MULTIPLIER', 1, 1, 5), fuelSurchargePercent: num('SR_FUEL_SURCHARGE_PERCENT', 0, 0, 100),
    },
    fees: {
      ringFeeUsd: num('SR_RING_FEE_USD', 0.4, 0, 10), ringWidthKm: num('SR_RING_WIDTH_KM', 3, 0.5, 20),
      ringCount: Math.round(num('SR_RING_COUNT', 10, 1, 30)), airportBaseUsd: num('SR_AIRPORT_BASE_USD', 20, 1, 500),
      airportSurchargeUsd: num('SR_AIRPORT_SURCHARGE_USD', 5, 0, 50),
      internationalSurchargeUsd: num('SR_INTERNATIONAL_SURCHARGE_USD', 25, 0, 200),
      stopFeeUsd: num('SR_STOP_FEE_USD', 1, 0, 20), freeBags: num('SR_FREE_BAGS', 2, 0, 10), bagFeeUsd: num('SR_BAG_FEE_USD', 1, 0, 20),
      baseRiders: num('SR_BASE_RIDERS', 4, 1, 8), extraRiderFeeUsd: num('SR_EXTRA_RIDER_FEE_USD', 1, 0, 20),
      liveTrackingUsd: 0.2, safetyFeePerTripUsd: 0, roundingUsd: num('SR_FARE_ROUNDING_USD', 5, 1, 50), minChargeUsd: 0,
    },
    intercity,
    avgSpeedKmh: num('SR_AVG_SPEED_KMH', 28, 1, 200),
    holidays: String(process.env.SR_HOLIDAYS || '').split(',').map((s) => s.trim()).filter(Boolean),
  }
}

// The cost-based proposal from the pricing study (owner target income $450/month).
export function recommendedConfig() {
  const base = legacyConfig()
  return {
    ...base,
    source: 'custom',
    mode: 'formula',
    fees: { ...base.fees, ringFeeUsd: 0.4, safetyFeePerTripUsd: 0.15, roundingUsd: 1, minChargeUsd: 10 }, // owner: minimum charge $10
  }
}

// ---- Pack ---------------------------------------------------------------------------------------
// The machinery (normalize/clamp, cost formula, presets, active config) is the country-neutral
// rides capsule (wrapping/rides/pricing-pack.mjs); Syria supplies only its numbers above.
const pack = createPricingPack({
  categories: SR_CATEGORIES, classProfiles: CLASS_PROFILES, defaultCosts: DEFAULT_COSTS, limits: PRICING_LIMITS,
  legacyConfig, recommendedConfig, fallbackCategory: 'SR Economy',
})
export const { deriveClassRates, deriveAllRates, normalizePricing, storableConfig, getActivePricing, setActivePricing, resetActivePricing } = pack
