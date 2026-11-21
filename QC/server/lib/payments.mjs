// QC payments through Stripe (test mode / sandboxes only until the owner authorizes live payments).
//
// QC_PAYMENTS_MODE: unset = disabled, 'simulated' = confirm without charging (dev only),
// 'stripe' = Stripe Checkout. Money state changes only from signature-verified webhooks; the
// browser's return page never confirms anything.
//   Stays: Checkout Session, charged at once. checkout.session.completed (paid) confirms the hold.
//   Rides: Checkout Session with manual capture. Authorization releases the ride to drivers;
//          completion captures; cancellation releases the authorization.
import Stripe from 'stripe'
import { randomBytes } from 'node:crypto'
import { db, audit, isExclusionViolation, isUniqueViolation } from './db.mjs'
import { HttpError } from './http.mjs'

let client

export const paymentsMode = () => {
  const mode = process.env.QC_PAYMENTS_MODE || 'disabled'
  return ['simulated', 'stripe'].includes(mode) ? mode : 'disabled'
}

export function stripeConfigProblems(env = process.env) {
  if (env.QC_PAYMENTS_MODE !== 'stripe') return []
  const problems = []
  const key = env.QC_STRIPE_SECRET_KEY ?? ''
  if (!/^(sk|rk)_test_/.test(key)) problems.push('QC_STRIPE_SECRET_KEY must be a TEST key (sk_test_ or rk_test_); live payments are not authorized')
  if (!/^whsec_/.test(env.QC_STRIPE_WEBHOOK_SECRET ?? '')) problems.push('QC_STRIPE_WEBHOOK_SECRET (whsec_...) is required in stripe mode')
  return problems
}

export function stripe() {
  if (!client) {
    const problems = stripeConfigProblems({ ...process.env, QC_PAYMENTS_MODE: 'stripe' })
    if (problems.length) throw new HttpError(503, 'PAYMENTS_NOT_CONFIGURED', 'Online payment is not configured.')
    client = new Stripe(process.env.QC_STRIPE_SECRET_KEY, { maxNetworkRetries: 2 })
  }
  return client
}

export const setStripeForTests = (fake) => { client = fake }

const appUrl = (app) => (app === 'qtr' ? process.env.QC_QTR_URL || 'http://127.0.0.1:5191' : process.env.QC_QRIDE_URL || 'http://127.0.0.1:5190').replace(/\/$/, '')
const tag = (prefix) => `${prefix}-${Array.from(randomBytes(8), (b) => String.fromCharCode(97 + (b % 26))).join('')}`

// Checkout requires expires_at at least 30 minutes ahead.
const sessionExpiry = (at) => Math.floor(Math.max(at?.getTime() ?? 0, Date.now() + 31 * 60_000) / 1000)

function stayLineItems(quote, title, locale) {
  const fr = locale.startsWith('fr')
  const names = { ACCOMMODATION: fr ? 'Hébergement' : 'Accommodation', CLEANING: fr ? 'Ménage' : 'Cleaning', SERVICE_FEE: fr ? 'Frais de service' : 'Service fee' }
  const items = [
    ...quote.lines.filter((l) => l.cents > 0).map((l) => ({ name: l.code === 'ACCOMMODATION' ? `${title} — ${l.nights} ${fr ? 'nuits' : 'nights'}` : names[l.code], cents: l.cents })),
    ...quote.taxes.filter((t) => t.cents > 0).map((t) => ({ name: t.label[fr ? 'fr' : 'en'], cents: t.cents })),
  ]
  return items.map((i) => ({ quantity: 1, price_data: { currency: 'cad', unit_amount: i.cents, product_data: { name: i.name } } }))
}

async function expireSessionQuietly(sessionId) {
  if (!sessionId) return
  try { await stripe().checkout.sessions.expire(sessionId) } catch { /* already completed or expired */ }
}

export async function createStayCheckout({ booking, listing, user }) {
  const existing = await db().payment.findUnique({ where: { stayBookingId: booking.id } })
  if (existing && existing.status !== 'PENDING') throw new HttpError(409, 'ALREADY_PAID', 'This booking already has a payment.')
  await expireSessionQuietly(existing?.stripeSessionId)
  const metadata = { kind: 'STAY', bookingId: booking.id, userId: user.id }
  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: user.email,
    client_reference_id: booking.id,
    locale: user.locale.startsWith('fr') ? 'fr-CA' : 'en',
    line_items: stayLineItems(booking.quote, listing.title, user.locale),
    metadata,
    payment_intent_data: { metadata, description: `Q STAY ${booking.id}` },
    expires_at: sessionExpiry(booking.holdExpiresAt),
    success_url: `${appUrl('qtr')}/?paid=${booking.id}`,
    cancel_url: `${appUrl('qtr')}/?unpaid=${booking.id}`,
    integration_identifier: tag('qtr-stays'),
  }, { idempotencyKey: `stay-checkout-${booking.id}-${existing?.stripeSessionId ?? 'first'}` })
  await db().payment.upsert({
    where: { stayBookingId: booking.id },
    create: { kind: 'STAY', userId: user.id, stayBookingId: booking.id, amountCents: booking.totalCents, stripeSessionId: session.id },
    update: { stripeSessionId: session.id, amountCents: booking.totalCents },
  })
  return session.url
}

