// End-to-end API tests against a real Postgres (QC_TEST_DATABASE_URL). Run: npm run qc:test
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

process.env.QC_DATABASE_URL = process.env.QC_TEST_DATABASE_URL || 'postgresql://localhost/qc_test'
process.env.QC_AUTH_SECRET = 'test-secret-test-secret-test-secret-1234'
process.env.QC_MAIL_MODE = 'memory'
process.env.QC_PAYMENTS_MODE = 'simulated'
process.env.QC_ADMIN_EMAILS = 'admin@qc.test'

const { createHandler } = await import('../app.mjs')
const { db, disconnectDb } = await import('../lib/db.mjs')
const { outbox } = await import('../lib/mailer.mjs')

let server, base

before(async () => {
  await db().$executeRawUnsafe('TRUNCATE qc_ride_events, qc_rides, qc_ride_quotes, qc_stay_bookings, qc_calendar_blocks, qc_listings, qc_driver_profiles, qc_role_applications, qc_sessions, qc_login_codes, qc_users, qc_audit_log CASCADE')
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
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json() }
}

async function signIn(email) {
  assert.equal((await api('POST', '/api/auth/code', { body: { email } })).status, 202)
  const code = /(\d{6})/.exec(outbox.filter((m) => m.to === email).at(-1).text)[1]
  const r = await api('POST', '/api/auth/verify', { body: { email, code } })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return r.body.token
}

const iso = (daysFromNow) => new Date(Date.now() + daysFromNow * 86_400_000).toISOString().slice(0, 10)
const future = iso(400)

const listingBody = {
  title: 'Loft lumineux au Plateau', description: 'Un loft calme près du parc La Fontaine, idéal pour deux.',
  address: '1234 rue Rachel Est', city: 'Montréal', lat: 45.5265, lng: -73.5733, maxGuests: 2, bedrooms: 1, beds: 1,
  bathrooms: 1, nightlyCents: 14000, cleaningCents: 6000, minNights: 2, amenities: ['wifi'], photos: ['https://example.com/a.jpg'],
}

const driverDetails = (plate) => ({
  legalName: 'Driver ' + plate, phone: '+15145550000', licenceNumber: 'L' + plate, licenceExpiry: future, insuranceExpiry: future,
  category: 'STANDARD', vehicle: { make: 'Toyota', model: 'Prius', year: new Date().getFullYear() - 3, colour: 'Grey', plate },
})

let admin, host, guest, guest2, listingId

test('email-code sign-in: wrong code rejected, code single-use, admin from allow-list', async () => {
  await api('POST', '/api/auth/code', { body: { email: 'guest@qc.test' } })
  const bad = await api('POST', '/api/auth/verify', { body: { email: 'guest@qc.test', code: '000000' } })
  // 1 in a million the random code is 000000; tolerate it.
  if (bad.status !== 200) assert.equal(bad.body.error.code, 'INVALID_CODE')
  guest = await signIn('guest@qc.test')
  const code = /(\d{6})/.exec(outbox.at(-1).text)[1]
  assert.equal((await api('POST', '/api/auth/verify', { body: { email: 'guest@qc.test', code } })).status, 401)
  admin = await signIn('admin@qc.test')
  assert.deepEqual((await api('GET', '/api/me', { token: admin })).body.user.roles.sort(), ['ADMIN', 'GUEST'])
  assert.equal((await api('GET', '/api/me')).status, 401)
  assert.equal((await api('GET', '/api/admin/applications', { token: guest })).status, 403)
})

test('host onboarding: application, approval, listing review and publication', async () => {
  host = await signIn('host@qc.test')
  assert.equal((await api('POST', '/api/host/listings', { token: host, body: listingBody })).status, 403)
  const app = await api('POST', '/api/applications', { token: host, body: { role: 'HOST', details: { legalName: 'Hôte Test', phone: '+15145551111', address: 'Montréal' } } })
  assert.equal(app.status, 201)
  assert.equal((await api('POST', '/api/applications', { token: host, body: { role: 'HOST', details: { legalName: 'x', phone: 'x', address: 'x' } } })).body.error.code, 'APPLICATION_PENDING')
  const decided = await api('POST', `/api/admin/applications/${app.body.application.id}/decision`, { token: admin, body: { decision: 'APPROVE' } })
  assert.equal(decided.status, 200)
  assert.equal((await api('POST', `/api/admin/applications/${app.body.application.id}/decision`, { token: admin, body: { decision: 'APPROVE' } })).status, 409)

  const created = await api('POST', '/api/host/listings', { token: host, body: listingBody })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  listingId = created.body.listing.id
  const noReg = await api('POST', `/api/host/listings/${listingId}/submit`, { token: host })
  assert.equal(noReg.body.error.code, 'REGISTRATION_REQUIRED')
  await api('PATCH', `/api/host/listings/${listingId}`, { token: host, body: { registrationNumber: '123456' } })
  assert.equal((await api('POST', `/api/host/listings/${listingId}/submit`, { token: host })).body.listing.status, 'PENDING_REVIEW')
  assert.equal((await api('GET', '/api/stays')).body.listings.length, 0)
  assert.equal((await api('POST', `/api/admin/listings/${listingId}/decision`, { token: admin, body: { decision: 'PUBLISH' } })).status, 200)
  const found = await api('GET', '/api/stays?city=montr%C3%A9al')
  assert.equal(found.body.listings.length, 1)
})

