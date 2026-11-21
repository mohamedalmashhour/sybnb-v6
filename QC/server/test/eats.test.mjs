// Q EAT end-to-end API test (real Postgres, simulated payments). Run: npm run qc:test
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
  await db().$executeRawUnsafe('TRUNCATE qc_food_orders, qc_menu_items, qc_merchants, qc_ride_events, qc_rides, qc_ride_quotes, qc_stay_bookings, qc_calendar_blocks, qc_listings, qc_driver_profiles, qc_role_applications, qc_sessions, qc_login_codes, qc_users, qc_audit_log CASCADE')
  server = createServer(createHandler())
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => { server.closeAllConnections(); server.close(); await disconnectDb() })

async function api(method, path, { token, body } = {}) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, body: await res.json() }
}
async function signIn(email) {
  await api('POST', '/api/auth/code', { body: { email } })
  const code = /(\d{6})/.exec(outbox.filter((m) => m.to === email).at(-1).text)[1]
  return (await api('POST', '/api/auth/verify', { body: { email, code } })).body.token
}

const RESTO = { name: 'Poutinerie Test', category: 'fastfood', address: '4400 rue Saint-Denis, Montréal', lat: 45.5245, lng: -73.5822, permitNumber: 'MAPAQ-1', neq: '1173544397', prepMinutes: 15 }
const HOME = { lat: 45.5300, lng: -73.5800, label: '123 rue Test' }

test('Q EAT: apply → approve → menu → order → kitchen → courier → delivered → rated', async () => {
  const owner = await signIn('resto@qc.test')
  const admin = await signIn('admin@qc.test')
  const customer = await signIn('client@qc.test')
  const courierT = await signIn('courier@qc.test')

  assert.equal((await api('POST', '/api/eats/merchants', { token: owner, body: { ...RESTO, category: 'alcohol' } })).status, 400)
  const applied = await api('POST', '/api/eats/merchants', { token: owner, body: RESTO })
  assert.equal(applied.status, 201, JSON.stringify(applied.body))
  const mid = applied.body.merchant.id
  assert.equal((await api('GET', `/api/eats/merchants/${mid}`)).status, 404) // not public until approved
  assert.equal((await api('POST', `/api/admin/eats/merchants/${mid}/decision`, { token: owner, body: { decision: 'APPROVE' } })).status, 403)
  assert.equal((await api('POST', `/api/admin/eats/merchants/${mid}/decision`, { token: admin, body: { decision: 'APPROVE' } })).status, 200)

  const i1 = await api('POST', `/api/eats/merchants/${mid}/items`, { token: owner, body: { section: 'Poutines', name: 'Classique', priceCents: 1200 } })
  const i2 = await api('POST', `/api/eats/merchants/${mid}/items`, { token: owner, body: { section: 'Boissons', name: 'Limonade', priceCents: 400 } })
  assert.equal((await api('POST', `/api/eats/merchants/${mid}/items`, { token: customer, body: { name: 'x', priceCents: 1 } })).status, 403)

  const list = await api('GET', `/api/eats/merchants?lat=${HOME.lat}&lng=${HOME.lng}`)
  assert.equal(list.body.merchants[0].delivers, true)
  const menu = await api('GET', `/api/eats/merchants/${mid}`)
  assert.equal(menu.body.items.length, 2)

  const items = [{ itemId: i1.body.item.id, qty: 2 }, { itemId: i2.body.item.id, qty: 1 }]
  const q = await api('POST', '/api/eats/quote', { token: customer, body: { merchantId: mid, items, address: HOME, tipCents: 300 } })
  assert.equal(q.status, 200, JSON.stringify(q.body))
  assert.equal(q.body.quote.lines[0].cents, 2800)
  assert.equal(q.body.quote.merchant, undefined) // customer never sees the split
  const far = await api('POST', '/api/eats/quote', { token: customer, body: { merchantId: mid, items, address: { lat: 45.65, lng: -73.58 } } })
  assert.equal(far.body.error.code, 'TOO_FAR')

  const placed = await api('POST', '/api/eats/orders', { token: customer, body: { merchantId: mid, items, address: HOME, tipCents: 300, note: 'Sonnez 2 fois' } })
  assert.equal(placed.status, 201, JSON.stringify(placed.body))
  const oid = placed.body.order.id
  assert.equal(placed.body.order.totalCents, q.body.quote.totalCents)

  // Merchant sees payout, not the customer total; customer cannot accept.
  const kitchen = await api('GET', `/api/eats/merchants/${mid}/orders`, { token: owner })
  assert.equal(kitchen.body.orders[0].totalCents, undefined)
  assert.equal(kitchen.body.orders[0].payout.payoutCents, 2240)
  assert.equal((await api('POST', `/api/eats/orders/${oid}/merchant`, { token: customer, body: { status: 'ACCEPTED' } })).status, 404)
  assert.equal((await api('POST', `/api/eats/orders/${oid}/merchant`, { token: owner, body: { status: 'READY_FOR_PICKUP' } })).status, 409)
  assert.equal((await api('POST', `/api/eats/orders/${oid}/merchant`, { token: owner, body: { status: 'ACCEPTED', prepMinutes: 20 } })).status, 200)

  // Courier: approved driver from the shared pool, online near the restaurant.
  const cu = await db().user.update({ where: { email: 'courier@qc.test' }, data: { roles: ['GUEST', 'DRIVER'], name: 'Livreur Test' } })
  const future = new Date(Date.UTC(new Date().getUTCFullYear() + 2, 0, 1))
  await db().driverProfile.create({ data: { userId: cu.id, vehicle: { make: 'Vélo', plate: '-' }, licenceExpiry: future, insuranceExpiry: future, online: true, lat: 45.526, lng: -73.581 } })
  const offers = await api('GET', '/api/eats/courier/offers', { token: courierT })
  assert.equal(offers.body.offers.length, 1)
  assert.equal(offers.body.offers[0].totalCents, undefined) // courier never sees what the customer pays
  assert.ok(offers.body.offers[0].pay.payoutCents >= 300)
  assert.equal((await api('POST', `/api/eats/courier/orders/${oid}/claim`, { token: courierT })).status, 200)
  assert.equal((await api('POST', `/api/eats/courier/orders/${oid}/status`, { token: courierT, body: { status: 'PICKED_UP' } })).status, 409) // not ready yet

  assert.equal((await api('POST', `/api/eats/orders/${oid}/merchant`, { token: owner, body: { status: 'PREPARING' } })).status, 200)
  assert.equal((await api('POST', `/api/eats/orders/${oid}/cancel`, { token: customer })).status, 200)
})

