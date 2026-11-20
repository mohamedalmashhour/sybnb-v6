// RIDES PRICING PACK (capsule) — the admin-editable pricing configuration machinery, country-neutral.
// ⚠️ Prices are variables (owner 2026-11-20): a country supplies only its numbers — categories, class
// cost profiles, default costs, limits and a legacy (manual-rates) preset. This module turns them into
// the pack the master routes use (normalize/clamp, cost formula, presets, active config).
//
// createPricingPack({ categories, classProfiles, defaultCosts, limits, legacyConfig, recommendedConfig,
//                     fallbackCategory, defaultIntercityEmptyKmPct })

const clamp = (value, [min, max], fallback) => {
  const n = Number(value)
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback
}
const round3 = (n) => Math.round(n * 1000) / 1000
const round2 = (n) => Math.round(n * 100) / 100
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

function mergeGroup(baseGroup, rawGroup, limits) {
  const out = {}
  for (const key of Object.keys(baseGroup)) out[key] = clamp(rawGroup?.[key], limits[key], baseGroup[key])
  return out
}

export function createPricingPack(spec) {
  const { categories, classProfiles, limits, fallbackCategory, defaultIntercityEmptyKmPct = 40 } = spec
  const CATS = Object.freeze([...categories])

  // Cost formula for one class:
  //   vehicleCostPerKm = fuel L/100 x price/100 + maintenance x factor + (car price x (1-resale))/life + insurance + safety
  //   costPerPaidKm    = vehicleCostPerKm / (1 - emptyKm)
  //   driverPerMin     = income / (hours x 60 x utilization)
  //   fare per km      = costPerPaidKm / (1 - platformFee); fare per minute = (driverPerMin + traffic) / (1 - platformFee)
  //   base             = pickupKm x vehicleCostPerKm / (1 - platformFee) + baseExtra
  function deriveClassRates(category, costs, intercity) {
    const p = classProfiles[category] || classProfiles[fallbackCategory]
    const share = 1 - costs.platformFeePct / 100
    const vehiclePerKm =
      (p.fuelL100 / 100) * costs.fuelPriceUsdPerL +
      p.maintenanceUsdPerKm * costs.maintenanceFactor +
      (p.carPriceUsd * (1 - costs.resalePct / 100)) / costs.carLifeKm +
      costs.insuranceUsdPerKm +
      costs.safetyReserveUsdPerKm
    const perPaidKm = vehiclePerKm / (1 - costs.emptyKmPct / 100)
    const perPaidKmIntercity = vehiclePerKm / (1 - (intercity?.emptyKmPct ?? defaultIntercityEmptyKmPct) / 100)
    const driverPerMin = costs.driverIncomeUsdPerMonth / (costs.hoursPerMonth * 60 * (costs.utilizationPct / 100))
    return {
      baseUsd: round2((p.pickupKm * vehiclePerKm) / share + p.baseExtraUsd),
      perKmUsd: round3(perPaidKm / share),
      perMinUsd: round3((driverPerMin + costs.trafficUsdPerMin) / share),
      minFareUsd: p.minFareUsd,
      perKmIntercityUsd: round3(perPaidKmIntercity / share),
      perMinIntercityUsd: round3(driverPerMin / share),
      breakdown: { vehicleCostPerKm: round3(vehiclePerKm), costPerPaidKm: round3(perPaidKm), driverPerMin: round3(driverPerMin) },
    }
  }
  const deriveAllRates = (costs, intercity) => Object.fromEntries(CATS.map((c) => [c, deriveClassRates(c, costs, intercity)]))

  function normalizePricing(raw, base = spec.legacyConfig()) {
    const input = raw && typeof raw === 'object' ? raw : {}
    const mode = input.mode === 'formula' ? 'formula' : input.mode === 'manual' ? 'manual' : base.mode
    const costs = mergeGroup(base.costs, input.costs, limits.costs)
    const multipliers = mergeGroup(base.multipliers, input.multipliers, limits.multipliers)
    const fees = mergeGroup(base.fees, input.fees, limits.fees)
    fees.ringCount = Math.round(fees.ringCount)
    fees.roundingUsd = Math.max(1, Math.round(fees.roundingUsd)) // fares are whole currency units (1 minor unit = 1 unit)
    const intercity = mergeGroup(base.intercity, input.intercity, limits.intercity)
    const avgSpeedKmh = clamp(input.avgSpeedKmh, limits.avgSpeedKmh, base.avgSpeedKmh)
    const manualRates = {}
    for (const cat of CATS) {
      const fallback = base.manualRates[cat]
      const given = input.manualRates?.[cat]
      manualRates[cat] = {
        baseUsd: clamp(given?.baseUsd, limits.rate.baseUsd, fallback.baseUsd),
        perKmUsd: clamp(given?.perKmUsd, limits.rate.perKmUsd, fallback.perKmUsd),
        perMinUsd: clamp(given?.perMinUsd, limits.rate.perMinUsd, fallback.perMinUsd),
        minFareUsd: clamp(given?.minFareUsd, limits.rate.minFareUsd, fallback.minFareUsd),
      }
    }
    const holidays = Array.isArray(input.holidays) ? input.holidays.filter(isDate).slice(0, 60) : base.holidays
    const derived = deriveAllRates(costs, intercity)
    const rates = {}
    for (const cat of CATS) {
      if (mode === 'formula') rates[cat] = derived[cat]
      else {
        const m = manualRates[cat]
        rates[cat] = { ...m, perKmIntercityUsd: m.perKmUsd, perMinIntercityUsd: m.perMinUsd, breakdown: derived[cat].breakdown }
      }
    }
    return { version: 1, source: raw ? 'custom' : base.source, mode, costs, manualRates, multipliers, fees, intercity, avgSpeedKmh, holidays, rates }
  }

  const storableConfig = (cfg) => { const { rates, ...rest } = cfg; return rest }
  let active = normalizePricing(null)

  return {
    SR_CATEGORIES: CATS,
    CLASS_PROFILES: classProfiles,
    PRICING_LIMITS: limits,
    DEFAULT_COSTS: spec.defaultCosts,
    deriveClassRates,
    deriveAllRates,
    legacyConfig: spec.legacyConfig,
    recommendedConfig: spec.recommendedConfig,
    normalizePricing,
    storableConfig,
    getActivePricing: () => active,
    setActivePricing: (cfg) => { active = cfg && cfg.rates ? cfg : normalizePricing(cfg); return active },
    resetActivePricing: () => { active = normalizePricing(null); return active },
  }
}