test('stay quote: server-side CAD lines add up and include Québec taxes', async () => {
  const q = (await api('POST', `/api/stays/${listingId}/quote`, { body: { checkIn: iso(30), checkOut: iso(33), guests: 2 } })).body.quote
  // 3 nights x 140 + 60 cleaning = 480.00; service 12% = 57.60
  assert.equal(q.lines[0].cents, 42000)
  assert.equal(q.lines[2].cents, 5760)
  const byCode = Object.fromEntries(q.taxes.map((t) => [t.code, t.cents]))
  assert.equal(byCode.LODGING, 1680) // 3.5% of 480.00
  assert.equal(byCode.GST, 2688) // 5% of 537.60
  assert.equal(byCode.QST, 5363) // 9.975% of 537.60 = 53.6256
  assert.equal(q.totalCents, 48000 + 5760 + 1680 + 2688 + 5363)
  assert.equal(q.host.payoutCents, 48000 - 1440)
  assert.equal((await api('POST', `/api/stays/${listingId}/quote`, { body: { checkIn: iso(30), checkOut: iso(31), guests: 2 } })).body.error.code, 'MIN_NIGHTS')
  assert.equal((await api('POST', `/api/stays/${listingId}/quote`, { body: { checkIn: iso(-2), checkOut: iso(3), guests: 2 } })).body.error.code, 'INVALID_DATES')
})

test('stay booking: concurrent requests for the same nights produce exactly one hold', async () => {
  guest2 = await signIn('guest2@qc.test')
  const tokens = [guest, guest2, guest, guest2, guest, guest2]
  const results = await Promise.all(tokens.map((token) => api('POST', `/api/stays/${listingId}/book`, { token, body: { checkIn: iso(40), checkOut: iso(43), guests: 2 } })))
  assert.equal(results.filter((r) => r.status === 201).length, 1, JSON.stringify(results.map((r) => r.status)))
  assert.ok(results.filter((r) => r.status !== 201).every((r) => r.body.error.code === 'DATES_UNAVAILABLE'))
  assert.equal((await api('POST', `/api/stays/${listingId}/book`, { token: host, body: { checkIn: iso(50), checkOut: iso(52), guests: 1 } })).status, 403)
})

test('stay booking: confirm, early cancellation refunds in full, host calendar blocks', async () => {
  const hold = await api('POST', `/api/stays/${listingId}/book`, { token: guest, body: { checkIn: iso(60), checkOut: iso(62), guests: 2 } })
  const id = hold.body.booking.id
  assert.equal((await api('POST', `/api/bookings/${id}/checkout`, { token: guest2 })).status, 404)
  const confirmed = await api('POST', `/api/bookings/${id}/checkout`, { token: guest })
  assert.equal(confirmed.body.booking.status, 'CONFIRMED')
  assert.ok(confirmed.body.booking.listing.address)
  assert.equal((await api('GET', `/api/stays?checkIn=${iso(61)}&checkOut=${iso(63)}`)).body.listings.length, 0)

  const blocked = await api('POST', `/api/host/listings/${listingId}/blocks`, { token: host, body: { startDate: iso(61), endDate: iso(64) } })
  assert.equal(blocked.body.error.code, 'DATES_UNAVAILABLE')
  const block = await api('POST', `/api/host/listings/${listingId}/blocks`, { token: host, body: { startDate: iso(70), endDate: iso(75) } })
  assert.equal(block.status, 201)
  assert.equal((await api('POST', `/api/stays/${listingId}/book`, { token: guest2, body: { checkIn: iso(72), checkOut: iso(74), guests: 1 } })).body.error.code, 'DATES_UNAVAILABLE')

  const cancelled = await api('POST', `/api/bookings/${id}/cancel`, { token: guest })
  assert.equal(cancelled.body.booking.refundCents, confirmed.body.booking.totalCents)
})

