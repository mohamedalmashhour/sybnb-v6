import test from 'node:test'
import assert from 'node:assert/strict'
import { stays, rides, capsuleProfileProblems, createMachine } from '../../wrapping/index.mjs'
import { profile as template } from '../../wrapping/profiles/template.profile.mjs'

const P = {
  ...template,
  key: 'testland',
  currencies: { allowed: ['TST'], default: 'TST' },
  timezone: 'America/Toronto',
  map: { center: { lat: 45.5, lng: -73.57 }, zoom: 11 },
  taxes: { status: 'TEST', VAT: { bp: 1500, label: { en: 'VAT' } }, CITY: { bp: 500, label: { en: 'City tax' } } },
  stays: { ...template.stays, lodgingTaxes: ['CITY'], salesTaxes: ['VAT'], requireRegistrationNumber: true },
  rides: {
    ...template.rides,
    categories: { STANDARD: { baseMinor: 300, perKmMinor: 100, perMinMinor: 20, minimumMinor: 800, seats: 4 }, XL: { baseMinor: 500, perKmMinor: 150, perMinMinor: 30, minimumMinor: 1200, seats: 6 } },
    bookingFeeMinor: 200, perStopMinor: 150, taxes: ['VAT'], serviceBounds: { minLat: 45, maxLat: 46, minLng: -74, maxLng: -73 },
  },
}
const listing = { title: 'Loft', nightlyMinor: 10000, cleaningMinor: 5000, maxGuests: 4, weeklyDiscountBp: 1000, registrationNumber: 'R-1' }

test('profile validator: template-based test profile is complete, broken one is refused', () => {
  assert.deepEqual(capsuleProfileProblems(P), [])
  const bad = { ...P, stays: { ...P.stays, salesTaxes: ['NOPE'], defaultPolicy: 'x' }, rides: { ...P.rides, categories: {} } }
  assert.equal(capsuleProfileProblems(bad).length, 3)
})

test('state machine refuses jumps', () => {
  const m = createMachine('t', { A: ['B'], B: [] })
  assert.ok(m.can('A', 'B')); assert.ok(!m.can('B', 'A')); assert.throws(() => m.assert('A', 'C'), /cannot move/)
  assert.ok(stays.bookingMachine.can('HOLD', 'CONFIRMED')); assert.ok(!stays.bookingMachine.can('COMPLETED', 'CANCELLED'))
  assert.ok(rides.tripMachine.can('ARRIVED', 'NO_SHOW')); assert.ok(!rides.tripMachine.can('REQUESTED', 'IN_PROGRESS'))
})

test('stays: validation, availability with half-open ranges and expired holds', () => {
  const now = new Date('2026-12-01T12:00:00Z')
  assert.equal(stays.validateStay({ checkIn: '2026-12-10', checkOut: '2026-12-10', guests: 2, listing, profile: P, now }).code, 'DATE_ORDER')
  assert.equal(stays.validateStay({ checkIn: '2026-11-10', checkOut: '2026-11-12', guests: 2, listing, profile: P, now }).code, 'DATE_PAST')
  assert.equal(stays.validateStay({ checkIn: '2026-12-10', checkOut: '2026-12-12', guests: 9, listing, profile: P, now }).code, 'GUESTS')
  const v = stays.validateStay({ checkIn: '2026-12-10', checkOut: '2026-12-17', guests: 2, listing, profile: P, now })
  assert.equal(v.nights, 7)
  const d = (s) => new Date(s + 'T00:00:00Z')
  const bookings = [{ status: 'CONFIRMED', checkIn: d('2026-12-05'), checkOut: d('2026-12-10') }, { status: 'HOLD', holdExpiresAt: new Date('2026-12-01T11:00:00Z'), checkIn: d('2026-12-12'), checkOut: d('2026-12-14') }]
  assert.ok(stays.isAvailable({ checkIn: v.checkIn, checkOut: v.checkOut, bookings, now }), 'check-out day free + expired hold ignored')
  assert.ok(!stays.isAvailable({ checkIn: d('2026-12-09'), checkOut: d('2026-12-11'), bookings, now }))
})

