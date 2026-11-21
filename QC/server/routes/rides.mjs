// SR: rider quotes and requests, driver availability, atomic dispatch and the trip lifecycle.
import { randomBytes, randomInt } from 'node:crypto'
import { db, audit, isUniqueViolation } from '../lib/db.mjs'
import { HttpError, badRequest, conflict, forbidden, notFound, num, oneOf, str } from '../lib/http.mjs'
import { requireRole, requireUser } from '../lib/auth.mjs'
import { todayIn } from '../lib/dates.mjs'
import { haversineM, rideQuote } from '../lib/money.mjs'
import { captureRide, createRideCheckout, paymentsMode, releaseRide } from '../lib/payments.mjs'

const ACTIVE = ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS']
const OFFER_RADIUS_M = 15_000
const SCHEDULE_MIN_MS = 30 * 60_000
const SCHEDULE_MAX_MS = 30 * 86_400_000
// A card authorization lasts about 7 days, so card-paid rides can be scheduled at most 6 days ahead.
const SCHEDULE_MAX_CARD_MS = 6 * 86_400_000
const OFFER_LEAD_MS = 30 * 60_000
const RATE_WINDOW_MS = 7 * 86_400_000
const TIP_WINDOW_MS = 30 * 86_400_000
const SHARE_AFTER_MS = 2 * 3_600_000 // a shared trip link keeps working 2 hours after the trip ends

// Driver -> next status, with the event recorded in the trip safety record.
const TRANSITIONS = {
  arrive: { from: 'ACCEPTED', to: 'ARRIVED', event: 'DRIVER_ARRIVED' },
  start: { from: 'ARRIVED', to: 'IN_PROGRESS', event: 'TRIP_STARTED' },
  complete: { from: 'IN_PROGRESS', to: 'COMPLETED', event: 'TRIP_COMPLETED' },
}

function point(v, field, bounds) {
  if (!v || typeof v !== 'object') throw badRequest('FIELD_REQUIRED', `${field} is required.`, { field })
  const lat = num(v.lat, `${field}.lat`, { min: -90, max: 90 })
  const lng = num(v.lng, `${field}.lng`, { min: -180, max: 180 })
  if (lat < bounds.minLat || lat > bounds.maxLat || lng < bounds.minLng || lng > bounds.maxLng) {
    throw badRequest('OUTSIDE_SERVICE_AREA', `${field} is outside the Québec service area.`, { field })
  }
  return { lat, lng, label: str(v.label, `${field}.label`, { max: 200, optional: true }) }
}

const rideView = (r, viewer) => ({
  id: r.id, status: r.status, category: r.category, pickup: r.pickup, dropoff: r.dropoff, scheduledFor: r.scheduledFor,
  pet: r.pet, accessible: r.accessible, tipCents: r.tipCents,
  // The rider sees the PIN and share link; the driver must ask the rider for the PIN.
  pickupPin: viewer === 'driver' ? undefined : r.pickupPin, shareToken: viewer === 'driver' ? undefined : r.shareToken,
  myRating: viewer === 'driver' ? r.driverRating : r.riderRating, ratedByOther: viewer === 'driver' ? r.riderRating != null : r.driverRating != null,
  totalCents: r.totalCents, breakdown: viewer === 'driver' ? { driver: r.breakdown.driver, currency: 'CAD' } : r.breakdown,
  createdAt: r.createdAt, acceptedAt: r.acceptedAt, completedAt: r.completedAt, cancelledBy: r.cancelledBy,
  driver: r.driver ? { name: r.driver.name, vehicle: r.driver.driver?.vehicle, category: r.driver.driver?.category, lat: r.driver.driver?.lat, lng: r.driver.driver?.lng, rating: r.driverRatingSummary, photo: viewer === 'driver' ? undefined : r.driver.driver?.photo } : null,
  rider: viewer === 'driver' && r.rider ? { name: r.rider.name } : undefined,
  events: r.events?.map((e) => ({ type: e.type, at: e.at, data: e.data })),
})

const rideInclude = { driver: { include: { driver: true } }, rider: true, events: { orderBy: { at: 'asc' } } }

