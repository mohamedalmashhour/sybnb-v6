// SR: rider quotes and requests, driver availability, atomic dispatch and the trip lifecycle.
import { db, audit, isUniqueViolation } from '../lib/db.mjs'
import { badRequest, conflict, forbidden, notFound, num, oneOf, str } from '../lib/http.mjs'
import { requireRole, requireUser } from '../lib/auth.mjs'
import { todayIn } from '../lib/dates.mjs'
import { haversineM, rideQuote } from '../lib/money.mjs'

const ACTIVE = ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS']
const OFFER_RADIUS_M = 15_000
const SCHEDULE_MIN_MS = 30 * 60_000
const SCHEDULE_MAX_MS = 30 * 86_400_000
const OFFER_LEAD_MS = 30 * 60_000

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
  totalCents: r.totalCents, breakdown: viewer === 'driver' ? { driver: r.breakdown.driver, currency: 'CAD' } : r.breakdown,
  createdAt: r.createdAt, acceptedAt: r.acceptedAt, completedAt: r.completedAt, cancelledBy: r.cancelledBy,
  driver: r.driver ? { name: r.driver.name, vehicle: r.driver.driver?.vehicle, category: r.driver.driver?.category, lat: r.driver.driver?.lat, lng: r.driver.driver?.lng } : null,
  rider: viewer === 'driver' && r.rider ? { name: r.rider.name } : undefined,
  events: r.events?.map((e) => ({ type: e.type, at: e.at, data: e.data })),
})

const rideInclude = { driver: { include: { driver: true } }, rider: true, events: { orderBy: { at: 'asc' } } }

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

  router.add('POST /api/rides/quote', async ({ ctx, body }) => {
    const user = requireUser(ctx)
    const pickup = point(body.pickup, 'pickup', bounds)
    const dropoff = point(body.dropoff, 'dropoff', bounds)
    const category = oneOf(body.category ?? 'STANDARD', 'category', categories)
    if (haversineM(pickup, dropoff) < 200) throw badRequest('TRIP_TOO_SHORT', 'Pickup and drop-off are too close together.')
    const q = rideQuote({ pickup, dropoff, category, profile })
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
    let scheduledFor = null
    if (body.scheduledFor) {
      scheduledFor = new Date(body.scheduledFor)
      const lead = scheduledFor.getTime() - Date.now()
      if (Number.isNaN(lead) || lead < SCHEDULE_MIN_MS || lead > SCHEDULE_MAX_MS) {
        throw badRequest('INVALID_SCHEDULE', 'Scheduled rides must be between 30 minutes and 30 days from now.', { field: 'scheduledFor' })
      }
    }
    const ride = await db().$transaction(async (tx) => {
      const claimed = await tx.rideQuote.updateMany({ where: { id: quoteId, riderId: user.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } })
      if (claimed.count !== 1) throw conflict('QUOTE_EXPIRED', 'This price has expired. Get a new quote.')
      const active = await tx.ride.findFirst({ where: { riderId: user.id, scheduledFor: null, status: { in: ['REQUESTED', ...ACTIVE] } } })
      if (active && !scheduledFor) throw conflict('RIDE_IN_PROGRESS', 'You already have a ride in progress.')
      const q = await tx.rideQuote.findUnique({ where: { id: quoteId } })
      const created = await tx.ride.create({
        data: { quoteId: q.id, riderId: user.id, category: q.category, pickup: q.pickup, dropoff: q.dropoff, scheduledFor, totalCents: q.totalCents, breakdown: q.breakdown },
      })
      await tx.rideEvent.create({ data: { rideId: created.id, type: 'REQUESTED', actorId: user.id, data: { scheduledFor } } })
      return created
    })
    return { status: 201, body: { ok: true, ride: rideView(ride) } }
  })

  router.add('GET /api/rides', async ({ ctx }) => {
    const user = requireUser(ctx)
    const rides = await db().ride.findMany({ where: { riderId: user.id }, include: rideInclude, orderBy: { createdAt: 'desc' }, take: 50 })
    return { ok: true, rides: rides.map((r) => rideView(r)) }
  })

  router.add('GET /api/rides/:id', async ({ ctx, params }) => {
    const user = requireUser(ctx)
    const r = await db().ride.findUnique({ where: { id: params.id }, include: rideInclude })
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
      const updated = await db().ride.updateMany({ where: { id: r.id, status: { in: ['REQUESTED', 'ACCEPTED', 'ARRIVED'] } }, data: { status: 'CANCELLED', cancelledBy: 'RIDER' } })
      if (updated.count !== 1) throw conflict('NOT_CANCELLABLE', 'This ride can no longer be cancelled.')
      await db().rideEvent.create({ data: { rideId: r.id, type: 'CANCELLED_BY_RIDER', actorId: user.id, data: { previous: r.status } } })
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

  // ---- Driver ----
  router.add('POST /api/driver/status', async ({ ctx, body }) => {
    const { user } = await eligibleDriver(ctx, profile)
    const online = Boolean(body.online)
    const data = { online, lastSeenAt: new Date() }
    if (body.lat != null || body.lng != null) {
      const p = point({ lat: body.lat, lng: body.lng }, 'position', bounds)
      Object.assign(data, { lat: p.lat, lng: p.lng })
    }
    const driver = await db().driverProfile.update({ where: { userId: user.id }, data })
    return { ok: true, driver: { online: driver.online, lat: driver.lat, lng: driver.lng, category: driver.category } }
  })

  router.add('GET /api/driver/offers', async ({ ctx }) => {
    const { driver } = await eligibleDriver(ctx, profile)
    if (!driver.online || driver.lat == null) return { ok: true, offers: [] }
    const horizon = new Date(Date.now() + OFFER_LEAD_MS)
    const rides = await db().ride.findMany({
      where: { status: 'REQUESTED', category: driver.category, OR: [{ scheduledFor: null }, { scheduledFor: { lte: horizon } }] },
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
        where: { id: params.id, status: 'REQUESTED', driverId: null, category: driver.category, riderId: { not: user.id } },
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
    router.add(`POST /api/driver/rides/:id/${action}`, async ({ ctx, params }) => {
      const { user, driver } = await eligibleDriver(ctx, profile)
      const data = { status: t.to }
      if (t.to === 'COMPLETED') data.completedAt = new Date()
      const updated = await db().ride.updateMany({ where: { id: params.id, driverId: user.id, status: t.from }, data })
      if (updated.count !== 1) throw conflict('INVALID_STATE', `This ride is not ${t.from.toLowerCase()}.`)
      await db().rideEvent.create({ data: { rideId: params.id, type: t.event, actorId: user.id, data: { at: { lat: driver.lat, lng: driver.lng } } } })
      if (t.to === 'COMPLETED') await audit(db(), user.id, 'ride.completed', params.id)
      const r = await db().ride.findUnique({ where: { id: params.id }, include: rideInclude })
      return { ok: true, ride: rideView(r, 'driver') }
    })
  }

  router.add('GET /api/driver/rides', async ({ ctx }) => {
    const { user, driver } = await eligibleDriver(ctx, profile)
    const rides = await db().ride.findMany({ where: { driverId: user.id }, include: rideInclude, orderBy: { createdAt: 'desc' }, take: 100 })
    const earningsCents = rides.filter((r) => r.status === 'COMPLETED').reduce((s, r) => s + r.breakdown.driver.payoutCents, 0)
    const status = { online: driver.online, lat: driver.lat, lng: driver.lng, category: driver.category, vehicle: driver.vehicle }
    return { ok: true, rides: rides.map((r) => rideView(r, 'driver')), earningsCents, driver: status }
  })
}
