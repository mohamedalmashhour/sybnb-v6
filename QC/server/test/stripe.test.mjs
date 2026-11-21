// Stripe payment flows against a fake Stripe client (no network). Run: npm run qc:test
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

process.env.QC_DATABASE_URL = process.env.QC_TEST_DATABASE_URL || 'postgresql://localhost/qc_test'
process.env.QC_AUTH_SECRET = 'test-secret-test-secret-test-secret-1234'
process.env.QC_MAIL_MODE = 'memory'
process.env.QC_PAYMENTS_MODE = 'stripe'
process.env.QC_ADMIN_EMAILS = 'admin@qc.test'

const { createHandler } = await import('../app.mjs')
const { db, disconnectDb } = await import('../lib/db.mjs')
const { outbox } = await import('../lib/mailer.mjs')
const { setStripeForTests, stripeConfigProblems } = await import('../lib/payments.mjs')

// ---- Fake Stripe ----
const calls = []
const sessions = new Map()
const intents = new Map()
let seq = 0
const fake = {
  checkout: {
    sessions: {
      async create(params, opts) {
        const id = `cs_test_${++seq}`
        sessions.set(id, { ...params, id, status: 'open' })
        calls.push(['session.create', params, opts])
        return { id, url: `https://checkout.stripe.test/${id}` }
      },
      async expire(id) {
        calls.push(['session.expire', id])
        sessions.get(id).status = 'expired'
      },
    },
  },
  paymentIntents: {
    async retrieve(id) { return { id, status: intents.get(id) } },
    async capture(id, params, opts) { calls.push(['capture', id, params, opts]); intents.set(id, 'succeeded') },
    async cancel(id) { calls.push(['cancel', id]); intents.set(id, 'canceled') },
  },
  refunds: { async create(params, opts) { calls.push(['refund', params, opts]) } },
  webhooks: {
    constructEvent(raw, signature) {
      if (signature !== 'valid-test-signature') throw new Error('bad signature')
      return JSON.parse(raw.toString('utf8'))
    },
  },
}

let server, base, eventSeq = 0

before(async () => {
  await db().$executeRawUnsafe('TRUNCATE qc_stripe_events, qc_payments, qc_ride_events, qc_rides, qc_ride_quotes, qc_stay_bookings, qc_calendar_blocks, qc_listings, qc_driver_profiles, qc_role_applications, qc_sessions, qc_login_codes, qc_users, qc_audit_log CASCADE')
  setStripeForTests(fake)
  server = createServer(createHandler())
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  server.closeAllConnections()
  server.close()
  await disconnectDb()
})

async function api(method, path, { token, body } = {}) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, body: await res.json() }
}

async function signIn(email) {
  await api('POST', '/api/auth/code', { body: { email } })
  const code = /(\d{6})/.exec(outbox.filter((m) => m.to === email).at(-1).text)[1]
  return (await api('POST', '/api/auth/verify', { body: { email, code } })).body.token
}

async function webhook(type, object, { signature = 'valid-test-signature', id } = {}) {
  const event = { id: id ?? `evt_test_${++eventSeq}`, type, data: { object } }
  const res = await fetch(`${base}/api/webhooks/stripe`, { method: 'POST', headers: { 'stripe-signature': signature, 'content-type': 'application/json' }, body: JSON.stringify(event) })
  return { status: res.status, body: await res.json(), event }
}

const paidSession = (sessionId, piId, amount) => {
  const s = sessions.get(sessionId)
  return { id: sessionId, metadata: s.metadata, payment_status: 'paid', amount_total: amount, payment_intent: piId }
}

const iso = (d) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10)

let admin, host, guest, listingId