export async function createRideCheckout({ ride, user }) {
  const metadata = { kind: 'RIDE', rideId: ride.id, userId: user.id }
  const fr = user.locale.startsWith('fr')
  const label = (p) => p.label || `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`
  const session = await stripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: user.email,
    client_reference_id: ride.id,
    locale: fr ? 'fr-CA' : 'en',
    line_items: [{ quantity: 1, price_data: { currency: 'cad', unit_amount: ride.totalCents, product_data: { name: `Q RIDE ${ride.category} — ${label(ride.pickup)} → ${label(ride.dropoff)}`, description: fr ? 'TPS et TVQ incluses. Montant autorisé, prélevé à la fin de la course.' : 'GST and QST included. Authorized now, charged when the trip ends.' } } }],
    metadata,
    payment_intent_data: { capture_method: 'manual', metadata, description: `Q RIDE ${ride.id}` },
    expires_at: sessionExpiry(),
    success_url: `${appUrl('qride')}/?ride=${ride.id}`,
    cancel_url: `${appUrl('qride')}/?unpaid=${ride.id}`,
    integration_identifier: tag('qride-rides'),
  }, { idempotencyKey: `ride-checkout-${ride.id}` })
  await db().payment.create({ data: { kind: 'RIDE', userId: user.id, rideId: ride.id, amountCents: ride.totalCents, stripeSessionId: session.id } })
  return session.url
}

// Refund part or all of a paid stay. Callers have already moved the booking to CANCELLED.
export async function refundStay(bookingId, cents, actorId, reason) {
  if (paymentsMode() !== 'stripe' || cents <= 0) return { refundedCents: 0 }
  const payment = await db().payment.findUnique({ where: { stayBookingId: bookingId } })
  if (!payment || payment.status !== 'PAID') return { refundedCents: 0 }
  const amount = Math.min(cents, payment.capturedCents - payment.refundedCents)
  if (amount <= 0) return { refundedCents: 0 }
  try {
    await stripe().refunds.create({ payment_intent: payment.stripePaymentIntentId, amount, metadata: { bookingId, reason } }, { idempotencyKey: `stay-refund-${bookingId}` })
  } catch (err) {
    await audit(db(), actorId, 'refund.failed', bookingId, { amount, message: String(err?.message ?? err) })
    throw new HttpError(502, 'REFUND_FAILED', 'The booking is cancelled but the refund could not be sent. Support has been notified.')
  }
  await db().payment.update({ where: { id: payment.id }, data: { refundedCents: { increment: amount } } })
  await audit(db(), actorId, 'refund.sent', bookingId, { amount, reason })
  return { refundedCents: amount }
}

export async function captureRide(rideId, actorId) {
  if (paymentsMode() !== 'stripe') return
  const payment = await db().payment.findUnique({ where: { rideId } })
  if (!payment || payment.status !== 'AUTHORIZED') {
    await audit(db(), actorId, 'capture.skipped', rideId, { status: payment?.status ?? 'NONE' })
    return
  }
  try {
    await stripe().paymentIntents.capture(payment.stripePaymentIntentId, { amount_to_capture: payment.amountCents }, { idempotencyKey: `ride-capture-${rideId}` })
    await db().payment.update({ where: { id: payment.id }, data: { status: 'PAID', capturedCents: payment.amountCents } })
  } catch (err) {
    await audit(db(), actorId, 'capture.failed', rideId, { message: String(err?.message ?? err) })
  }
}

// Release a ride's authorization (or close its unpaid checkout) when the ride is cancelled.
export async function releaseRide(rideId, actorId) {
  if (paymentsMode() !== 'stripe') return
  const payment = await db().payment.findUnique({ where: { rideId } })
  if (!payment) return
  if (payment.status === 'PENDING') {
    await expireSessionQuietly(payment.stripeSessionId)
    await db().payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'CANCELED' } })
    return
  }
  if (payment.status !== 'AUTHORIZED') return
  try {
    await stripe().paymentIntents.cancel(payment.stripePaymentIntentId, {}, { idempotencyKey: `ride-release-${rideId}` })
    await db().payment.update({ where: { id: payment.id }, data: { status: 'CANCELED' } })
  } catch (err) {
    await audit(db(), actorId, 'release.failed', rideId, { message: String(err?.message ?? err) })
  }
}