test('stays: quote adds up with weekly discount, lodging + sales taxes, host payout', () => {
  const q = stays.quoteStay({ listing, nights: 7, profile: P })
  // 70000 - 10% = 63000 + 5000 cleaning = 68000; fee 12% = 8160; city 5% of 68000 = 3400; VAT 15% of 76160 = 11424
  assert.equal(q.subtotalMinor, 76160); assert.equal(q.taxMinor, 3400 + 11424); assert.equal(q.totalMinor, 90984)
  assert.equal(q.lines.reduce((s, l) => s + l.minor, 0) + q.taxMinor, q.totalMinor)
  assert.deepEqual(q.host, { grossMinor: 68000, commissionMinor: 2040, payoutMinor: 65960 })
  assert.equal(q.currency, 'TST')
})

test('stays: refund tiers, host cancel, payout timing, listing rules', () => {
  const booking = { status: 'CONFIRMED', checkIn: '2026-12-20T00:00:00Z', checkOut: '2026-12-25T00:00:00Z', totalMinor: 10000 }
  assert.equal(stays.guestRefund({ booking, policyName: 'moderate', profile: P, now: new Date('2026-12-10T00:00:00Z') }).refundMinor, 10000)
  assert.equal(stays.guestRefund({ booking, policyName: 'moderate', profile: P, now: new Date('2026-12-18T12:00:00Z') }).refundMinor, 5000)
  assert.equal(stays.guestRefund({ booking, policyName: 'moderate', profile: P, now: new Date('2026-12-19T23:00:00Z') }).refundMinor, 0)
  assert.equal(stays.hostCancelRefund(booking).refundMinor, 10000)
  assert.ok(!stays.isPayoutEligible({ ...booking, status: 'COMPLETED' }, P, new Date('2026-12-25T12:00:00Z')))
  assert.ok(stays.isPayoutEligible({ ...booking, status: 'COMPLETED' }, P, new Date('2026-12-26T01:00:00Z')))
  assert.deepEqual(stays.listingProblems({ ...listing, registrationNumber: '' }, P), ['REGISTRATION_NUMBER_REQUIRED'])
})

const A = { lat: 45.50, lng: -73.57 }, B = { lat: 45.55, lng: -73.60 }

test('rides: service area, quote adds up, minimum fare, surge cap, stops', () => {
  assert.equal(rides.validateTrip({ pickup: A, dropoff: { lat: 40, lng: -73.5 }, profile: P }).code, 'OUT_OF_SERVICE_AREA')
  assert.ok(rides.validateTrip({ pickup: A, dropoff: B, profile: P }).ok)
  const q = rides.quoteRide({ pickup: A, dropoff: B, category: 'STANDARD', profile: P })
  assert.equal(q.lines.reduce((s, l) => s + l.minor, 0) + q.taxMinor, q.totalMinor)
  assert.equal(q.driver.payoutMinor, q.driver.grossMinor - q.driver.commissionMinor)
  const short = rides.quoteRide({ pickup: A, dropoff: { lat: 45.501, lng: -73.57 }, category: 'STANDARD', profile: P })
  assert.ok(short.lines[0].minimumApplied); assert.equal(short.lines[0].minor, 800)
  const surged = rides.quoteRide({ pickup: A, dropoff: B, category: 'STANDARD', profile: P, surge: 99999 })
  assert.equal(surged.lines[0].surgeBp, 15000)
  const withStop = rides.quoteRide({ pickup: A, dropoff: B, stops: [{ lat: 45.52, lng: -73.58 }], category: 'STANDARD', profile: P })
  assert.equal(withStop.lines.find((l) => l.code === 'STOPS').minor, 150)
  assert.deepEqual(rides.quoteAll({ pickup: A, dropoff: B, profile: P }).map((x) => x.category), ['STANDARD', 'XL'])
  const routed = rides.quoteRide({ pickup: A, dropoff: B, category: 'STANDARD', profile: P, route: { distanceM: 10000, durationS: 900 } })
  assert.equal(routed.estimate, 'ROUTED'); assert.equal(routed.lines[0].minor, 300 + 1000 + 300)
})