test('stripe config refuses live keys and requires a webhook secret', () => {
  assert.equal(stripeConfigProblems({ QC_PAYMENTS_MODE: 'stripe', QC_STRIPE_SECRET_KEY: 'sk_live_x', QC_STRIPE_WEBHOOK_SECRET: 'whsec_x' }).length, 1)
  assert.equal(stripeConfigProblems({ QC_PAYMENTS_MODE: 'stripe', QC_STRIPE_SECRET_KEY: 'rk_test_x' }).length, 1)
  assert.equal(stripeConfigProblems({ QC_PAYMENTS_MODE: 'stripe', QC_STRIPE_SECRET_KEY: 'rk_test_x', QC_STRIPE_WEBHOOK_SECRET: 'whsec_x' }).length, 0)
})

test('setup: published listing', async () => {
  admin = await signIn('admin@qc.test')
  host = await signIn('host@qc.test')
  guest = await signIn('guest@qc.test')
  const app = await api('POST', '/api/applications', { token: host, body: { role: 'HOST', details: { legalName: 'Hôte', phone: '+15145550000', address: 'Montréal' } } })
  await api('POST', `/api/admin/applications/${app.body.application.id}/decision`, { token: admin, body: { decision: 'APPROVE' } })
  const l = await api('POST', '/api/host/listings', { token: host, body: {
    title: 'Loft Plateau test', description: 'Un loft de test pour les paiements Stripe en mode test.', address: '1 rue Test', city: 'Montréal',
    lat: 45.52, lng: -73.58, registrationNumber: '123456', maxGuests: 2, bedrooms: 1, beds: 1, bathrooms: 1, nightlyCents: 10000, cleaningCents: 5000, photos: ['https://example.com/p.jpg'],
  } })
  listingId = l.body.listing.id
  await api('POST', `/api/host/listings/${listingId}/submit`, { token: host })
  assert.equal((await api('POST', `/api/admin/listings/${listingId}/decision`, { token: admin, body: { decision: 'PUBLISH' } })).status, 200)
})

