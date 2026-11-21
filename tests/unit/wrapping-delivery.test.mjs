import test from 'node:test'
import assert from 'node:assert/strict'
import * as D from '../../wrapping/delivery/index.mjs'
import { capsuleProfileProblems } from '../../wrapping/profiles/validate.mjs'
import { profile as template } from '../../wrapping/profiles/template.profile.mjs'

const P = {
  ...template,
  key: 't', currencies: { allowed: ['CAD'], default: 'CAD' }, timezone: 'America/Toronto',
  taxes: { status: 'TEST', GST: { bp: 500, label: { en: 'GST' } }, QST: { bp: 9975, label: { en: 'QST' } } },
  delivery: {
    ...template.delivery,
    smallOrder: { thresholdMinor: 1000, maxMinor: 300 },
    deliveryFee: { baseMinor: 199, perKmMinor: 50, includedKm: 2, maxMinor: 799 },
    freeDeliveryOverMinor: 0,
    serviceFee: { bp: 1500, minMinor: 200, maxMinor: 500 },
    merchantCommissionBp: 2000, pickupCommissionBp: 1000,
    courierPay: { baseMinor: 300, perKmMinor: 60, minimumMinor: 400 },
    foodTaxes: ['GST', 'QST'], feeTaxes: ['GST', 'QST'],
    cancellation: { foodCostBp: 10000 },
  },
}

test('template + test profile validate with delivery', () => {
  assert.deepEqual(capsuleProfileProblems(P, { delivery: true }), [])
  assert.ok(capsuleProfileProblems({ ...P, delivery: undefined }, { delivery: true }).includes('missing delivery section'))
})

test('order machine and actors', () => {
  assert.ok(D.canAct({ from: 'PLACED', to: 'ACCEPTED', actor: 'merchant' }))
  assert.ok(!D.canAct({ from: 'PLACED', to: 'ACCEPTED', actor: 'customer' }))
  assert.ok(!D.canAct({ from: 'PLACED', to: 'DELIVERED', actor: 'merchant' }))
  assert.ok(D.canAct({ from: 'READY_FOR_PICKUP', to: 'DELIVERED', actor: 'merchant', fulfillment: 'pickup' }))
  assert.ok(!D.canAct({ from: 'READY_FOR_PICKUP', to: 'DELIVERED', actor: 'merchant', fulfillment: 'delivery' }))
  assert.ok(!D.canAct({ from: 'READY_FOR_PICKUP', to: 'PICKED_UP', actor: 'courier', fulfillment: 'pickup' }))
  assert.throws(() => D.orderMachine.assert('DELIVERED', 'CANCELLED'))
})

test('basket is priced from the server menu', () => {
  const menu = { a: { priceMinor: 1200 }, b: { priceMinor: 450, available: false } }
  const r = D.priceBasket({ items: [{ itemId: 'a', qty: 2, options: [{ priceMinor: 100 }] }], menu })
  assert.equal(r.subtotalMinor, 2600)
  assert.equal(D.priceBasket({ items: [{ itemId: 'b', qty: 1 }], menu }).code, 'ITEM_UNAVAILABLE')
  assert.equal(D.priceBasket({ items: [{ itemId: 'a', qty: 0 }], menu }).code, 'QTY_INVALID')
  assert.equal(D.priceBasket({ items: [], menu }).code, 'BASKET_EMPTY')
})

test('delivery quote adds up and splits correctly', () => {
  const q = D.quoteOrder({ subtotalMinor: 2600, distanceM: 4000, profile: P, tipMinor: 300 })
  const fee = q.lines.find((l) => l.code === 'DELIVERY_FEE').minor
  assert.equal(fee, 199 + 100)                       // 2 km beyond the included 2 km
  assert.equal(q.lines.find((l) => l.code === 'SERVICE_FEE').minor, 390)
  assert.ok(!q.lines.find((l) => l.code === 'SMALL_ORDER_FEE'))
  const linesSum = q.lines.reduce((s, l) => s + l.minor, 0)
  assert.equal(q.totalMinor, linesSum + q.taxMinor)
  assert.equal(q.merchant.commissionMinor, 520)
  assert.equal(q.merchant.payoutMinor, 2080)
  assert.equal(q.courier.payoutMinor, 300 + 240 + 300) // base + 4 km + tip
  assert.ok(q.taxes.every((t) => t.code !== 'TIP'))
})