test('stay booking: expired hold frees the dates and cannot be confirmed', async () => {
  const hold = await api('POST', `/api/stays/${listingId}/book`, { token: guest, body: { checkIn: iso(80), checkOut: iso(82), guests: 2 } })
  await db().stayBooking.update({ where: { id: hold.body.booking.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } })
  assert.equal((await api('POST', `/api/bookings/${hold.body.booking.id}/checkout`, { token: guest })).body.error.code, 'HOLD_EXPIRED')
  assert.equal((await api('POST', `/api/stays/${listingId}/book`, { token: guest2, body: { checkIn: iso(80), checkOut: iso(82), guests: 2 } })).status, 201)
})

test('stay cancellation policy: 50% inside the cutoff', async () => {
  const { guestRefundCents } = await import('../routes/stays.mjs')
  const { profile } = await import('../../../countries/canada/profile.mjs')
  const b = { checkIn: new Date(Date.UTC(2027, 0, 10)), totalCents: 10001 }
  assert.equal(guestRefundCents(b, profile, new Date('2027-01-06T12:00:00Z')), 10001)
  assert.equal(guestRefundCents(b, profile, new Date('2027-01-08T12:00:00Z')), 5001)
  assert.equal(guestRefundCents(b, profile, new Date('2027-01-10T06:00:00Z')), 0) // after 00:00 EST
})

let driverA, driverB, rideId

test('driver onboarding: unapproved users cannot drive; approval creates the profile', async () => {
  driverA = await signIn('driver-a@qc.test')
  driverB = await signIn('driver-b@qc.test')
  assert.equal((await api('POST', '/api/driver/status', { token: driverA, body: { online: true } })).status, 403)
  const expired = await api('POST', '/api/applications', { token: driverA, body: { role: 'DRIVER', details: { ...driverDetails('AAA111'), insuranceExpiry: iso(-1) } } })
  assert.equal(expired.body.error.code, 'DOCUMENT_EXPIRED')
  for (const [token, plate] of [[driverA, 'AAA111'], [driverB, 'BBB222']]) {
    const app = await api('POST', '/api/applications', { token, body: { role: 'DRIVER', details: driverDetails(plate) } })
    assert.equal(app.status, 201, JSON.stringify(app.body))
    assert.equal((await api('POST', `/api/admin/applications/${app.body.application.id}/decision`, { token: admin, body: { decision: 'APPROVE' } })).status, 200)
  }
  for (const token of [driverA, driverB]) {
    assert.equal((await api('POST', '/api/driver/status', { token, body: { online: true, lat: 45.505, lng: -73.57 } })).body.driver.online, true)
  }
})