test('stay: checkout session itemizes the quote; only a signed paid webhook confirms, once', async () => {
  const hold = await api('POST', `/api/stays/${listingId}/book`, { token: guest, body: { checkIn: iso(20), checkOut: iso(22), guests: 2 } })
  const booking = hold.body.booking
  const co = await api('POST', `/api/bookings/${booking.id}/checkout`, { token: guest })
  assert.match(co.body.checkoutUrl, /^https:\/\/checkout\.stripe\.test\//)
  const [, params] = calls.findLast((c) => c[0] === 'session.create')
  assert.equal(params.payment_method_types, undefined)
  assert.equal(params.line_items.reduce((s, l) => s + l.price_data.unit_amount, 0), booking.totalCents)
  assert.ok(params.line_items.every((l) => l.price_data.currency === 'cad'))
  assert.equal(params.payment_intent_data.capture_method, undefined)
  assert.ok(params.expires_at * 1000 >= Date.now() + 30 * 60_000)
  const sessionId = co.body.checkoutUrl.split('/').pop()

  assert.equal((await webhook('checkout.session.completed', paidSession(sessionId, 'pi_stay_1', booking.totalCents), { signature: 'forged' })).status, 400)
  assert.equal((await api('GET', `/api/bookings/${booking.id}`, { token: guest })).body.booking.status, 'HOLD')

  const first = await webhook('checkout.session.completed', paidSession(sessionId, 'pi_stay_1', booking.totalCents))
  assert.equal(first.status, 200)
  assert.equal((await api('GET', `/api/bookings/${booking.id}`, { token: guest })).body.booking.status, 'CONFIRMED')
  const dup = await webhook('checkout.session.completed', paidSession(sessionId, 'pi_stay_1', booking.totalCents), { id: first.event.id })
  assert.equal(dup.body.duplicate, true)
  const payment = await db().payment.findUnique({ where: { stayBookingId: booking.id } })
  assert.equal(payment.status, 'PAID')
  assert.equal(payment.capturedCents, booking.totalCents)

  // Early guest cancellation refunds everything through Stripe, idempotently keyed.
  const cancel = await api('POST', `/api/bookings/${booking.id}/cancel`, { token: guest })
  assert.equal(cancel.status, 200)
  const [, refund, opts] = calls.findLast((c) => c[0] === 'refund')
  assert.deepEqual([refund.payment_intent, refund.amount, opts.idempotencyKey], ['pi_stay_1', booking.totalCents, `stay-refund-${booking.id}`])
  assert.equal((await db().payment.findUnique({ where: { stayBookingId: booking.id } })).refundedCents, booking.totalCents)
})

test('stay: an unpaid completed session (delayed method) does not confirm', async () => {
  const hold = await api('POST', `/api/stays/${listingId}/book`, { token: guest, body: { checkIn: iso(30), checkOut: iso(32), guests: 1 } })
  const co = await api('POST', `/api/bookings/${hold.body.booking.id}/checkout`, { token: guest })
  const sessionId = co.body.checkoutUrl.split('/').pop()
  await webhook('checkout.session.completed', { ...paidSession(sessionId, 'pi_stay_2', hold.body.booking.totalCents), payment_status: 'unpaid' })
  assert.equal((await api('GET', `/api/bookings/${hold.body.booking.id}`, { token: guest })).body.booking.status, 'HOLD')
  await webhook('checkout.session.async_payment_succeeded', paidSession(sessionId, 'pi_stay_2', hold.body.booking.totalCents))
  assert.equal((await api('GET', `/api/bookings/${hold.body.booking.id}`, { token: guest })).body.booking.status, 'CONFIRMED')
})

test('stay: payment arriving after the hold lapsed and the nights were rebooked is refunded in full', async () => {
  const guest2 = await signIn('guest2@qc.test')
  const hold = await api('POST', `/api/stays/${listingId}/book`, { token: guest, body: { checkIn: iso(40), checkOut: iso(42), guests: 1 } })
  const co = await api('POST', `/api/bookings/${hold.body.booking.id}/checkout`, { token: guest })
  await db().stayBooking.update({ where: { id: hold.body.booking.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } })
  assert.equal((await api('POST', `/api/stays/${listingId}/book`, { token: guest2, body: { checkIn: iso(41), checkOut: iso(43), guests: 1 } })).status, 201)
  const sessionId = co.body.checkoutUrl.split('/').pop()
  await webhook('checkout.session.completed', paidSession(sessionId, 'pi_stay_late', hold.body.booking.totalCents))
  const late = (await api('GET', `/api/bookings/${hold.body.booking.id}`, { token: guest })).body.booking
  assert.equal(late.status, 'CANCELLED')
  assert.equal(late.refundCents, hold.body.booking.totalCents)
  assert.ok(calls.some((c) => c[0] === 'refund' && c[1].payment_intent === 'pi_stay_late' && c[1].amount === hold.body.booking.totalCents))
})

let driver
const pickup = { lat: 45.5017, lng: -73.5673, label: 'Centre-ville' }
const dropoff = { lat: 45.4706, lng: -73.7408, label: 'YUL' }

async function requestRide(token) {
  const q = await api('POST', '/api/rides/quote', { token, body: { pickup, dropoff } })
  return api('POST', '/api/rides', { token, body: { quoteId: q.body.quote.id } })
}

test('ride: unpaid ride is hidden from drivers; authorization releases it; completion captures', async () => {
  driver = await signIn('driver@qc.test')
  const far = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10)
  const app = await api('POST', '/api/applications', { token: driver, body: { role: 'DRIVER', details: { legalName: 'Chauffeur', phone: '+15145550001', licenceNumber: 'L1', licenceExpiry: far, insuranceExpiry: far, category: 'STANDARD', vehicle: { make: 'Toyota', model: 'Prius', year: new Date().getFullYear() - 2, colour: 'Gris', plate: 'TST001' } } } })
  await api('POST', `/api/admin/applications/${app.body.application.id}/decision`, { token: admin, body: { decision: 'APPROVE' } })
  await api('POST', '/api/driver/status', { token: driver, body: { online: true, lat: 45.5, lng: -73.57 } })

  const r = await requestRide(guest)
  assert.equal(r.status, 201)
  assert.equal(r.body.ride.status, 'PAYMENT_PENDING')
  const [, params] = calls.findLast((c) => c[0] === 'session.create')
  assert.equal(params.payment_intent_data.capture_method, 'manual')
  assert.equal(params.line_items[0].price_data.unit_amount, r.body.ride.totalCents)
  assert.equal((await api('GET', '/api/driver/offers', { token: driver })).body.offers.length, 0)

  const sessionId = r.body.checkoutUrl.split('/').pop()
  intents.set('pi_ride_1', 'requires_capture')
  await webhook('checkout.session.completed', { id: sessionId, metadata: sessions.get(sessionId).metadata, payment_status: 'unpaid', amount_total: r.body.ride.totalCents, payment_intent: 'pi_ride_1' })
  const offers = (await api('GET', '/api/driver/offers', { token: driver })).body.offers
  assert.equal(offers[0].id, r.body.ride.id)

  await api('POST', `/api/driver/rides/${r.body.ride.id}/accept`, { token: driver })
  const pin = (await api('GET', `/api/rides/${r.body.ride.id}`, { token: guest })).body.ride.pickupPin
  for (const step of ['arrive', 'start', 'complete']) await api('POST', `/api/driver/rides/${r.body.ride.id}/${step}`, { token: driver, body: step === 'start' ? { pin } : undefined })
  const [, pi, cap, opts] = calls.findLast((c) => c[0] === 'capture')
  assert.deepEqual([pi, cap.amount_to_capture, opts.idempotencyKey], ['pi_ride_1', r.body.ride.totalCents, `ride-capture-${r.body.ride.id}`])
  const payment = await db().payment.findUnique({ where: { rideId: r.body.ride.id } })
  assert.equal(payment.status, 'PAID')
  const events = (await api('GET', `/api/rides/${r.body.ride.id}`, { token: guest })).body.ride.events.map((e) => e.type)
  assert.deepEqual(events, ['REQUESTED', 'PAYMENT_AUTHORIZED', 'ACCEPTED', 'DRIVER_ARRIVED', 'TRIP_STARTED', 'TRIP_COMPLETED'])
})

