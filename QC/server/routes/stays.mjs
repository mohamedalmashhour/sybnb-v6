// STR: public search, quotes, guest bookings and host listing management.
import { db, audit, isExclusionViolation } from '../lib/db.mjs'
import { HttpError, badRequest, conflict, forbidden, int, notFound, num, str } from '../lib/http.mjs'
import { requireRole, requireUser } from '../lib/auth.mjs'
import { localMidnight, nightsBetween, parseDate, toDateString, todayIn } from '../lib/dates.mjs'
import { pct, stayQuote } from '../lib/money.mjs'
import { createStayCheckout, paymentsMode, refundStay } from '../lib/payments.mjs'

const LIVE = ['HOLD', 'CONFIRMED']
const liveWhere = (now = new Date()) => ({ OR: [{ status: 'CONFIRMED' }, { status: 'HOLD', holdExpiresAt: { gt: now } }] })

export async function expireStaleHolds(tx = db(), where = {}) {
  return tx.stayBooking.updateMany({ where: { ...where, status: 'HOLD', holdExpiresAt: { lte: new Date() } }, data: { status: 'EXPIRED' } })
}

function stayDates(body, profile) {
  const checkIn = parseDate(body.checkIn, 'checkIn')
  const checkOut = parseDate(body.checkOut, 'checkOut')
  const nights = nightsBetween(checkIn, checkOut)
  if (nights < 1) throw badRequest('INVALID_DATES', 'Check-out must be after check-in.')
  if (nights > profile.stays.maxNights) throw badRequest('INVALID_DATES', `Stays are limited to ${profile.stays.maxNights} nights.`)
  if (checkIn < todayIn(profile.timezone)) throw badRequest('INVALID_DATES', 'Check-in cannot be in the past.')
  return { checkIn, checkOut, nights }
}

async function assertAvailable(tx, listingId, checkIn, checkOut) {
  const [booking, block] = await Promise.all([
    tx.stayBooking.findFirst({ where: { listingId, ...liveWhere(), checkIn: { lt: checkOut }, checkOut: { gt: checkIn } }, select: { id: true } }),
    tx.calendarBlock.findFirst({ where: { listingId, startDate: { lt: checkOut }, endDate: { gt: checkIn } }, select: { id: true } }),
  ])
  if (booking || block) throw conflict('DATES_UNAVAILABLE', 'Those dates are no longer available.')
}

const publicListing = (l) => ({
  id: l.id, title: l.title, description: l.description, city: l.city, lat: l.lat, lng: l.lng,
  registrationNumber: l.registrationNumber, maxGuests: l.maxGuests, bedrooms: l.bedrooms, beds: l.beds,
  bathrooms: l.bathrooms, nightlyCents: l.nightlyCents, cleaningCents: l.cleaningCents, minNights: l.minNights,
  amenities: l.amenities, photos: l.photos, currency: 'CAD',
})

const bookingView = (b) => ({
  id: b.id, listingId: b.listingId, guestId: b.guestId, checkIn: toDateString(b.checkIn), checkOut: toDateString(b.checkOut),
  guests: b.guests, status: b.status, holdExpiresAt: b.holdExpiresAt, quote: b.quote, totalCents: b.totalCents,
  refundCents: b.refundCents, cancelledBy: b.cancelledBy, cancelledAt: b.cancelledAt, confirmedAt: b.confirmedAt, createdAt: b.createdAt,
  listing: b.listing ? { id: b.listing.id, title: b.listing.title, city: b.listing.city, address: b.status === 'CONFIRMED' ? b.listing.address : undefined } : undefined,
})

// Refund owed to the guest when THEY cancel a confirmed stay.
export function guestRefundCents(booking, profile, now = new Date()) {
  const cutoff = new Date(localMidnight(booking.checkIn, profile.timezone).getTime() - profile.stays.fullRefundCutoffHours * 3_600_000)
  if (now <= cutoff) return booking.totalCents
  if (now >= localMidnight(booking.checkIn, profile.timezone)) return 0
  return pct(booking.totalCents, profile.stays.lateCancelRefundBp)
}

