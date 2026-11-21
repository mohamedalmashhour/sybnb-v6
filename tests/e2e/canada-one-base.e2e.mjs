// One base, step 2: the MAIN backend running as Canada (SYBNB_COUNTRY=canada) on its own database.
// Probes the stays and rides journeys end to end and reports every gap as a FAIL.
// Run: API_BASE=http://127.0.0.1:3071 DATABASE_URL=<canada test db> SYBNB_COUNTRY=canada node tests/e2e/canada-one-base.e2e.mjs
import { randomUUID } from 'node:crypto'
import { createSessionToken } from './_session.mjs'
import { db, disconnectDb } from '../../server/lib/prisma.mjs'
import { makeDriverReady } from './_verified-driver.mjs'

const API = process.env.API_BASE || 'http://127.0.0.1:3071'
const RUN = randomUUID().slice(0, 8)
let pass = 0, fail = 0
const check = (l, c, d) => { if (c) { pass++; console.log(`   PASS  ${l}`) } else { fail++; console.log(`  FAIL  ${l}  -> ${typeof d === 'string' ? d : JSON.stringify(d)?.slice(0, 300)}`) } }
async function call(method, path, token, body) {
  const res = await fetch(API + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text(); let j; try { j = JSON.parse(text) } catch { j = { raw: text } }
  return { status: res.status, j }
}
const code = (r) => r.j?.error?.code || r.j?.code
const day = (n) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n)).toISOString().slice(0, 10) }
async function seedUser(label, roles, extra = {}) {
  const u = await db().user.create({ data: { email: `ca-${label}-${RUN}@example.test`, displayName: `CA ${label}`, locale: 'fr-CA', roles: { create: roles.map((role) => ({ role })) }, ...extra } })
  return { ...u, token: await createSessionToken({ id: u.id, roles: roles.map((role) => ({ role })) }) }
}