test('ride: rider cancellation releases the authorization; expired checkout cancels the ride', async () => {
  const r = await requestRide(guest)
  const sessionId = r.body.checkoutUrl.split('/').pop()
  intents.set('pi_ride_2', 'requires_capture')
  await webhook('checkout.session.completed', { id: sessionId, metadata: sessions.get(sessionId).metadata, payment_status: 'unpaid', amount_total: r.body.ride.totalCents, payment_intent: 'pi_ride_2' })
  assert.equal((await api('POST', `/api/rides/${r.body.ride.id}/cancel`, { token: guest })).status, 200)
  assert.ok(calls.some((c) => c[0] === 'cancel' && c[1] === 'pi_ride_2'))
  assert.equal((await db().payment.findUnique({ where: { rideId: r.body.ride.id } })).status, 'CANCELED')

  const r2 = await requestRide(guest)
  const s2 = r2.body.checkoutUrl.split('/').pop()
  await webhook('checkout.session.expired', { id: s2, metadata: sessions.get(s2).metadata, payment_status: 'unpaid' })
  assert.equal((await api('GET', `/api/rides/${r2.body.ride.id}`, { token: guest })).body.ride.status, 'CANCELLED')
})

test('ride: requesting again abandons an unpaid earlier ride and closes its checkout', async () => {
  const r1 = await requestRide(guest)
  const s1 = r1.body.checkoutUrl.split('/').pop()
  const r2 = await requestRide(guest)
  assert.equal(r2.status, 201)
  assert.equal((await api('GET', `/api/rides/${r1.body.ride.id}`, { token: guest })).body.ride.status, 'CANCELLED')
  assert.equal(sessions.get(s1).status, 'expired')
})
