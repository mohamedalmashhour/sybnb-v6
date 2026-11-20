// SMART FARE ENGINE (rides capsule) — country-neutral, pure, synchronous.
// ⚠️ Prices are variables (owner 2026-11-20): every rate, fee and multiplier comes from the pricing
// config `cfg` (admin-editable per country) and every place/time rule from the country `market`.
//
// cfg (per country, admin pricing page): { rates: { [category]: { baseUsd, perKmUsd, perMinUsd,
//   minFareUsd, perKmIntercityUsd?, perMinIntercityUsd? } }, fees: { ringFeeUsd, ringWidthKm,
//   ringCount, airportBaseUsd, airportSurchargeUsd, internationalSurchargeUsd, stopFeeUsd, freeBags,
//   bagFeeUsd, baseRiders, extraRiderFeeUsd, liveTrackingUsd, safetyFeePerTripUsd, roundingUsd,
//   minChargeUsd }, multipliers: { peak, trafficMax, night, schedule, weekend, holiday, demand,
//   fuelSurchargePercent }, intercity: { thresholdKm, speedKmh }, avgSpeedKmh, holidays: [YYYY-MM-DD] }
//   (field names say "Usd" for history; the unit is the country's fare currency, market.currency.)
// market (per country, fixed facts): { currency, utcOffsetHours, peakHours: [[from,to],...],
//   nightHours: [from, to], weekendDays: [0-6], fixedHolidays: ['MM-DD'], ringCenter: {lat,lng},
//   airports: [{lat,lng}], airportRadiusKm, qualityFactors: { [category]: x }, defaultDistanceKm }