export function stayRoutes(router, { profile }) {
  // ---- Public search ----
  router.add('GET /api/stays', async ({ query }) => {
    const where = { status: 'PUBLISHED' }
    if (query.city) where.city = { equals: str(query.city, 'city', { max: 80 }), mode: 'insensitive' }
    if (query.guests) where.maxGuests = { gte: int(query.guests, 'guests', { min: 1, max: 30 }) }
    if (query.checkIn || query.checkOut) {
      const { checkIn, checkOut } = stayDates(query, profile)
      where.bookings = { none: { ...liveWhere(), checkIn: { lt: checkOut }, checkOut: { gt: checkIn } } }
      where.blocks = { none: { startDate: { lt: checkOut }, endDate: { gt: checkIn } } }
    }
    const listings = await db().listing.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50 })
    return { ok: true, listings: listings.map(publicListing) }
  })

  router.add('GET /api/stays/:id', async ({ params }) => {
    const listing = await db().listing.findFirst({ where: { id: params.id, status: 'PUBLISHED' } })
    if (!listing) throw notFound('This stay is not available.')
    const [bookings, blocks] = await Promise.all([
      db().stayBooking.findMany({ where: { listingId: listing.id, ...liveWhere(), checkOut: { gt: todayIn(profile.timezone) } }, select: { checkIn: true, checkOut: true } }),
      db().calendarBlock.findMany({ where: { listingId: listing.id }, select: { startDate: true, endDate: true } }),
    ])
    const unavailable = [
      ...bookings.map((b) => ({ start: toDateString(b.checkIn), end: toDateString(b.checkOut) })),
      ...blocks.map((b) => ({ start: toDateString(b.startDate), end: toDateString(b.endDate) })),
    ].sort((a, b) => a.start.localeCompare(b.start))
    return { ok: true, listing: publicListing(listing), unavailable }
  })

  router.add('POST /api/stays/:id/quote', async ({ params, body }) => {
    const listing = await db().listing.findFirst({ where: { id: params.id, status: 'PUBLISHED' } })
    if (!listing) throw notFound('This stay is not available.')
    const { nights } = stayDates(body, profile)
    validateStay(listing, nights, int(body.guests, 'guests', { min: 1, max: 30 }))
    return { ok: true, quote: stayQuote({ listing, nights, profile }) }
  })

  // ---- Guest bookings ----
  router.add('POST /api/stays/:id/book', async ({ ctx, params, body }) => {
    const user = requireUser(ctx)
    const { checkIn, checkOut, nights } = stayDates(body, profile)
    const guests = int(body.guests, 'guests', { min: 1, max: 30 })
    try {
      const booking = await db().$transaction(async (tx) => {
        // Serialize bookings per listing; the exclusion constraint is the final backstop.
        const [listing] = await tx.$queryRaw`SELECT id FROM qc_listings WHERE id = ${params.id}::uuid AND status = 'PUBLISHED' FOR UPDATE`
        if (!listing) throw notFound('This stay is not available.')
        const full = await tx.listing.findUnique({ where: { id: params.id } })
        if (full.hostId === user.id) throw forbidden('You cannot book your own listing.')
        validateStay(full, nights, guests)
        await expireStaleHolds(tx, { listingId: full.id })
        await assertAvailable(tx, full.id, checkIn, checkOut)
        const quote = stayQuote({ listing: full, nights, profile })
        const created = await tx.stayBooking.create({
          data: {
            listingId: full.id, guestId: user.id, checkIn, checkOut, guests, quote, totalCents: quote.totalCents,
            holdExpiresAt: new Date(Date.now() + profile.stays.holdMinutes * 60_000),
          },
        })
        await audit(tx, user.id, 'stay.hold', created.id, { listingId: full.id, totalCents: quote.totalCents })
        return created
      })
      return { status: 201, body: { ok: true, booking: bookingView(booking) } }
    } catch (err) {
      if (isExclusionViolation(err)) throw conflict('DATES_UNAVAILABLE', 'Those dates are no longer available.')
      throw err
    }
  })

  // Payment step. 'stripe' returns a Checkout URL (the webhook confirms); 'simulated' confirms at once (dev only).
  router.add('POST /api/bookings/:id/checkout', async ({ ctx, params }) => {
    const user = requireUser(ctx)
    const mode = paymentsMode()
    if (mode === 'disabled') throw new HttpError(503, 'PAYMENTS_DISABLED', 'Online payment is not available yet.')
    const b = await db().stayBooking.findUnique({ where: { id: params.id }, include: { listing: true } })
    if (!b || b.guestId !== user.id) throw notFound()
    if (b.status !== 'HOLD' || b.holdExpiresAt <= new Date()) throw conflict('HOLD_EXPIRED', 'This reservation hold has expired. Please book again.')
    if (mode === 'stripe') return { ok: true, checkoutUrl: await createStayCheckout({ booking: b, listing: b.listing, user }) }
    const updated = await db().stayBooking.updateMany({
      where: { id: b.id, status: 'HOLD', holdExpiresAt: { gt: new Date() } },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), holdExpiresAt: null },
    })
    if (updated.count !== 1) throw conflict('HOLD_EXPIRED', 'This reservation hold has expired. Please book again.')
    await audit(db(), user.id, 'stay.confirmed', b.id, { payment: 'simulated' })
    const booking = await db().stayBooking.findUnique({ where: { id: b.id }, include: { listing: true } })
    return { ok: true, booking: bookingView(booking) }
  })

  router.add('GET /api/bookings', async ({ ctx }) => {
    const user = requireUser(ctx)
    await expireStaleHolds(db(), { guestId: user.id })
    const bookings = await db().stayBooking.findMany({ where: { guestId: user.id }, include: { listing: true }, orderBy: { checkIn: 'desc' } })
    return { ok: true, bookings: bookings.map(bookingView) }
  })

  router.add('GET /api/bookings/:id', async ({ ctx, params }) => {
    const user = requireUser(ctx)
    const b = await db().stayBooking.findUnique({ where: { id: params.id }, include: { listing: true } })
    if (!b || (b.guestId !== user.id && b.listing.hostId !== user.id && !user.roles.includes('ADMIN'))) throw notFound()
    return { ok: true, booking: bookingView(b) }
  })

  router.add('POST /api/bookings/:id/cancel', async ({ ctx, params }) => {
    const user = requireUser(ctx)
    const b = await db().stayBooking.findUnique({ where: { id: params.id }, include: { listing: true } })
    if (!b || b.guestId !== user.id) throw notFound()
    if (!LIVE.includes(b.status)) throw conflict('NOT_CANCELLABLE', 'This booking can no longer be cancelled.')
    const refundCents = b.status === 'HOLD' ? 0 : guestRefundCents(b, profile)
    const updated = await db().stayBooking.updateMany({
      where: { id: b.id, status: b.status },
      data: { status: 'CANCELLED', cancelledBy: 'GUEST', cancelledAt: new Date(), refundCents, holdExpiresAt: null },
    })
    if (updated.count !== 1) throw conflict('NOT_CANCELLABLE', 'This booking changed. Refresh and try again.')
    await audit(db(), user.id, 'stay.cancelled', b.id, { by: 'GUEST', refundCents })
    await refundStay(b.id, refundCents, user.id, 'guest_cancelled')
    return { ok: true, booking: bookingView({ ...b, status: 'CANCELLED', cancelledBy: 'GUEST', refundCents }) }
  })

  // ---- Host ----
  const ownListing = async (user, id) => {
    const listing = await db().listing.findUnique({ where: { id } })
    if (!listing || listing.hostId !== user.id) throw notFound()
    return listing
  }

  router.add('GET /api/host/listings', async ({ ctx }) => {
    const user = requireRole(ctx, 'HOST')
    const listings = await db().listing.findMany({ where: { hostId: user.id }, orderBy: { createdAt: 'desc' } })
    return { ok: true, listings }
  })

  router.add('POST /api/host/listings', async ({ ctx, body }) => {
    const user = requireRole(ctx, 'HOST')
    const listing = await db().listing.create({ data: { hostId: user.id, ...listingFields(body, profile, false) } })
    await audit(db(), user.id, 'listing.created', listing.id)
    return { status: 201, body: { ok: true, listing } }
  })

  router.add('PATCH /api/host/listings/:id', async ({ ctx, params, body }) => {
    const user = requireRole(ctx, 'HOST')
    const listing = await ownListing(user, params.id)
    const data = listingFields(body, profile, true)
    // Changing what guests rely on (identity, location, registration) sends the listing back to review.
    const reviewed = ['title', 'description', 'address', 'city', 'lat', 'lng', 'registrationNumber', 'maxGuests']
    if (listing.status === 'PUBLISHED' && reviewed.some((k) => k in data && data[k] !== listing[k])) data.status = 'PENDING_REVIEW'
    const updated = await db().listing.update({ where: { id: listing.id }, data })
    await audit(db(), user.id, 'listing.updated', listing.id, { fields: Object.keys(data) })
    return { ok: true, listing: updated }
  })

  router.add('POST /api/host/listings/:id/submit', async ({ ctx, params }) => {
    const user = requireRole(ctx, 'HOST')
    const listing = await ownListing(user, params.id)
    if (!['DRAFT', 'REJECTED'].includes(listing.status)) throw conflict('INVALID_STATE', 'Only drafts or rejected listings can be submitted.')
    if (profile.stays.requireRegistrationNumber && !listing.registrationNumber) {
      throw badRequest('REGISTRATION_REQUIRED', 'A Québec short-term rental registration number is required before review.', { field: 'registrationNumber' })
    }
    if (listing.photos.length < 1) throw badRequest('PHOTOS_REQUIRED', 'Add at least one photo before review.', { field: 'photos' })
    const updated = await db().listing.update({ where: { id: listing.id }, data: { status: 'PENDING_REVIEW', reviewNote: null } })
    await audit(db(), user.id, 'listing.submitted', listing.id)
    return { ok: true, listing: updated }
  })

  router.add('GET /api/host/listings/:id/calendar', async ({ ctx, params }) => {
    const user = requireRole(ctx, 'HOST')
    const listing = await ownListing(user, params.id)
    await expireStaleHolds(db(), { listingId: listing.id })
    const [bookings, blocks] = await Promise.all([
      db().stayBooking.findMany({ where: { listingId: listing.id, status: { in: ['HOLD', 'CONFIRMED', 'COMPLETED'] } }, orderBy: { checkIn: 'asc' } }),
      db().calendarBlock.findMany({ where: { listingId: listing.id }, orderBy: { startDate: 'asc' } }),
    ])
    return {
      ok: true,
      bookings: bookings.map(bookingView),
      blocks: blocks.map((b) => ({ id: b.id, startDate: toDateString(b.startDate), endDate: toDateString(b.endDate) })),
    }
  })

  router.add('POST /api/host/listings/:id/blocks', async ({ ctx, params, body }) => {
    const user = requireRole(ctx, 'HOST')
    const startDate = parseDate(body.startDate, 'startDate')
    const endDate = parseDate(body.endDate, 'endDate')
    if (endDate <= startDate) throw badRequest('INVALID_DATES', 'endDate must be after startDate.')
    const block = await db().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM qc_listings WHERE id = ${params.id}::uuid FOR UPDATE`
      await ownListing(user, params.id)
      await expireStaleHolds(tx, { listingId: params.id })
      await assertAvailable(tx, params.id, startDate, endDate)
      return tx.calendarBlock.create({ data: { listingId: params.id, startDate, endDate } })
    })
    return { status: 201, body: { ok: true, block: { id: block.id, startDate: toDateString(startDate), endDate: toDateString(endDate) } } }
  })

  router.add('DELETE /api/host/blocks/:id', async ({ ctx, params }) => {
    const user = requireRole(ctx, 'HOST')
    const block = await db().calendarBlock.findUnique({ where: { id: params.id }, include: { listing: true } })
    if (!block || block.listing.hostId !== user.id) throw notFound()
    await db().calendarBlock.delete({ where: { id: block.id } })
    return { ok: true }
  })

  router.add('GET /api/host/bookings', async ({ ctx }) => {
    const user = requireRole(ctx, 'HOST')
    const bookings = await db().stayBooking.findMany({
      where: { listing: { hostId: user.id }, status: { in: ['CONFIRMED', 'COMPLETED', 'CANCELLED'] } },
      include: { listing: true }, orderBy: { checkIn: 'desc' },
    })
    return { ok: true, bookings: bookings.map(bookingView) }
  })

  // A host cancellation always refunds the guest in full.
  router.add('POST /api/host/bookings/:id/cancel', async ({ ctx, params, body }) => {
    const user = requireRole(ctx, 'HOST')
    const reason = str(body.reason, 'reason', { max: 300 })
    const b = await db().stayBooking.findUnique({ where: { id: params.id }, include: { listing: true } })
    if (!b || b.listing.hostId !== user.id) throw notFound()
    const updated = await db().stayBooking.updateMany({
      where: { id: b.id, status: 'CONFIRMED' },
      data: { status: 'CANCELLED', cancelledBy: 'HOST', cancelledAt: new Date(), refundCents: b.totalCents },
    })
    if (updated.count !== 1) throw conflict('NOT_CANCELLABLE', 'Only confirmed bookings can be cancelled.')
    await audit(db(), user.id, 'stay.cancelled', b.id, { by: 'HOST', reason, refundCents: b.totalCents })
    await refundStay(b.id, b.totalCents, user.id, 'host_cancelled')
    return { ok: true }
  })
}

function validateStay(listing, nights, guests) {
  if (nights < listing.minNights) throw badRequest('MIN_NIGHTS', `This stay requires at least ${listing.minNights} nights.`)
  if (guests > listing.maxGuests) throw badRequest('TOO_MANY_GUESTS', `This stay hosts up to ${listing.maxGuests} guests.`)
}

function listingFields(body, profile, partial) {
  const out = {}
  const take = (key, fn) => {
    if (partial && !(key in body)) return
    out[key] = fn(body[key])
  }
  const bounds = profile.rides.serviceBounds
  take('title', (v) => str(v, 'title', { min: 5, max: 90 }))
  take('description', (v) => str(v, 'description', { min: 20, max: 4000 }))
  take('address', (v) => str(v, 'address', { max: 200 }))
  take('city', (v) => str(v, 'city', { max: 80 }))
  take('lat', (v) => num(v, 'lat', { min: bounds.minLat, max: bounds.maxLat }))
  take('lng', (v) => num(v, 'lng', { min: bounds.minLng, max: bounds.maxLng }))
  take('registrationNumber', (v) => str(v, 'registrationNumber', { max: 40, optional: true }))
  take('maxGuests', (v) => int(v, 'maxGuests', { min: 1, max: 30 }))
  take('bedrooms', (v) => int(v, 'bedrooms', { min: 0, max: 30 }))
  take('beds', (v) => int(v, 'beds', { min: 1, max: 50 }))
  take('bathrooms', (v) => num(v, 'bathrooms', { min: 0, max: 30 }))
  take('nightlyCents', (v) => int(v, 'nightlyCents', { min: 1000, max: 10_000_00 }))
  if (!partial || 'cleaningCents' in body) out.cleaningCents = int(body.cleaningCents ?? 0, 'cleaningCents', { min: 0, max: 1_000_00 })
  if (!partial || 'minNights' in body) out.minNights = int(body.minNights ?? 1, 'minNights', { min: 1, max: profile.stays.maxNights })
  if (!partial || 'amenities' in body) out.amenities = stringList(body.amenities, 'amenities', 40)
  if (!partial || 'photos' in body) {
    out.photos = stringList(body.photos, 'photos', 20)
    if (out.photos.some((p) => !/^https:\/\//.test(p))) throw badRequest('FIELD_INVALID', 'photos must be https URLs.', { field: 'photos' })
  }
  return out
}

function stringList(v, field, max) {
  if (v == null) return []
  if (!Array.isArray(v) || v.length > max || v.some((x) => typeof x !== 'string' || !x.trim() || x.length > 500)) {
    throw badRequest('FIELD_INVALID', `${field} must be a list of up to ${max} items.`, { field })
  }
  return v.map((x) => x.trim())
}