// ---- Webhooks ----
export function verifyStripeEvent(rawBody, signature) {
  try {
    return stripe().webhooks.constructEvent(rawBody, signature, process.env.QC_STRIPE_WEBHOOK_SECRET)
  } catch {
    throw new HttpError(400, 'BAD_SIGNATURE', 'Invalid Stripe signature.')
  }
}

export async function handleStripeEvent(event) {
  if (await db().stripeEvent.findUnique({ where: { id: event.id } })) return { duplicate: true }
  const session = event.data?.object
  const kind = session?.metadata?.kind
  if (event.type.startsWith('checkout.session.') && (kind === 'STAY' || kind === 'RIDE')) {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      if (kind === 'STAY' && session.payment_status === 'paid') await stayPaid(session)
      if (kind === 'RIDE') await rideAuthorized(session)
    } else if (event.type === 'checkout.session.async_payment_failed') {
      await db().payment.updateMany({ where: { stripeSessionId: session.id, status: 'PENDING' }, data: { status: 'FAILED' } })
    } else if (event.type === 'checkout.session.expired') {
      await db().payment.updateMany({ where: { stripeSessionId: session.id, status: 'PENDING' }, data: { status: 'EXPIRED' } })
      if (kind === 'RIDE') await db().ride.updateMany({ where: { id: session.metadata.rideId, status: 'PAYMENT_PENDING' }, data: { status: 'CANCELLED', cancelledBy: 'PAYMENT_EXPIRED' } })
    }
  }
  try {
    await db().stripeEvent.create({ data: { id: event.id, type: event.type } })
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
  }
  return { ok: true }
}

const intentId = (session) => (typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id)

async function stayPaid(session) {
  const bookingId = session.metadata.bookingId
  const piId = intentId(session)
  const marked = await db().payment.updateMany({
    where: { stayBookingId: bookingId, status: { in: ['PENDING', 'EXPIRED'] } },
    data: { status: 'PAID', capturedCents: session.amount_total, stripePaymentIntentId: piId, stripeSessionId: session.id },
  })
  if (marked.count !== 1) return
  const confirmed = await db().stayBooking.updateMany({ where: { id: bookingId, status: 'HOLD' }, data: { status: 'CONFIRMED', confirmedAt: new Date(), holdExpiresAt: null } })
  if (confirmed.count === 1) {
    await audit(db(), session.metadata.userId, 'stay.confirmed', bookingId, { payment: 'stripe', paymentIntent: piId })
    return
  }
  // Paid after the hold lapsed: keep the booking if the nights are still free, otherwise refund it all.
  const booking = await db().stayBooking.findUnique({ where: { id: bookingId } })
  const blocked = booking && await db().calendarBlock.findFirst({ where: { listingId: booking.listingId, startDate: { lt: booking.checkOut }, endDate: { gt: booking.checkIn } } })
  try {
    const revived = blocked ? { count: 0 } : await db().stayBooking.updateMany({ where: { id: bookingId, status: 'EXPIRED' }, data: { status: 'CONFIRMED', confirmedAt: new Date(), holdExpiresAt: null } })
    if (revived.count === 1) {
      await audit(db(), session.metadata.userId, 'stay.confirmed', bookingId, { payment: 'stripe', late: true })
      return
    }
  } catch (err) {
    if (!isExclusionViolation(err)) throw err
  }
  await db().stayBooking.updateMany({ where: { id: bookingId, status: { in: ['EXPIRED', 'HOLD'] } }, data: { status: 'CANCELLED', cancelledBy: 'SYSTEM', cancelledAt: new Date(), refundCents: session.amount_total } })
  await refundStay(bookingId, session.amount_total, null, 'paid_after_dates_taken')
}

async function rideAuthorized(session) {
  const rideId = session.metadata.rideId
  const piId = intentId(session)
  const pi = await stripe().paymentIntents.retrieve(piId)
  if (pi.status !== 'requires_capture') return
  const marked = await db().payment.updateMany({ where: { rideId, status: 'PENDING' }, data: { status: 'AUTHORIZED', stripePaymentIntentId: piId } })
  if (marked.count !== 1) return
  const released = await db().ride.updateMany({ where: { id: rideId, status: 'PAYMENT_PENDING' }, data: { status: 'REQUESTED' } })
  if (released.count === 1) {
    await db().rideEvent.create({ data: { rideId, type: 'PAYMENT_AUTHORIZED', data: { amountCents: session.amount_total } } })
  } else {
    // The rider cancelled while paying: release the hold on their card.
    await releaseRide(rideId, null)
  }
}