const R = 6371
export function haversineKm(a, b) {
  const r = (d) => (d * Math.PI) / 180
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
const okPoint = (c) => Boolean(c) && Number.isFinite(c.lat) && Number.isFinite(c.lng)

const localHour = (date, market) => (date.getUTCHours() + (market.utcOffsetHours ?? 0) + 24) % 24
export function isPeakHour(date, market) {
  const h = localHour(date, market)
  return (market.peakHours || []).some(([from, to]) => h >= from && h < to)
}
export function isNightHour(date, market) {
  if (!market.nightHours) return false
  const [from, to] = market.nightHours
  const h = localHour(date, market)
  return from > to ? h >= from || h < to : h >= from && h < to
}
export function isAirportPoint(coords, market) {
  return okPoint(coords) && (market.airports || []).some((a) => haversineKm(coords, a) <= (market.airportRadiusKm ?? 3))
}

// Ring 1..ringCount around the market's ring centre (outside the last ring stays at the last ring).
export function ringOf(coords, fees, market) {
  if (!okPoint(coords) || !market.ringCenter) return null
  const ring = Math.floor(haversineKm(coords, market.ringCenter) / fees.ringWidthKm) + 1
  return Math.min(fees.ringCount, Math.max(1, ring))
}
// A trip is priced by its OUTER ring.
export function ringFee(pickup, dropoff, fees, market) {
  const rings = [ringOf(pickup, fees, market), ringOf(dropoff, fees, market)].filter(Boolean)
  const ring = rings.length ? Math.max(...rings) : null
  return { ring, fee: ring ? (ring - 1) * fees.ringFeeUsd : 0 }
}
// Holidays beat the weekend factor (no stacking). Dates are read in market local time.
export function dayFactor(date, cfg, market) {
  const local = new Date(date.getTime() + (market.utcOffsetHours ?? 0) * 3600 * 1000)
  const iso = local.toISOString().slice(0, 10)
  if ((market.fixedHolidays || []).includes(iso.slice(5)) || (cfg.holidays || []).includes(iso)) return { type: 'holiday', multiplier: cfg.multipliers.holiday }
  if ((market.weekendDays || []).includes(local.getUTCDay())) return { type: 'weekend', multiplier: cfg.multipliers.weekend }
  return { type: 'weekday', multiplier: 1 }
}

function cityMinutes(distanceKm, cfg) {
  const cityKm = Math.min(distanceKm, cfg.intercity.thresholdKm)
  const longKm = Math.max(0, distanceKm - cfg.intercity.thresholdKm)
  return (cityKm / cfg.avgSpeedKmh) * 60 + (longKm / cfg.intercity.speedKmh) * 60
}

// Government per-trip dues and sales taxes (country settings in market.rideCharges; null for Syria).
// Québec: $0.90 dues shown separately (split on shared rides), then GST 5% + QST 9.975% on fare + dues.
// Each line carries the ACCOUNT it is recorded in for remittance (GST_QST or RIDE_DUES).
export function governmentCharges(fareMinor, market, sharedRiders = 1) {
  const rc = market?.rideCharges
  if (!rc) return null
  const share = Math.max(1, Math.floor(Number(sharedRiders) || 1))
  const duesMinor = rc.perTripDuesMinor ? Math.round(rc.perTripDuesMinor / share) : 0
  const base = fareMinor + duesMinor
  const taxes = (rc.taxes || []).map((t) => ({ code: t.code, account: t.account || 'GST_QST', label: t.label, rateBp: t.bp, baseMinor: base, minor: Math.round((base * t.bp) / 10_000) }))
  const taxMinor = taxes.reduce((sum, t) => sum + t.minor, 0)
  return { duesMinor, duesAccount: rc.duesAccount || 'RIDE_DUES', duesLabel: rc.duesLabel, taxes, taxMinor, totalMinor: base + taxMinor, taxStatus: rc.taxStatus }
}

// Inputs are already geocoded points (the country's geocoder resolves place names).
export function smartFare({ cfg, market, category, pickupCoords, dropoffCoords, stopCoords = [], stopsCount, internationalTrip = false,
  riderCount, bagCount, scheduled, lowDataMode, distanceKmOverride, estimatedMinutesOverride, trafficMultiplierOverride, now, sharedRiders }) {
  const rates = cfg.rates[category] || cfg.rates[market.fallbackCategory] || Object.values(cfg.rates)[0]
  const fees = cfg.fees
  const mult = cfg.multipliers

  let distanceKm = market.defaultDistanceKm ?? 5
  let estimated = true
  let distanceSource = 'estimate'
  if (Number.isFinite(distanceKmOverride) && distanceKmOverride > 0) {
    distanceKm = Math.max(1, distanceKmOverride); estimated = false; distanceSource = 'google'
  } else {
    const routePoints = [pickupCoords, ...stopCoords, dropoffCoords]
    if (routePoints.every(Boolean)) {
      let total = 0
      for (let i = 0; i < routePoints.length - 1; i += 1) total += haversineKm(routePoints[i], routePoints[i + 1])
      distanceKm = Math.max(1, total); estimated = false; distanceSource = 'gazetteer'
    }
  }
  const estimatedMinutes = Number.isFinite(estimatedMinutesOverride) && estimatedMinutesOverride > 0
    ? Math.round(estimatedMinutesOverride)
    : Math.max(1, Math.round(cityMinutes(distanceKm, cfg)))

  const airportTrip = isAirportPoint(pickupCoords, market) || isAirportPoint(dropoffCoords, market)
  const airportSurcharge = airportTrip ? fees.airportSurchargeUsd : 0
  const internationalSurcharge = internationalTrip ? fees.internationalSurchargeUsd : 0
  const zone = ringFee(pickupCoords, dropoffCoords, fees, market)
  let ringFeeApplied = zone.fee
  let rawBase
  if (airportTrip) {
    // Fixed anchor (centre <-> airport) scaled by car quality + the ring fee of the other end.
    const otherEnd = isAirportPoint(pickupCoords, market) ? dropoffCoords : pickupCoords
    const otherRing = ringOf(otherEnd, fees, market)
    ringFeeApplied = otherRing ? (otherRing - 1) * fees.ringFeeUsd : 0
    const quality = market.qualityFactors?.[category] ?? 1
    rawBase = fees.airportBaseUsd * quality + ringFeeApplied + (lowDataMode ? 0 : fees.liveTrackingUsd) + fees.safetyFeePerTripUsd + internationalSurcharge
  } else {
    const cityKm = Math.min(distanceKm, cfg.intercity.thresholdKm)
    const longKm = Math.max(0, distanceKm - cfg.intercity.thresholdKm)
    rawBase = rates.baseUsd + zone.fee
      + rates.perKmUsd * cityKm + (rates.perKmIntercityUsd ?? rates.perKmUsd) * longKm
      + rates.perMinUsd * estimatedMinutes * (1 - longKm / distanceKm)
      + (rates.perMinIntercityUsd ?? rates.perMinUsd) * estimatedMinutes * (longKm / distanceKm)
      + fees.safetyFeePerTripUsd + (lowDataMode ? 0 : fees.liveTrackingUsd) + airportSurcharge + internationalSurcharge
  }
  const baseFare = Math.max(rates.minFareUsd || 0, fees.minChargeUsd || 0, rawBase)

  const stops = Number.isInteger(stopsCount) ? stopsCount : stopCoords.length
  const stopsFee = stops * fees.stopFeeUsd
  const bags = Math.max(0, Math.floor(Number(bagCount) || 0))
  const bagsFee = Math.max(0, bags - fees.freeBags) * fees.bagFeeUsd
  const riders = Math.max(1, Math.floor(Number(riderCount) || 1))
  const ridersFee = Math.max(0, riders - fees.baseRiders) * fees.extraRiderFeeUsd
  const preFactor = baseFare + stopsFee + bagsFee + ridersFee

  const nowDate = now instanceof Date ? now : new Date()
  const peak = isPeakHour(nowDate, market)
  const night = isNightHour(nowDate, market)
  let trafficMultiplier, trafficSource
  if (Number.isFinite(trafficMultiplierOverride) && trafficMultiplierOverride >= 1) {
    trafficMultiplier = Math.min(mult.trafficMax, trafficMultiplierOverride); trafficSource = 'google'
  } else {
    trafficMultiplier = peak ? mult.peak : 1; trafficSource = peak ? 'peak-proxy' : 'none'
  }
  const nightMultiplier = night ? mult.night : 1
  const day = dayFactor(nowDate, cfg, market)
  const scheduleMultiplier = scheduled ? mult.schedule : 1
  const fuelMultiplier = 1 + mult.fuelSurchargePercent / 100
  const demandMultiplier = mult.demand
  const combined = fuelMultiplier * trafficMultiplier * nightMultiplier * scheduleMultiplier * demandMultiplier * day.multiplier
  // Optional flat booking fee (not surged), e.g. Québec; 0 when the country sets none (Syria).
  const bookingFee = Number(fees.bookingFeeUsd) || 0
  const varied = preFactor * combined + bookingFee
  // Round the charged fare UP to the nearest step (never down). market.fareMinorDigits: 0 = whole
  // units (Syria, 1 minor = $1), 2 = cents (Canada). The step is fees.roundingUsd in currency units.
  const scale = 10 ** (market.fareMinorDigits || 0)
  const stepMinor = Math.max(1, Math.round(fees.roundingUsd * scale))
  const minChargeMinor = Math.ceil((fees.minChargeUsd || 0) * scale - 1e-9)
  const fareMinor = Math.max(minChargeMinor, Math.ceil((varied * scale) / stepMinor - 1e-9) * stepMinor)

  const charges = governmentCharges(fareMinor, market, sharedRiders)

  return {
    fareMinor, currency: market.currency,
    distanceKm: Math.round(distanceKm * 10) / 10, estimatedMinutes, estimated, distanceSource,
    baseFareMinor: Math.ceil(baseFare), ring: zone.ring, ringFee: ringFeeApplied,
    dayType: day.type, dateMultiplier: day.multiplier,
    airportSurcharge, airportTrip, internationalSurcharge, internationalTrip,
    stopsCount: stops, stopsFee, ...(bookingFee ? { bookingFee } : {}), bagCount: bags, bagsFee, riderCount: riders, ridersFee,
    fuelSurchargePercent: mult.fuelSurchargePercent,
    trafficMultiplier: Math.round(trafficMultiplier * 1000) / 1000, trafficSource,
    isPeak: peak, isNight: night, nightMultiplier, scheduled: Boolean(scheduled), scheduleMultiplier,
    demandMultiplier, surgeMultiplier: Math.round(combined * 1000) / 1000,
    ...(charges ? { charges } : {}),
  }
}