// Average rating riders gave a driver (shown to riders once the driver has 3+ ratings).
async function withDriverRating(r) {
  if (!r?.driverId) return r
  const agg = await db().ride.aggregate({ where: { driverId: r.driverId, riderRating: { not: null } }, _avg: { riderRating: true }, _count: { riderRating: true } })
  r.driverRatingSummary = agg._count.riderRating >= 3 ? { average: Math.round(agg._avg.riderRating * 10) / 10, count: agg._count.riderRating } : null
  return r
}
const bool = (v) => v === true || v === 'true'
const stars = (v) => { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 5) throw badRequest('INVALID_RATING', 'Rating must be 1 to 5 stars.', { field: 'rating' }); return n }

// The server decides whether a driver may work: approved role, profile present, documents current.
async function eligibleDriver(ctx, profile) {
  const user = requireRole(ctx, 'DRIVER')
  const driver = await db().driverProfile.findUnique({ where: { userId: user.id } })
  if (!driver) throw forbidden('Your driver profile is not set up.')
  const today = todayIn(profile.timezone)
  if (driver.licenceExpiry <= today || driver.insuranceExpiry <= today) {
    throw forbidden('Your licence or insurance has expired. Upload renewed documents to drive again.')
  }
  return { user, driver }
}

export function rideRoutes(router, { profile }) {
  const bounds = profile.rides.serviceBounds
  const categories = Object.keys(profile.rides.categories)

  router.add('GET /api/rides/categories', async () => ({
    ok: true,
    categories: Object.entries(profile.rides.categories).map(([code, c]) => ({ code, name: c.name, blurb: c.blurb, seats: c.seats })),
    options: { petFeeCents: profile.rides.options?.petFeeCents ?? 0, accessible: Boolean(profile.rides.options?.accessible), maxTipCents: profile.rides.options?.maxTipCents ?? 0 },
    regulatoryFee: profile.rides.regulatoryFee ?? null,
  }))

  // Cars available around a point, for the request map. Positions are blurred (~150 m) and carry no
  // identity; only drivers seen in the last 2 minutes count. No sign-in needed (Uber shows this too).
  router.add('GET /api/rides/nearby', async ({ query }) => {
    const lat = num(query.lat, 'lat', { min: -90, max: 90 })
    const lng = num(query.lng, 'lng', { min: -180, max: 180 })
    const category = query.category && profile.rides.categories[query.category] ? query.category : undefined
    const since = new Date(Date.now() - 2 * 60_000)
    const box = 0.06 // ≈ 6 km
    const drivers = await db().driverProfile.findMany({
      where: { online: true, lastSeenAt: { gte: since }, lat: { gte: lat - box, lte: lat + box }, lng: { gte: lng - box, lte: lng + box }, ...(category ? { category } : {}) },
      select: { lat: true, lng: true }, take: 30,
    })
    const blur = () => (Math.random() - 0.5) * 0.003
    return { ok: true, count: drivers.length, cars: drivers.slice(0, 15).map((d) => ({ lat: Math.round((d.lat + blur()) * 1e4) / 1e4, lng: Math.round((d.lng + blur()) * 1e4) / 1e4 })) }
  })

  // Public, read-only trip view for a contact the rider shared the link with. No prices, no PIN.
  router.add('GET /api/share/:token', async ({ params }) => {
    const r = await db().ride.findUnique({ where: { shareToken: String(params.token).slice(0, 64) }, include: rideInclude })
    const ended = r && !['PAYMENT_PENDING', 'REQUESTED', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'].includes(r.status)
    const endedAt = r?.completedAt ?? r?.events?.at(-1)?.at
    if (!r || (ended && (!endedAt || Date.now() - new Date(endedAt).getTime() > SHARE_AFTER_MS))) throw notFound()
    return { ok: true, trip: {
      status: r.status, pickup: { label: r.pickup.label }, dropoff: { label: r.dropoff.label },
      driver: r.driver ? { name: r.driver.name?.split(' ')[0], vehicle: r.driver.driver?.vehicle, lat: r.driver.driver?.lat, lng: r.driver.driver?.lng } : null,
      events: r.events.map((e) => ({ type: e.type, at: e.at })),
    } }
  })

  router.add('POST /api/rides/quote', async ({ ctx, body }) => {
    const user = requireUser(ctx)
    const pickup = point(body.pickup, 'pickup', bounds)
    const dropoff = point(body.dropoff, 'dropoff', bounds)
    const category = oneOf(body.category ?? 'STANDARD', 'category', categories)
    if (haversineM(pickup, dropoff) < 200) throw badRequest('TRIP_TOO_SHORT', 'Pickup and drop-off are too close together.')
    const options = { pet: bool(body.pet), accessible: bool(body.accessible) }
    if (options.pet && !profile.rides.options?.petFeeCents) throw badRequest('OPTION_UNAVAILABLE', 'Pet rides are not offered.')
    if (options.accessible && !profile.rides.options?.accessible) throw badRequest('OPTION_UNAVAILABLE', 'Accessible rides are not offered.')
    const q = rideQuote({ pickup, dropoff, category, profile, options })
    const quote = await db().rideQuote.create({
      data: {
        riderId: user.id, category, pickup, dropoff, distanceM: q.distanceM, durationS: q.durationS,
        breakdown: q.breakdown, totalCents: q.totalCents, expiresAt: new Date(Date.now() + profile.rides.quoteTtlSeconds * 1000),
      },
    })
    return { status: 201, body: { ok: true, quote: { id: quote.id, category, distanceM: q.distanceM, durationS: q.durationS, breakdown: q.breakdown, totalCents: q.totalCents, expiresAt: quote.expiresAt } } }
  })

  router.add('POST /api/rides', async ({ ctx, body }) => {
    const user = requireUser(ctx)
    const quoteId = str(body.quoteId, 'quoteId', { max: 40 })
    const mode = paymentsMode()
    if (mode === 'disabled') throw new HttpError(503, 'PAYMENTS_DISABLED', 'Online payment is not available yet.')
    let scheduledFor = null
    if (body.scheduledFor) {
      scheduledFor = new Date(body.scheduledFor)
      const lead = scheduledFor.getTime() - Date.now()
      const max = mode === 'stripe' ? SCHEDULE_MAX_CARD_MS : SCHEDULE_MAX_MS
      if (Number.isNaN(lead) || lead < SCHEDULE_MIN_MS || lead > max) {
        throw badRequest('INVALID_SCHEDULE', `Scheduled rides must be between 30 minutes and ${max / 86_400_000} days from now.`, { field: 'scheduledFor' })
      }
    }
    // An earlier ride the rider never paid for is abandoned when they request a new one.
    const abandoned = await db().ride.findMany({ where: { riderId: user.id, status: 'PAYMENT_PENDING' }, select: { id: true } })
    for (const a of abandoned) {
      await db().ride.updateMany({ where: { id: a.id, status: 'PAYMENT_PENDING' }, data: { status: 'CANCELLED', cancelledBy: 'RIDER' } })
      await releaseRide(a.id, user.id)
    }
    const ride = await db().$transaction(async (tx) => {
      const claimed = await tx.rideQuote.updateMany({ where: { id: quoteId, riderId: user.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } })
      if (claimed.count !== 1) throw conflict('QUOTE_EXPIRED', 'This price has expired. Get a new quote.')
      const active = await tx.ride.findFirst({ where: { riderId: user.id, scheduledFor: null, status: { in: ['REQUESTED', ...ACTIVE] } } })
      if (active && !scheduledFor) throw conflict('RIDE_IN_PROGRESS', 'You already have a ride in progress.')
      const q = await tx.rideQuote.findUnique({ where: { id: quoteId } })
      const created = await tx.ride.create({
        data: {
          quoteId: q.id, riderId: user.id, category: q.category, pickup: q.pickup, dropoff: q.dropoff, scheduledFor, totalCents: q.totalCents, breakdown: q.breakdown,
          status: mode === 'stripe' ? 'PAYMENT_PENDING' : 'REQUESTED',
          pet: Boolean(q.breakdown.options?.pet), accessible: Boolean(q.breakdown.options?.accessible),
          pickupPin: String(randomInt(0, 10_000)).padStart(4, '0'), shareToken: randomBytes(18).toString('base64url'),
        },
      })
      await tx.rideEvent.create({ data: { rideId: created.id, type: 'REQUESTED', actorId: user.id, data: { scheduledFor } } })
      return created
    })
    const checkoutUrl = mode === 'stripe' ? await createRideCheckout({ ride, user }) : undefined
    return { status: 201, body: { ok: true, ride: rideView(ride), checkoutUrl } }
  })

  router.add('GET /api/rides', async ({ ctx }) => {
    const user = requireUser(ctx)
    const rides = await db().ride.findMany({ where: { riderId: user.id }, include: rideInclude, orderBy: { createdAt: 'desc' }, take: 50 })
    return { ok: true, rides: rides.map((r) => rideView(r)) }
  })

  router.add('GET /api/rides/:id', async ({ ctx, params }) => {
    const user = requireUser(ctx)
    const r = await withDriverRating(await db().ride.findUnique({ where: { id: params.id }, include: rideInclude }))
    if (!r) throw notFound()
    if (r.riderId === user.id || user.roles.includes('ADMIN')) return { ok: true, ride: rideView(r) }
    if (r.driverId === user.id) return { ok: true, ride: rideView(r, 'driver') }
    throw notFound()
  })

  router.add('POST /api/rides/:id/cancel', async ({ ctx, params }) => {
    const user = requireUser(ctx)
    const r = await db().ride.findUnique({ where: { id: params.id } })
    if (!r) throw notFound()
    if (r.riderId === user.id) {
      const updated = await db().ride.updateMany({ where: { id: r.id, status: { in: ['PAYMENT_PENDING', 'REQUESTED', 'ACCEPTED', 'ARRIVED'] } }, data: { status: 'CANCELLED', cancelledBy: 'RIDER' } })
      if (updated.count !== 1) throw conflict('NOT_CANCELLABLE', 'This ride can no longer be cancelled.')
      await db().rideEvent.create({ data: { rideId: r.id, type: 'CANCELLED_BY_RIDER', actorId: user.id, data: { previous: r.status } } })
      await releaseRide(r.id, user.id)
      return { ok: true }
    }
    if (r.driverId === user.id) {
      // A driver backing out returns the request to the queue for another driver.
      const updated = await db().ride.updateMany({ where: { id: r.id, driverId: user.id, status: { in: ['ACCEPTED', 'ARRIVED'] } }, data: { status: 'REQUESTED', driverId: null, acceptedAt: null } })
      if (updated.count !== 1) throw conflict('NOT_CANCELLABLE', 'This ride can no longer be released.')
      await db().rideEvent.create({ data: { rideId: r.id, type: 'RELEASED_BY_DRIVER', actorId: user.id } })
      return { ok: true }
    }
    throw notFound()
  })

  // Rider rates the driver (1-5 stars, optional comment) within 7 days of the trip.
  router.add('POST /api/rides/:id/rate', async ({ ctx, params, body }) => {
    const user = requireUser(ctx)
    const rating = stars(body.rating)
    const comment = str(body.comment, 'comment', { max: 500, optional: true }) || null
    const since = new Date(Date.now() - RATE_WINDOW_MS)
    const updated = await db().ride.updateMany({ where: { id: params.id, riderId: user.id, status: 'COMPLETED', riderRating: null, completedAt: { gte: since } }, data: { riderRating: rating, riderComment: comment } })
    if (updated.count !== 1) throw conflict('CANNOT_RATE', 'This trip can no longer be rated.')
    await db().rideEvent.create({ data: { rideId: params.id, type: 'RIDER_RATED_DRIVER', actorId: user.id, data: { rating } } })
    return { ok: true }
  })

  // Tip: once per trip, within 30 days, 100% to the driver, no commission and no tax.
  router.add('POST /api/rides/:id/tip', async ({ ctx, params, body }) => {
    const user = requireUser(ctx)
    const max = profile.rides.options?.maxTipCents ?? 0
    const cents = Math.round(num(body.cents, 'cents', { min: 100, max: Math.max(max, 100) }))
    if (!max) throw badRequest('TIPS_UNAVAILABLE', 'Tips are not offered.')
    if (paymentsMode() !== 'simulated') throw new HttpError(503, 'TIPS_NOT_AVAILABLE_YET', 'Card tips are not available yet.')
    const since = new Date(Date.now() - TIP_WINDOW_MS)
    const updated = await db().ride.updateMany({ where: { id: params.id, riderId: user.id, status: 'COMPLETED', tipCents: 0, completedAt: { gte: since } }, data: { tipCents: cents } })
    if (updated.count !== 1) throw conflict('CANNOT_TIP', 'This trip can no longer receive a tip.')
    await db().rideEvent.create({ data: { rideId: params.id, type: 'TIP_ADDED', actorId: user.id, data: { cents } } })
    await audit(db(), user.id, 'ride.tip', params.id, { cents })
    return { ok: true, tipCents: cents }
  })

  // SOS: rider or driver during an active trip. Appended to the trip record (kept past the 7-day
  // purge) and flagged for the safety team. The app always tells the person to call 911 first.
  router.add('POST /api/rides/:id/sos', async ({ ctx, params, body }) => {
    const user = requireUser(ctx)
    const r = await db().ride.findUnique({ where: { id: params.id }, include: { driver: { include: { driver: true } } } })
    if (!r || (r.riderId !== user.id && r.driverId !== user.id)) throw notFound()
    if (!['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'].includes(r.status)) throw conflict('NOT_ACTIVE', 'SOS is available during an active trip.')
    const at = body.lat != null && body.lng != null ? { lat: num(body.lat, 'lat', { min: -90, max: 90 }), lng: num(body.lng, 'lng', { min: -180, max: 180 }) } : (r.driver?.driver?.lat != null ? { lat: r.driver.driver.lat, lng: r.driver.driver.lng } : null)
    await db().rideEvent.create({ data: { rideId: r.id, type: 'SOS', actorId: user.id, data: { by: r.riderId === user.id ? 'RIDER' : 'DRIVER', at } } })
    await audit(db(), user.id, 'ride.sos', r.id, { at })
    console.error(`[qc-safety] SOS on ride ${r.id} by ${r.riderId === user.id ? 'rider' : 'driver'}`)
    return { ok: true, emergencyNumber: '911' }
  })

  // ---- Driver ----
  router.add('POST /api/driver/status', async ({ ctx, body }) => {
    const { user } = await eligibleDriver(ctx, profile)
    const online = Boolean(body.online)
    const data = { online, lastSeenAt: new Date() }
    if (body.acceptsPets != null) data.acceptsPets = bool(body.acceptsPets)
    if (body.accessible != null) data.accessible = bool(body.accessible)
    if (body.lat != null || body.lng != null) {
      const p = point({ lat: body.lat, lng: body.lng }, 'position', bounds)
      Object.assign(data, { lat: p.lat, lng: p.lng })
    }
    const driver = await db().driverProfile.update({ where: { userId: user.id }, data })
    return { ok: true, driver: { online: driver.online, lat: driver.lat, lng: driver.lng, category: driver.category, acceptsPets: driver.acceptsPets, accessible: driver.accessible } }
  })

  router.add('GET /api/driver/offers', async ({ ctx }) => {
    const { driver } = await eligibleDriver(ctx, profile)
    if (!driver.online || driver.lat == null) return { ok: true, offers: [] }
    const horizon = new Date(Date.now() + OFFER_LEAD_MS)
    const rides = await db().ride.findMany({
      where: {
        status: 'REQUESTED', category: driver.category, OR: [{ scheduledFor: null }, { scheduledFor: { lte: horizon } }],
        ...(driver.acceptsPets ? {} : { pet: false }), ...(driver.accessible ? {} : { accessible: false }),
      },
      orderBy: { createdAt: 'asc' }, take: 100,
    })
    const offers = rides
      .map((r) => ({ ride: r, pickupDistanceM: Math.round(haversineM(driver, r.pickup)) }))
      .filter((o) => o.pickupDistanceM <= OFFER_RADIUS_M)
      .sort((a, b) => a.pickupDistanceM - b.pickupDistanceM)
      .slice(0, 10)
      .map((o) => ({ ...rideView(o.ride, 'driver'), pickupDistanceM: o.pickupDistanceM }))
    return { ok: true, offers }
  })

  router.add('POST /api/driver/rides/:id/accept', async ({ ctx, params }) => {
    const { user, driver } = await eligibleDriver(ctx, profile)
    if (!driver.online) throw conflict('OFFLINE', 'Go online to accept rides.')
    try {
      const updated = await db().ride.updateMany({
        where: {
          id: params.id, status: 'REQUESTED', driverId: null, category: driver.category, riderId: { not: user.id },
          ...(driver.acceptsPets ? {} : { pet: false }), ...(driver.accessible ? {} : { accessible: false }),
        },
        data: { status: 'ACCEPTED', driverId: user.id, acceptedAt: new Date() },
      })
      if (updated.count !== 1) throw conflict('RIDE_TAKEN', 'This ride is no longer available.')
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('ACTIVE_RIDE', 'Finish your current ride first.')
      throw err
    }
    await db().rideEvent.create({ data: { rideId: params.id, type: 'ACCEPTED', actorId: user.id, data: { vehicle: driver.vehicle, at: { lat: driver.lat, lng: driver.lng } } } })
    const r = await db().ride.findUnique({ where: { id: params.id }, include: rideInclude })
    return { ok: true, ride: rideView(r, 'driver') }
  })

  for (const [action, t] of Object.entries(TRANSITIONS)) {
    router.add(`POST /api/driver/rides/:id/${action}`, async ({ ctx, params, body }) => {
      const { user, driver } = await eligibleDriver(ctx, profile)
      if (action === 'start') {
        // The rider gives the driver their 4-digit code: proof the right person is in the right car.
        const ride = await db().ride.findFirst({ where: { id: params.id, driverId: user.id, status: 'ARRIVED' }, select: { pickupPin: true } })
        if (ride?.pickupPin && String(body?.pin ?? '').trim() !== ride.pickupPin) throw badRequest('WRONG_PIN', 'Wrong code. Ask the rider for the 4-digit code shown in their app.', { field: 'pin' })
      }
      const data = { status: t.to }
      if (t.to === 'COMPLETED') data.completedAt = new Date()
      const updated = await db().ride.updateMany({ where: { id: params.id, driverId: user.id, status: t.from }, data })
      if (updated.count !== 1) throw conflict('INVALID_STATE', `This ride is not ${t.from.toLowerCase()}.`)
      await db().rideEvent.create({ data: { rideId: params.id, type: t.event, actorId: user.id, data: { at: { lat: driver.lat, lng: driver.lng } } } })
      if (t.to === 'COMPLETED') {
        await audit(db(), user.id, 'ride.completed', params.id)
        await captureRide(params.id, user.id)
      }
      const r = await db().ride.findUnique({ where: { id: params.id }, include: rideInclude })
      return { ok: true, ride: rideView(r, 'driver') }
    })
  }

  // Driver profile photo: a small JPEG the app resizes before upload (≤ 200 KB).
  router.add('POST /api/driver/photo', async ({ ctx, body }) => {
    const { user } = await eligibleDriver(ctx, profile)
    const photo = String(body.photo ?? '')
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo) || photo.length > 280_000) throw badRequest('INVALID_PHOTO', 'Photo must be a JPEG/PNG/WebP under 200 KB.', { field: 'photo' })
    await db().driverProfile.update({ where: { userId: user.id }, data: { photo } })
    await audit(db(), user.id, 'driver.photo', user.id, {})
    return { ok: true }
  })

  router.add('POST /api/driver/rides/:id/rate', async ({ ctx, params, body }) => {
    const { user } = await eligibleDriver(ctx, profile)
    const rating = stars(body.rating)
    const since = new Date(Date.now() - RATE_WINDOW_MS)
    const updated = await db().ride.updateMany({ where: { id: params.id, driverId: user.id, status: 'COMPLETED', driverRating: null, completedAt: { gte: since } }, data: { driverRating: rating } })
    if (updated.count !== 1) throw conflict('CANNOT_RATE', 'This trip can no longer be rated.')
    await db().rideEvent.create({ data: { rideId: params.id, type: 'DRIVER_RATED_RIDER', actorId: user.id, data: { rating } } })
    return { ok: true }
  })

  router.add('GET /api/driver/rides', async ({ ctx }) => {
    const { user, driver } = await eligibleDriver(ctx, profile)
    const rides = await db().ride.findMany({ where: { driverId: user.id }, include: rideInclude, orderBy: { createdAt: 'desc' }, take: 100 })
    const done = rides.filter((r) => r.status === 'COMPLETED')
    const earningsCents = done.reduce((s, r) => s + r.breakdown.driver.payoutCents + (r.tipCents ?? 0), 0)
    const tipsCents = done.reduce((s, r) => s + (r.tipCents ?? 0), 0)
    const rated = done.filter((r) => r.riderRating != null)
    const rating = rated.length ? Math.round((rated.reduce((s, r) => s + r.riderRating, 0) / rated.length) * 10) / 10 : null
    const status = { online: driver.online, lat: driver.lat, lng: driver.lng, category: driver.category, vehicle: driver.vehicle, acceptsPets: driver.acceptsPets, accessible: driver.accessible, rating, ratingCount: rated.length, hasPhoto: Boolean(driver.photo), photo: driver.photo }
    return { ok: true, rides: rides.map((r) => rideView(r, 'driver')), earningsCents, tipsCents, driver: status }
  })
}