test('ride: quote, request, single-winner dispatch, lifecycle and safety record', async () => {
  assert.equal((await api('POST', '/api/rides/quote', { token: guest, body: { pickup: { lat: 43.65, lng: -79.38 }, dropoff: { lat: 45.5, lng: -73.56 } } })).body.error.code, 'OUTSIDE_SERVICE_AREA')
  const quote = await api('POST', '/api/rides/quote', { token: guest, body: { pickup: { lat: 45.5017, lng: -73.5673, label: 'Centre-ville' }, dropoff: { lat: 45.4706, lng: -73.7408, label: 'YUL' }, category: 'STANDARD' } })
  assert.equal(quote.status, 201)
  const b = quote.body.quote.breakdown
  assert.equal(b.totalCents, b.lines.reduce((s, l) => s + l.cents, 0) + b.taxCents)
  assert.equal((await api('POST', '/api/rides', { token: guest2, body: { quoteId: quote.body.quote.id } })).body.error.code, 'QUOTE_EXPIRED')
  const ride = await api('POST', '/api/rides', { token: guest, body: { quoteId: quote.body.quote.id } })
  assert.equal(ride.status, 201)
  rideId = ride.body.ride.id
  assert.equal((await api('POST', '/api/rides', { token: guest, body: { quoteId: quote.body.quote.id } })).body.error.code, 'QUOTE_EXPIRED')

  const offers = await api('GET', '/api/driver/offers', { token: driverA })
  assert.equal(offers.body.offers[0].id, rideId)
  assert.equal(offers.body.offers[0].breakdown.totalCents, undefined)

  const [a, bRes] = await Promise.all([driverA, driverB].map((token) => api('POST', `/api/driver/rides/${rideId}/accept`, { token })))
  assert.deepEqual([a.status, bRes.status].sort(), [200, 409])
  const winner = a.status === 200 ? driverA : driverB
  const loser = winner === driverA ? driverB : driverA

  assert.equal((await api('POST', `/api/driver/rides/${rideId}/start`, { token: winner })).body.error.code, 'INVALID_STATE')
  assert.equal((await api('POST', `/api/driver/rides/${rideId}/arrive`, { token: loser })).status, 409)
  const pin = (await api('GET', `/api/rides/${rideId}`, { token: guest })).body.ride.pickupPin
  assert.match(pin, /^\d{4}$/)
  assert.equal((await api('GET', `/api/rides/${rideId}`, { token: winner })).body.ride.pickupPin, undefined)
  assert.equal((await api('POST', `/api/driver/rides/${rideId}/arrive`, { token: winner })).status, 200)
  const wrong = String((Number(pin) + 1) % 10000).padStart(4, '0')
  assert.equal((await api('POST', `/api/driver/rides/${rideId}/start`, { token: winner, body: { pin: wrong } })).body.error.code, 'WRONG_PIN')
  assert.equal((await api('POST', `/api/driver/rides/${rideId}/start`, { token: winner, body: { pin } })).status, 200)
  assert.equal((await api('POST', `/api/rides/${rideId}/sos`, { token: guest })).body.emergencyNumber, '911')
  assert.equal((await api('POST', `/api/driver/rides/${rideId}/complete`, { token: winner })).status, 200)
  const view = await api('GET', `/api/rides/${rideId}`, { token: guest })
  assert.equal(view.body.ride.status, 'COMPLETED')
  assert.deepEqual(view.body.ride.events.map((e) => e.type), ['REQUESTED', 'ACCEPTED', 'DRIVER_ARRIVED', 'TRIP_STARTED', 'SOS', 'TRIP_COMPLETED'])
  // Shared link: public, no price, no PIN.
  const shared = await api('GET', `/api/share/${view.body.ride.shareToken}`)
  assert.equal(shared.status, 200)
  assert.equal(shared.body.trip.status, 'COMPLETED')
  assert.equal(JSON.stringify(shared.body).includes(pin), false)
  assert.equal((await api('GET', '/api/share/not-a-token')).status, 404)
  // Two-way ratings, once each; tip once, 100% to the driver.
  assert.equal((await api('POST', `/api/rides/${rideId}/rate`, { token: guest, body: { rating: 6 } })).body.error.code, 'INVALID_RATING')
  assert.equal((await api('POST', `/api/rides/${rideId}/rate`, { token: guest, body: { rating: 5, comment: 'Merci' } })).status, 200)
  assert.equal((await api('POST', `/api/rides/${rideId}/rate`, { token: guest, body: { rating: 4 } })).body.error.code, 'CANNOT_RATE')
  assert.equal((await api('POST', `/api/driver/rides/${rideId}/rate`, { token: winner, body: { rating: 5 } })).status, 200)
  assert.equal((await api('POST', `/api/rides/${rideId}/tip`, { token: guest2, body: { cents: 300 } })).body.error.code, 'CANNOT_TIP')
  assert.equal((await api('POST', `/api/rides/${rideId}/tip`, { token: guest, body: { cents: 300 } })).body.tipCents, 300)
  assert.equal((await api('POST', `/api/rides/${rideId}/tip`, { token: guest, body: { cents: 300 } })).body.error.code, 'CANNOT_TIP')
  assert.equal(view.body.ride.driver.vehicle.plate.length, 6)
  assert.equal((await api('GET', `/api/rides/${rideId}`, { token: guest2 })).status, 404)
  const earnings = await api('GET', '/api/driver/rides', { token: winner })
  assert.equal(earnings.body.earningsCents, b.driver.payoutCents + 300)
  assert.equal(earnings.body.tipsCents, 300)
  assert.equal(earnings.body.driver.online, true)
  assert.equal(earnings.body.driver.vehicle.plate.length, 6)
  await assert.rejects(db().rideEvent.deleteMany({ where: { rideId } }), /append-only/)
})

test('driver: expired insurance blocks driving; suspension revokes sessions', async () => {
  const me = (await api('GET', '/api/me', { token: driverB })).body.user
  await db().driverProfile.update({ where: { userId: me.id }, data: { insuranceExpiry: new Date(Date.UTC(2020, 0, 1)) } })
  assert.equal((await api('GET', '/api/driver/offers', { token: driverB })).status, 403)
  assert.equal((await api('POST', `/api/admin/users/${me.id}/suspend`, { token: admin, body: { reason: 'test' } })).status, 200)
  assert.equal((await api('GET', '/api/me', { token: driverB })).status, 401)
})