test('rides: surge from demand, cancel fees, no-show, driver ranking', () => {
  assert.equal(rides.surgeBp({ openRequests: 3, onlineDrivers: 5, profile: P }), 10000)
  assert.equal(rides.surgeBp({ openRequests: 10, onlineDrivers: 5, profile: P }), 12500)
  assert.equal(rides.surgeBp({ openRequests: 10, onlineDrivers: 0, profile: P }), 15000)
  const now = new Date('2026-12-01T12:00:00Z')
  assert.equal(rides.riderCancelFee({ status: 'REQUESTED', fareMinor: 2000, profile: P, now }).feeMinor, 0)
  assert.equal(rides.riderCancelFee({ status: 'ACCEPTED', fareMinor: 2000, acceptedAt: new Date(now - 60_000), profile: P, now }).reason, 'GRACE')
  assert.equal(rides.riderCancelFee({ status: 'ACCEPTED', fareMinor: 2000, acceptedAt: new Date(now - 600_000), profile: P, now }).feeMinor, 300)
  assert.equal(rides.riderCancelFee({ status: 'ARRIVED', fareMinor: 2000, profile: P, now }).feeMinor, 2000)
  assert.equal(rides.riderCancelFee({ status: 'IN_PROGRESS', fareMinor: 2000, profile: P, now }).feeMinor, null)
  assert.ok(rides.canMarkNoShow({ arrivedAt: new Date(now - 6 * 60_000), driverAt: A, pickup: A, profile: P, now }).ok)
  assert.ok(!rides.canMarkNoShow({ arrivedAt: new Date(now - 60_000), driverAt: A, pickup: A, profile: P, now }).ok)
  const drivers = [
    { id: 'far', online: true, category: 'STANDARD', at: { lat: 45.9, lng: -73.57 } },
    { id: 'near', online: true, category: 'STANDARD', at: { lat: 45.505, lng: -73.57 }, rating: 4.9 },
    { id: 'busy', online: true, busy: true, category: 'STANDARD', at: A },
    { id: 'xl', online: true, category: 'XL', at: A },
    { id: 'mid', online: true, category: 'STANDARD', at: { lat: 45.52, lng: -73.57 } },
  ]
  const ranked = rides.rankDrivers({ pickup: A, category: 'STANDARD', drivers, profile: P })
  assert.deepEqual(ranked.map((d) => d.id), ['near', 'mid'])
  assert.ok(rides.pickupEtaS(ranked[0], P) > 0)
})

import { currency, map } from '../../wrapping/index.mjs'
test('currency: one ISO code drives decimals, formatting and conversion', () => {
  assert.equal(currency.minorDigits('SAR'), 2); assert.equal(currency.minorDigits('KWD'), 3); assert.equal(currency.minorDigits('JPY'), 0)
  assert.equal(currency.minorDigits('SYP', { currencies: { minorDigits: { SYP: 0 } } }), 0)
  assert.equal(currency.toMinor(12.5, 'AED'), 1250); assert.equal(currency.toMinor(1.234, 'KWD'), 1234)
  assert.match(currency.formatMoney(1250, 'USD', 'en-US'), /\$12\.50/)
  assert.equal(currency.convertMinor(1000, 'USD', 'SAR', { 'USD->SAR': 3.75 }), 3750)
  assert.throws(() => currency.convertMinor(1, 'USD', 'EUR', {}), /no exchange rate/)
  assert.throws(() => currency.minorDigits('ZZZZ'), /unknown currency/)
})
test('map: country centre by default, zooms to a known point', () => {
  assert.deepEqual(map.initialView(P).center, P.map.center)
  const v = map.initialView(P, null, { lat: 45.5, lng: -73.6 })
  assert.equal(v.center.lat, 45.5); assert.ok(v.zoom >= 14)
  assert.throws(() => map.mapSettings({ key: 'x' }), /map.center/)
})