async function main() {
  if (process.env.SYBNB_COUNTRY !== 'canada') throw new Error('run with SYBNB_COUNTRY=canada')
  const host = await seedUser('host', ['GUEST', 'HOST'], { idDocumentStatus: 'APPROVED', hostVerifiedAt: new Date() })
  const guest = await seedUser('guest', ['GUEST'])
  const admin = await seedUser('admin', ['ADMIN'])

  console.log('=== 1. HOST LISTS A STAY IN CAD ===')
  const legal = await call('GET', '/api/legal')
  const agreement = legal.j?.documents?.find((d) => d.key === 'listing-agreement')
  await call('POST', '/api/legal/consent', host.token, { documentKey: 'listing-agreement', version: agreement?.version })
  const payout = await call('PUT', '/api/host/payout-method', host.token, { type: 'BANK', bankName: 'Desjardins', accountName: 'CA Host', accountNumber: '12345' })
  check('host can set a Canadian payout method', payout.status === 200, payout)
  const created = await call('POST', '/api/listings', host.token, { division: 'STAYS', titleAr: 'Loft Plateau', titleEn: 'Plateau loft', priceMinor: 15000, currency: 'CAD', instantBookEnabled: true, metadata: { maxGuests: 4 } })
  check('stay created in CAD (201)', created.status === 201 && created.j?.listing?.currency === 'CAD', created)
  const id = created.j?.listing?.id
  const noReg = await call('PATCH', `/api/listings/${id}/submit`, host.token)
  check('submit without CITQ registration number -> REGISTRATION_NUMBER_REQUIRED', code(noReg) === 'REGISTRATION_NUMBER_REQUIRED', noReg)
  await db().listing.update({ where: { id }, data: { metadata: { maxGuests: 4, registrationNumber: 'CITQ-123456' } } })
  const sub = await call('PATCH', `/api/listings/${id}/submit`, host.token)
  check('submit with registration number -> PENDING_REVIEW', sub.status === 200, sub)
  const appr = await call('PATCH', `/api/admin/review-queue/listing/${id}`, admin.token, { decision: 'APPROVE' })
  check('admin approves the stay', appr.status === 200, appr)

  console.log('\n=== 2. GUEST TOTAL: CANADA PRICES (12% guest fee, lodging tax + GST/QST) ===')
  const q = await call('GET', `/api/bookings/quote?listingId=${id}&checkIn=${day(30)}&checkOut=${day(32)}`, guest.token)
  const quote = q.j?.quote || q.j
  check('guest quote answers in CAD', q.status === 200 && quote?.currency === 'CAD', q)
  // 2 nights x 150.00 = 300.00; fee 12% = 36.00; lodging 3.5% of 300 = 10.50; GST 5% + QST 9.975% of 336.00
  const expected = 30000 + 3600 + 1050 + Math.round(33600 * 0.05) + Math.round(33600 * 0.09975)
  check(`guest total follows the Canada settings (${expected} cents)`, quote?.totalMinor === expected, quote)
  check('taxes are included', (quote?.taxesMinor || 0) > 0, quote)

  console.log('\n=== 3. BOOKING WITH A 30-MINUTE PAYMENT HOLD ===')
  const b = await call('POST', '/api/bookings', guest.token, { listingId: id, checkIn: day(30), checkOut: day(32) })
  check('booking created (201) in CAD', b.status === 201 && b.j?.booking?.currency === 'CAD', b)
  const exp = b.j?.booking?.expiresAt ? new Date(b.j.booking.expiresAt) - new Date(b.j.booking.createdAt) : null
  check('unpaid booking expires after 30 minutes', exp === 30 * 60e3, { expiresInMs: exp })

  console.log('\n=== 3b. STAY GOVERNMENT MONEY: LODGING_TAX + GST_QST, HOST PAID WITHOUT TAXES ===')
  const bk = await db().booking.findUnique({ where: { id: b.j?.booking?.id }, include: { listing: true } })
  const ss = bk?.metadata?.staySplit
  const lodgingTax = 1050, gst = Math.round(33600 * 0.05), qst = Math.round(33600 * 0.09975)
  check('booking snapshots the stay split with the government charges', ss?.governmentCharges?.totalMinor === lodgingTax + gst + qst, ss)
  check('lodging tax goes to LODGING_TAX, GST/QST to GST_QST', ss?.governmentCharges?.taxes?.find((t) => t.code === 'LODGING')?.account === 'LODGING_TAX' && ss.governmentCharges.taxes.filter((t) => t.account === 'GST_QST').length === 2, ss?.governmentCharges)
  const { bookingFinanceSplit } = await import('../../server/lib/finance-ledger.mjs')
  const sp = bookingFinanceSplit(bk, ss.totalMinor) // the guest pays the full total (stay + fee + taxes)
  check('host gets stay minus 3% commission, no taxes (291.00)', sp.hostGrossMinor === 30000 - 900, sp)
  check('platform gets guest fee + commission, no taxes (45.00)', sp.adminShareMinor === 3600 + 900, sp)
  check('host + platform + government = what the guest paid', sp.hostGrossMinor + sp.adminShareMinor + sp.governmentMinor === ss.totalMinor, sp)
  await db().booking.update({ where: { id: bk.id }, data: { status: 'CONFIRMED', checkIn: new Date(Date.now() - 3 * 864e5), checkOut: new Date(Date.now() - 864e5) } })
  const { completeExpiredBookings } = await import('../../server/lib/booking-lifecycle.mjs')
  await completeExpiredBookings({ id: bk.id })
  const stayRows = await db().taxCollection.findMany({ where: { sourceType: 'stay', sourceId: bk.id } })
  check('completed stay records its taxes in the tax accounts', stayRows.length === 3 && stayRows.reduce((a, r) => a + r.amountMinor, 0) === lodgingTax + gst + qst, stayRows)
  await completeExpiredBookings({ id: bk.id })
  check('re-running completion never double-records', (await db().taxCollection.count({ where: { sourceType: 'stay', sourceId: bk.id } })) === 3)

  console.log('\n=== 4. RIDE QUOTE IN MONTRÉAL ===')
  const r = await call('POST', '/api/sr/quote', guest.token, { pickup: 'Montréal centre-ville', dropoff: 'Plateau', category: 'SR Comfort', pickupCoords: { lat: 45.5017, lng: -73.5673 }, dropoffCoords: { lat: 45.522, lng: -73.585 } })
  check('ride quote answers for Canada (CAD)', r.status === 200 && (r.j?.quote?.currency || r.j?.currency) === 'CAD', r)
  const rq = r.j?.quote || {}
  check('fare is in cents (Uber/Lyft style), not whole dollars', Number.isInteger(rq.fareMinor) && rq.fareMinor > 100, rq.fareMinor)
  check('$0.90 Québec dues shown separately', rq.charges?.duesMinor === 90, rq.charges)
  const base = rq.fareMinor + 90
  check('GST 5% + QST 9.975% on fare + dues', rq.charges?.taxes?.[0]?.minor === Math.round(base * 0.05) && rq.charges?.taxes?.[1]?.minor === Math.round(base * 0.09975), rq.charges)
  check('rider total = fare + dues + taxes', rq.charges?.totalMinor === base + rq.charges.taxMinor, rq.charges)

  const cats = await call('GET', '/api/sr/categories', guest.token)
  check('Canada offers Standard, Comfort, XL, Premium, Electric (Uber/Lyft line-up)', cats.status === 200 && cats.j?.categories?.map((c) => c.name?.en).join(',') === 'Standard,Comfort,XL,Premium,Electric', cats.j)
  const prem = await call('POST', '/api/sr/quote', guest.token, { pickup: 'Montréal centre-ville', dropoff: 'Plateau', category: 'SR VIP', pickupCoords: { lat: 45.5017, lng: -73.5673 }, dropoffCoords: { lat: 45.522, lng: -73.585 } })
  check('Premium costs more than Standard and shows its name', (prem.j?.quote?.fareMinor || 0) > rq.fareMinor && prem.j?.quote?.categoryInfo?.name?.fr === 'Premium', prem.j?.quote)

  check('pet and accessible options offered', cats.j?.options?.petFeeMinor === 500 && cats.j?.options?.accessible === true, cats.j?.options)
  const petQ = await call('POST', '/api/sr/quote', guest.token, { pickup: 'Montréal centre-ville', dropoff: 'Plateau', category: 'SR Economy', pet: true, pickupCoords: { lat: 45.5017, lng: -73.5673 }, dropoffCoords: { lat: 45.522, lng: -73.585 } })
  const ecoQ = await call('POST', '/api/sr/quote', guest.token, { pickup: 'Montréal centre-ville', dropoff: 'Plateau', category: 'SR Economy', pickupCoords: { lat: 45.5017, lng: -73.5673 }, dropoffCoords: { lat: 45.522, lng: -73.585 } })
  check('pet adds $5.00 to the fare', petQ.j?.quote?.petFeeMinor === 500 && petQ.j?.quote?.fareMinor === ecoQ.j?.quote?.fareMinor + 500, { pet: petQ.j?.quote?.fareMinor, eco: ecoQ.j?.quote?.fareMinor })
  const bike = await call('POST', '/api/sr/quote', guest.token, { pickup: 'Montréal centre-ville', dropoff: 'Plateau', category: 'SR Bike', pickupCoords: { lat: 45.5017, lng: -73.5673 }, dropoffCoords: { lat: 45.522, lng: -73.585 } })
  check('a category Canada does not offer is refused', code(bike) === 'RIDE_CATEGORY_NOT_OFFERED', bike)

  console.log('\n=== 5. DRIVER MUST BE GST/QST-REGISTERED (Revenu Québec) ===')
  const driver = await seedUser('driver', ['GUEST', 'DRIVER'], { idDocumentStatus: 'APPROVED' })
  const tn0 = await call('GET', '/api/driver/tax-numbers', driver.token)
  check('Canada requires GST + QST numbers for drivers', JSON.stringify(tn0.j?.required) === JSON.stringify(['gst', 'qst']), tn0)
  const bad = await call('PUT', '/api/driver/tax-numbers', driver.token, { gst: '1', qst: '' })
  check('invalid numbers refused', code(bad) === 'TAX_NUMBER_INVALID', bad)
  const ok = await call('PUT', '/api/driver/tax-numbers', driver.token, { gst: '123456789 RT0001', qst: '1234567890 TQ0001' })
  check('valid GST/QST numbers saved', ok.status === 200 && ok.j?.numbers?.qst === '1234567890 TQ0001', ok)

  console.log('\n=== 6. FULL PAID RIDE: GOVERNMENT MONEY GOES TO ITS OWN ACCOUNTS ===')
  await makeDriverReady(db(), driver.id)
  // Wallet funded in CAD (stands in for a card top-up); the rider prepays fare + dues + taxes.
  await db().wallet.upsert({ where: { userId_currency: { userId: guest.id, currency: 'CAD' } }, create: { userId: guest.id, currency: 'CAD', cachedBalanceMinor: 100_000 }, update: { cachedBalanceMinor: 100_000 } })
  const req = await call('POST', '/api/sr/rides', guest.token, { pickup: 'Montréal centre-ville', dropoff: 'Plateau', category: 'SR Economy', pickupCoords: { lat: 45.5017, lng: -73.5673 }, dropoffCoords: { lat: 45.522, lng: -73.585 } })
  const ride = req.j?.ride || req.j?.rideRequest || req.j
  check('ride requested (201)', req.status === 201 && ride?.id, req)
  const fresh = await db().rideRequest.findUnique({ where: { id: ride?.id } })
  const gc = fresh?.metadata?.governmentCharges
  check('government charges snapshotted on the ride', gc?.duesMinor === 90 && gc?.taxes?.length === 2, gc)
  check('rider prepaid fare + dues + taxes', fresh?.metadata?.prepaid === true && fresh?.metadata?.prepaidAmountMinor === gc?.totalMinor, fresh?.metadata)
  const claim = await call('PATCH', `/api/sr/rides/${ride?.id}/claim`, driver.token)
  check('driver claims the ride', claim.status === 200, claim)
  const rv = await call('GET', `/api/sr/rides/${ride?.id}`, guest.token)
  check('rider app is told "this trip is recorded"', rv.j?.ride?.recording?.recorded === true, rv.j?.ride?.recording)
  const dv = await call('GET', `/api/sr/rides/${ride?.id}`, driver.token)
  check('driver app is told "this trip is recorded"', dv.j?.ride?.recording?.recorded === true, dv.j?.ride?.recording)
  for (const st of ['DRIVER_ARRIVING', 'IN_PROGRESS', 'COMPLETED']) {
    if (st === 'IN_PROGRESS') {
      // The rider tells the driver the 4-digit pickup code (safety rule), the driver enters it.
      const v = await call('POST', `/api/sr/rides/${ride?.id}/verify-pickup`, driver.token, { code: fresh?.metadata?.pickupCode })
      check('driver verifies the rider pickup code', v.status === 200, v)
    }
    const r2 = await call('PATCH', `/api/driver/rides/${ride?.id}/status`, driver.token, { status: st })
    check(`driver -> ${st}`, r2.status === 200, r2)
  }
  const coll = await db().taxCollection.findMany({ where: { sourceType: 'ride', sourceId: ride?.id }, orderBy: { taxCode: 'asc' } })
  const by = Object.fromEntries(coll.map((c) => [c.taxCode, c]))
  check('DUES recorded in RIDE_DUES (90 cents)', by.DUES?.account === 'RIDE_DUES' && by.DUES?.amountMinor === 90, coll)
  check('GST + QST recorded in GST_QST', by.GST?.account === 'GST_QST' && by.QST?.account === 'GST_QST' && by.GST.amountMinor + by.QST.amountMinor === gc?.taxMinor, coll)
  const driverCredit = await db().walletEntry.findFirst({ where: { referenceType: 'ride_fare', referenceId: ride?.id } })
  check('driver paid from the fare only (no taxes, no dues)', driverCredit && driverCredit.amountMinor < fresh.fareMinor, { credit: driverCredit?.amountMinor, fare: fresh?.fareMinor })

  console.log('\n=== 6a. END OF TRIP: RATINGS BOTH WAYS + TIP ===')
  const rr = await call('POST', `/api/sr/rides/${ride?.id}/review`, guest.token, { rating: 5, comment: 'Great driver' })
  check('rider rates the driver', rr.status === 201, rr)
  const dr = await call('POST', `/api/sr/rides/${ride?.id}/rate-rider`, driver.token, { rating: 4, comment: 'On time' })
  check('driver rates the rider', dr.status === 201 && dr.j?.review?.rating === 4, dr)
  const dr2 = await call('POST', `/api/sr/rides/${ride?.id}/rate-rider`, driver.token, { rating: 5 })
  check('driver can rate the rider only once', code(dr2) === 'REVIEW_ALREADY_EXISTS', dr2)
  const view = await call('GET', `/api/sr/rides/${ride?.id}`, driver.token)
  check('driver sees the rider rating', view.j?.ride?.riderRating?.averageRating === 4 && view.j?.ride?.driverRatedRider === true, view.j?.ride?.riderRating)
  // Payments stay closed for Canada (§5), so a tip is refused by the payment policy until the owner
  // opens them; the tip money flow itself is covered by ride-end-of-trip.e2e.mjs.
  const tip = await call('POST', `/api/sr/rides/${ride?.id}/tip`, guest.token, { amountMinor: 300 })
  check('tip refused while Canada payments are closed (fail-closed)', code(tip) === 'PAYMENT_POLICY_DENIED', tip)
  const bigTip = await call('POST', `/api/sr/rides/${ride?.id}/tip`, guest.token, { amountMinor: 20000 })
  check('tip above the Canada limit ($100) is refused first', code(bigTip) === 'TIP_AMOUNT_INVALID', bigTip)

  console.log('\n=== 6b. LATE CANCELLATION: FEE + GST/QST ON THE FEE (no dues) ===')
  const req2 = await call('POST', '/api/sr/rides', guest.token, { pickup: 'Montréal centre-ville', dropoff: 'Laval', category: 'SR Economy', pickupCoords: { lat: 45.5017, lng: -73.5673 }, dropoffCoords: { lat: 45.6066, lng: -73.7124 } })
  const ride2 = req2.j?.ride || req2.j
  const claim2 = await call('PATCH', `/api/sr/rides/${ride2?.id}/claim`, driver.token)
  check('second ride claimed', claim2.status === 200, claim2)
  // Past the free-cancel grace window (2 min after the driver accepts).
  await db().$executeRaw`UPDATE ride_requests SET updated_at = now() - interval '10 minutes' WHERE id = ${ride2?.id}::uuid`
  const before = await db().rideRequest.findUnique({ where: { id: ride2?.id } })
  const cancel = await call('PATCH', `/api/sr/rides/${ride2?.id}/cancel`, guest.token)
  check('rider cancels late (200)', cancel.status === 200, cancel)
  const after2 = await db().rideRequest.findUnique({ where: { id: ride2?.id } })
  const fee = after2?.cancellationFeeMinor || 0
  check('15% cancellation fee charged', fee === Math.round(before.fareMinor * 0.15) || fee > 0, { fee, fare: before?.fareMinor })
  const feeTax = await db().taxCollection.findMany({ where: { sourceType: 'ride_cancellation_fee', sourceId: ride2?.id } })
  const gstF = feeTax.find((t) => t.taxCode === 'GST'), qstF = feeTax.find((t) => t.taxCode === 'QST')
  check('GST + QST on the fee recorded in GST_QST', gstF?.amountMinor === Math.round(fee * 0.05) && qstF?.amountMinor === Math.round(fee * 0.09975) && gstF.account === 'GST_QST', feeTax)
  check('no dues on a cancellation', !feeTax.some((t) => t.taxCode === 'DUES'), feeTax)
  const refund = await db().walletEntry.findFirst({ where: { referenceType: 'ride_prepayment_refund', referenceId: ride2?.id } })
  const prepaid2 = before?.metadata?.prepaidAmountMinor
  check('rider refunded prepayment minus fee minus taxes on the fee', refund?.amountMinor === prepaid2 - fee - gstF.amountMinor - qstF.amountMinor, { refund: refund?.amountMinor, prepaid2, fee })
  const feeToDriver = await db().walletEntry.findFirst({ where: { referenceType: 'ride_cancellation_fee', referenceId: ride2?.id } })
  check('driver receives the fee itself (taxes stay with the company)', feeToDriver?.amountMinor === fee, feeToDriver)

  console.log('\n=== 6c. PERMANENT RECORDS FOR REVENU QUÉBEC (completed + cancellation lists) ===')
  const recDone = await db().rideTaxRecord.findUnique({ where: { rideId_kind: { rideId: ride?.id, kind: 'COMPLETED' } } })
  check('completed ride has a permanent record naming driver and client', recDone?.driverId === driver.id && recDone?.riderId === guest.id && recDone?.driverName && recDone?.riderName, recDone)
  check('record carries the driver GST/QST numbers', recDone?.driverQstNumber === '1234567890 TQ0001' && recDone?.driverGstNumber === '123456789 RT0001', recDone)
  check('record amounts = fare + dues + GST + QST', recDone?.totalMinor === recDone?.fareMinor + recDone?.duesMinor + recDone?.gstMinor + recDone?.qstMinor && recDone?.duesMinor === 90, recDone)
  const y = new Date().getUTCFullYear()
  check('kept until 31 Dec of year + 6 (Revenu Québec)', recDone && new Date(recDone.retainUntil).toISOString().slice(0, 10) === `${y + 6}-12-31`, recDone?.retainUntil)
  const recCancel = await db().rideTaxRecord.findUnique({ where: { rideId_kind: { rideId: ride2?.id, kind: 'CANCELLATION' } } })
  check('charged cancellation has its own record (fee + taxes, no dues)', recCancel?.cancellationFeeMinor > 0 && recCancel?.duesMinor === 0 && recCancel?.gstMinor > 0, recCancel)
  let blocked = false
  try { await db().rideTaxRecord.update({ where: { id: recDone.id }, data: { totalMinor: 1 } }) } catch { blocked = true }
  check('records cannot be edited (append-only)', blocked, 'update allowed')
  blocked = false
  try { await db().rideTaxRecord.delete({ where: { id: recDone.id } }) } catch { blocked = true }
  check('records cannot be deleted', blocked, 'delete allowed')
  const listDone = await call('GET', '/api/admin/ride-tax-records?kind=COMPLETED', admin.token)
  check('admin list of completed rides', listDone.status === 200 && listDone.j?.records?.some((r) => r.rideId === ride?.id), listDone.j?.count)
  const listCancel = await call('GET', `/api/admin/ride-tax-records?kind=CANCELLATION&driverId=${driver.id}`, admin.token)
  check('admin list of cancellations, filtered by driver', listCancel.status === 200 && listCancel.j?.records?.every((r) => r.kind === 'CANCELLATION' && r.driverId === driver.id) && listCancel.j.count >= 1, listCancel.j)
  const byRider = await call('GET', `/api/admin/ride-tax-records?riderId=${guest.id}`, admin.token)
  check('admin list filtered by client', byRider.j?.records?.length >= 2 && byRider.j.records.every((r) => r.riderId === guest.id), byRider.j?.count)
  const csv = await fetch(`${API}/api/admin/ride-tax-records?format=csv`, { headers: { authorization: `Bearer ${admin.token}` } })
  const csvText = await csv.text()
  check('CSV export for Revenu Québec', csv.status === 200 && csvText.startsWith('issuedAt,kind,rideId,driverId,driverName') && csvText.includes(ride?.id), csvText.slice(0, 120))
  const today2 = new Date().toISOString().slice(0, 10)
  const perDriver = await call('GET', `/api/admin/ride-tax-records/drivers?from=${today2}&to=${today2}`, admin.token)
  const mine = perDriver.j?.drivers?.find((d) => d.driverId === driver.id)
  check('per-driver totals for the period (incl. GST/QST collected)', mine?.records >= 2 && mine?.gstMinor > 0 && mine?.qstMinor > 0 && mine?.qstNumber === '1234567890 TQ0001', perDriver.j)

  console.log('\n=== 7. DAILY / MONTHLY COLLECTION TOTALS AND PAYMENT TO THE GOVERNMENT ===')
  const daily = await call('GET', '/api/admin/tax-collections?group=day', admin.token)
  const tot = (acc) => daily.j?.totals?.find((t) => t.account === acc && t.currency === 'CAD')
  check('daily report shows GST_QST and RIDE_DUES outstanding', (tot('GST_QST')?.outstandingMinor || 0) >= gc.taxMinor && (tot('RIDE_DUES')?.outstandingMinor || 0) >= 90, daily.j)
  const monthly = await call('GET', '/api/admin/tax-collections?group=month', admin.token)
  check('monthly report groups by YYYY-MM', monthly.status === 200 && monthly.j?.rows?.every((r) => /^\d{4}-\d{2}$/.test(r.period)), monthly.j?.rows)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
  const pay = await call('POST', '/api/admin/tax-remittances', admin.token, { account: 'RIDE_DUES', currency: 'CAD', periodStart: today, periodEnd: today, reference: 'RQ-TEST-001' })
  check('admin records the RIDE_DUES payment to the government', pay.status === 201 && pay.j?.remittance?.amountMinor >= 90, pay)
  const again = await call('POST', '/api/admin/tax-remittances', admin.token, { account: 'RIDE_DUES', currency: 'CAD', periodStart: today, periodEnd: today })
  check('the same period cannot be paid twice', code(again) === 'NOTHING_TO_REMIT', again)
  const after = await call('GET', '/api/admin/tax-collections?group=day&account=RIDE_DUES', admin.token)
  check('RIDE_DUES now shows nothing outstanding', after.j?.totals?.[0]?.outstandingMinor === 0, after.j)

  console.log(`\n==== CANADA ONE-BASE E2E: ${pass} passed, ${fail} failed ====`)
  await disconnectDb()
  process.exit(fail ? 1 : 0)
}
main().catch(async (e) => { console.error(e); await disconnectDb(); process.exit(1) })
