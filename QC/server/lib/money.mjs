// Server-authoritative CAD pricing for stays and rides. Integer cents only; each line rounds
// half-up once, and totals are sums of the rounded lines so receipts always add up.

export const pct = (cents, bp) => Math.round((cents * bp) / 10_000)

function taxLines(base, keys, taxes) {
  return keys.map((key) => ({ code: key, label: taxes[key].label, rateBp: taxes[key].bp, baseCents: base, cents: pct(base, taxes[key].bp) }))
}

export function stayQuote({ listing, nights, profile }) {
  const { stays, taxes } = profile
  const accommodation = listing.nightlyCents * nights
  const cleaning = listing.cleaningCents
  const lodgingBase = accommodation + cleaning
  const serviceFee = pct(lodgingBase, stays.guestServiceFeeBp)
  const lines = [
    { code: 'ACCOMMODATION', cents: accommodation, nights, nightlyCents: listing.nightlyCents },
    { code: 'CLEANING', cents: cleaning },
    { code: 'SERVICE_FEE', cents: serviceFee, rateBp: stays.guestServiceFeeBp },
  ]
  const taxKeys = stays.taxes ?? taxes.stays
  const lodging = taxKeys.includes('LODGING') ? taxLines(lodgingBase, ['LODGING'], taxes) : []
  const sales = taxLines(lodgingBase + serviceFee, taxKeys.filter((k) => k !== 'LODGING'), taxes)
  const taxTotal = [...lodging, ...sales].reduce((s, l) => s + l.cents, 0)
  const total = lodgingBase + serviceFee + taxTotal
  const commission = pct(lodgingBase, stays.hostCommissionBp)
  return {
    currency: 'CAD',
    lines,
    taxes: [...lodging, ...sales],
    taxStatus: taxes.status,
    subtotalCents: lodgingBase + serviceFee,
    taxCents: taxTotal,
    totalCents: total,
    host: { grossCents: lodgingBase, commissionCents: commission, payoutCents: lodgingBase - commission },
  }
}

// Great-circle distance in metres.
export function haversineM(a, b) {
  const R = 6_371_000
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function rideQuote({ pickup, dropoff, category, profile, surgeBp = 10_000 }) {
  const { rides, taxes } = profile
  const c = rides.categories[category]
  const distanceM = Math.round(haversineM(pickup, dropoff) * rides.roadFactor)
  const durationS = Math.round((distanceM / 1000 / rides.estimatedKmh) * 3600)
  const surge = Math.min(Math.max(surgeBp, 10_000), rides.maxSurgeBp)
  const metered = c.baseCents + Math.round((distanceM / 1000) * c.perKmCents) + Math.round((durationS / 60) * c.perMinCents)
  const fare = pct(Math.max(metered, c.minimumCents), surge)
  const booking = rides.bookingFeeCents
  const tax = taxLines(fare + booking, taxes.rides, taxes)
  const taxTotal = tax.reduce((s, l) => s + l.cents, 0)
  const commission = pct(fare, rides.driverCommissionBp)
  return {
    distanceM,
    durationS,
    breakdown: {
      currency: 'CAD',
      estimate: 'STRAIGHT_LINE_X_ROAD_FACTOR',
      lines: [
        { code: 'FARE', cents: fare, surgeBp: surge, minimumApplied: metered < c.minimumCents },
        { code: 'BOOKING_FEE', cents: booking },
      ],
      taxes: tax,
      taxStatus: taxes.status,
      taxCents: taxTotal,
      totalCents: fare + booking + taxTotal,
      driver: { grossCents: fare, commissionCents: commission, payoutCents: fare - commission },
    },
    totalCents: fare + booking + taxTotal,
  }
}
