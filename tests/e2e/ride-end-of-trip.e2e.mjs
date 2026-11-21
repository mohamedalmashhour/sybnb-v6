// End of trip (owner 2026-11-20): rider rates driver, driver rates rider, rider tips the driver
// (100% to the driver, paid from wallet balance). Runs on the active country where payments are
// eligible (Syria in the governed suite; Canada keeps payments closed and is covered there).
import { randomUUID } from 'node:crypto'
import { createSessionToken } from './_session.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3000'
const RUN = randomUUID().slice(0, 8)
let pass = 0, fail = 0
const check = (l, c, d) => { if (c) { pass++; console.log(`   PASS  ${l}`) } else { fail++; console.log(`  FAIL  ${l}  -> ${typeof d === 'string' ? d : JSON.stringify(d)?.slice(0, 300)}`) } }
async function call(method, path, token, body) {
  const res = await fetch(API + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text(); let j; try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}
const code = (r) => r.j?.error?.code || r.j?.code
async function seedUser(label, roles) {
  const u = await db().user.create({ data: { email: `eot-${label}-${RUN}@example.test`, displayName: `EOT ${label}`, roles: { create: roles.map((role) => ({ role })) } } })
  return { ...u, token: await createSessionToken({ id: u.id, roles: roles.map((role) => ({ role })) }) }
}

async function main() {
  const rider = await seedUser('rider', ['GUEST'])
  const driver = await seedUser('driver', ['GUEST', 'DRIVER'])
  const other = await seedUser('other', ['GUEST', 'DRIVER'])
  const currency = 'USD'
  const ride = await db().rideRequest.create({ data: { riderId: rider.id, driverId: driver.id, status: 'COMPLETED', fareMinor: 10, currency, metadata: { category: 'SR Economy' } } })
  await db().wallet.upsert({ where: { userId_currency: { userId: rider.id, currency } }, create: { userId: rider.id, currency, cachedBalanceMinor: 50 }, update: { cachedBalanceMinor: 50 } })

  const rr = await call('POST', `/api/sr/rides/${ride.id}/review`, rider.token, { rating: 5 })
  check('rider rates the driver', rr.status === 201, rr)
  const notMine = await call('POST', `/api/sr/rides/${ride.id}/rate-rider`, other.token, { rating: 1 })
  check('another driver cannot rate this rider', notMine.status === 404, notMine)
  const bad = await call('POST', `/api/sr/rides/${ride.id}/rate-rider`, driver.token, { rating: 9 })
  check('rating must be 1..5', code(bad) === 'REVIEW_RATING_INVALID', bad)
  const dr = await call('POST', `/api/sr/rides/${ride.id}/rate-rider`, driver.token, { rating: 3 })
  check('driver rates the rider', dr.status === 201, dr)
  const view = await call('GET', `/api/sr/rides/${ride.id}`, driver.token)
  check('driver sees the rider rating', view.j?.ride?.riderRating?.averageRating === 3, view.j?.ride?.riderRating)

  const tooBig = await call('POST', `/api/sr/rides/${ride.id}/tip`, rider.token, { amountMinor: 21 })
  check('tip above twice the fare is refused (no country limit set)', code(tooBig) === 'TIP_AMOUNT_INVALID', tooBig)
  const tip = await call('POST', `/api/sr/rides/${ride.id}/tip`, rider.token, { amountMinor: 5 })
  check('rider tips the driver', tip.status === 201 && tip.j?.tip?.amountMinor === 5, tip)
  const dw = await db().wallet.findUnique({ where: { userId_currency: { userId: driver.id, currency } } })
  const rw = await db().wallet.findUnique({ where: { userId_currency: { userId: rider.id, currency } } })
  check('100% of the tip reaches the driver', dw?.cachedBalanceMinor === 5, dw)
  check('rider wallet debited by the tip', rw?.cachedBalanceMinor === 45, rw)
  const again = await call('POST', `/api/sr/rides/${ride.id}/tip`, rider.token, { amountMinor: 1 })
  check('one tip per ride', code(again) === 'TIP_ALREADY_GIVEN', again)

  const ride2 = await db().rideRequest.create({ data: { riderId: rider.id, driverId: driver.id, status: 'COMPLETED', fareMinor: 100, currency, metadata: { category: 'SR Economy' } } })
  const broke = await call('POST', `/api/sr/rides/${ride2.id}/tip`, rider.token, { amountMinor: 60 })
  check('tip larger than the wallet balance is refused', code(broke) === 'WALLET_INSUFFICIENT_FUNDS', broke)
  const open = await db().rideRequest.create({ data: { riderId: rider.id, driverId: driver.id, status: 'IN_PROGRESS', fareMinor: 10, currency, metadata: { category: 'SR Economy' } } })
  const early = await call('POST', `/api/sr/rides/${open.id}/tip`, rider.token, { amountMinor: 1 })
  check('no tip before the ride is completed', code(early) === 'TIP_RIDE_NOT_COMPLETED', early)

  console.log(`\n==== END-OF-TRIP E2E: ${pass} passed, ${fail} failed ====`)
  await disconnectDb()
  process.exit(fail ? 1 : 0)
}
main().catch(async (e) => { console.error(e); await disconnectDb().catch(() => {}); process.exit(1) })