test('small-order fee, caps, pickup and promo', () => {
  const small = D.quoteOrder({ subtotalMinor: 600, distanceM: 1000, profile: P })
  assert.equal(small.lines.find((l) => l.code === 'SMALL_ORDER_FEE').minor, 300)
  assert.equal(small.lines.find((l) => l.code === 'SERVICE_FEE').minor, 200) // floor
  const far = D.quoteOrder({ subtotalMinor: 9000, distanceM: 30000, profile: P })
  assert.equal(far.lines.find((l) => l.code === 'DELIVERY_FEE').minor, 799)  // cap
  assert.equal(far.lines.find((l) => l.code === 'SERVICE_FEE').minor, 500)   // cap
  const pick = D.quoteOrder({ subtotalMinor: 2000, fulfillment: 'pickup', profile: P })
  assert.ok(!pick.lines.find((l) => l.code === 'DELIVERY_FEE'))
  assert.equal(pick.courier, null)
  assert.equal(pick.merchant.commissionMinor, 200)
  const promo = D.quoteOrder({ subtotalMinor: 2000, distanceM: 1000, profile: P, promoMinor: 500 })
  assert.equal(promo.merchant.payoutMinor, 1600) // merchant paid on menu price
  assert.equal(promo.platform.promoCostMinor, 500)
})

test('minimum order refused when no small-order fee', () => {
  const p = { ...P, delivery: { ...P.delivery, smallOrder: null } }
  assert.equal(D.quoteOrder({ subtotalMinor: 500, merchant: { minOrderMinor: 1000 }, profile: p }).code, 'ORDER_BELOW_MINIMUM')
})

test('cancellation refunds follow the stage', () => {
  const q = D.quoteOrder({ subtotalMinor: 2000, distanceM: 1000, profile: P })
  assert.equal(D.refundOnCancel({ status: 'PLACED', by: 'customer', quote: q, profile: P }).refundMinor, q.totalMinor)
  assert.equal(D.refundOnCancel({ status: 'PREPARING', by: 'customer', quote: q, profile: P }).keepMinor, 2000)
  assert.equal(D.refundOnCancel({ status: 'PICKED_UP', by: 'customer', quote: q, profile: P }).refundMinor, 0)
  assert.equal(D.refundOnCancel({ status: 'PREPARING', by: 'merchant', quote: q, profile: P }).refundMinor, q.totalMinor)
})

test('radius, hours, ETA, courier ranking, categories', () => {
  const m = { at: { lat: 45.5, lng: -73.57 }, radiusM: 3000 }
  assert.ok(D.checkDeliverable({ merchant: m, dropoff: { lat: 45.51, lng: -73.57 }, profile: P }).ok)
  assert.equal(D.checkDeliverable({ merchant: m, dropoff: { lat: 45.6, lng: -73.57 }, profile: P }).code, 'TOO_FAR')
  const hours = { days: [5], open: '18:00', close: '02:00' }
  const fri23 = new Date('2026-11-20T23:00:00-05:00')
  const sat01 = new Date('2026-11-21T01:00:00-05:00')
  const sat03 = new Date('2026-11-21T03:00:00-05:00')
  assert.ok(D.isOpen({ hours, timezone: 'America/Toronto', now: fri23 }))
  assert.ok(D.isOpen({ hours, timezone: 'America/Toronto', now: sat01 }))
  assert.ok(!D.isOpen({ hours, timezone: 'America/Toronto', now: sat03 }))
  assert.ok(!D.isOpen({ hours: null, busy: true, timezone: 'UTC' }))
  assert.deepEqual(D.etaMinutes({ prepMinutes: 15, distanceM: 3000, profile: P }), { lowMin: 30, highMin: 40 })
  const r = D.rankCouriers({ merchantAt: m.at, profile: P, couriers: [
    { id: 1, online: true, vehicle: 'car', at: { lat: 45.52, lng: -73.57 } },
    { id: 2, online: true, vehicle: 'bike', at: { lat: 45.501, lng: -73.57 } },
    { id: 3, online: true, busy: true, vehicle: 'bike', at: { lat: 45.5, lng: -73.57 } },
    { id: 4, online: true, vehicle: 'scooter', at: { lat: 45.5, lng: -73.57 } },
  ] })
  assert.deepEqual(r.map((x) => x.id), [2, 1])
  assert.ok(!D.categoryAllowed({ category: 'alcohol', profile: P }))
  assert.ok(D.categoryAllowed({ category: 'restaurant', profile: P }))
})