test('Q EAT: cancel refunds and full delivery path', async () => {
  const owner = await signIn('resto@qc.test')
  const customer = await signIn('client@qc.test')
  const courierT = await signIn('courier@qc.test')
  const mid = (await api('GET', '/api/eats/my/merchants', { token: owner })).body.merchants[0].id
  const item = (await api('GET', `/api/eats/merchants/${mid}`)).body.items[0]
  const items = [{ itemId: item.id, qty: 1 }]

  // The first test's order was cancelled while PREPARING: food cost kept, fees refunded.
  const history = await api('GET', '/api/eats/orders', { token: customer })
  const prev = history.body.orders.find((o) => o.status === 'CANCELLED')
  assert.equal(prev.refundCents, prev.totalCents - 2800)

  // Cancel before the restaurant accepts → full refund.
  const a = await api('POST', '/api/eats/orders', { token: customer, body: { merchantId: mid, items, address: HOME } })
  const ca = await api('POST', `/api/eats/orders/${a.body.order.id}/cancel`, { token: customer })
  assert.equal(ca.body.refundCents, a.body.order.totalCents)

  // Full path.
  const b = await api('POST', '/api/eats/orders', { token: customer, body: { merchantId: mid, items, address: HOME, tipCents: 200 } })
  const oid = b.body.order.id
  for (const s of ['ACCEPTED', 'PREPARING']) assert.equal((await api('POST', `/api/eats/orders/${oid}/merchant`, { token: owner, body: { status: s } })).status, 200)
  assert.equal((await api('POST', `/api/eats/courier/orders/${oid}/claim`, { token: courierT })).status, 200)
  assert.equal((await api('POST', `/api/eats/orders/${oid}/merchant`, { token: owner, body: { status: 'READY_FOR_PICKUP' } })).status, 200)
  assert.equal((await api('POST', `/api/eats/orders/${oid}/cancel`, { token: customer })).status, 409) // too late
  assert.equal((await api('POST', `/api/eats/courier/orders/${oid}/status`, { token: courierT, body: { status: 'PICKED_UP' } })).status, 200)
  assert.equal((await api('POST', `/api/eats/courier/orders/${oid}/status`, { token: courierT, body: { status: 'DELIVERED' } })).status, 200)
  const active = await api('GET', '/api/eats/courier/active', { token: courierT })
  assert.ok(active.body.todayCents >= 600) // pay includes the 100 % tip
  assert.equal((await api('POST', `/api/eats/orders/${oid}/rate`, { token: customer, body: { stars: 5 } })).status, 200)
  assert.equal((await api('POST', `/api/eats/orders/${oid}/rate`, { token: customer, body: { stars: 4 } })).status, 409)

  // Pickup order: no delivery fee, merchant hands over.
  const p = await api('POST', '/api/eats/orders', { token: customer, body: { merchantId: mid, items, fulfillment: 'pickup' } })
  assert.ok(!p.body.order.breakdown.lines.some((l) => l.code === 'DELIVERY_FEE'))
  for (const s of ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'DELIVERED']) assert.equal((await api('POST', `/api/eats/orders/${p.body.order.id}/merchant`, { token: owner, body: { status: s } })).status, 200)

  // Busy restaurant refuses new orders.
  await api('PATCH', `/api/eats/merchants/${mid}`, { token: owner, body: { busy: true } })
  assert.equal((await api('POST', '/api/eats/orders', { token: customer, body: { merchantId: mid, items, address: HOME } })).body.error.code, 'MERCHANT_CLOSED')
})
