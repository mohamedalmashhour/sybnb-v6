// DELIVERY CAPSULE — food & grocery delivery (Uber Eats model), country-neutral.
// Built from SYBNB SE (Eats) — server/routes/food.mjs, migrations 066/068/072 — and aligned with
// Uber Eats / DoorDash: subtotal, small-order fee, distance-based delivery fee, service fee with a
// floor and a cap, taxes, tip (100 % to the courier), merchant commission, courier pay.
// Pure functions only: no database, no HTTP, no provider. Every amount, rate and rule comes from the
// country profile (`profile.delivery`) — payments and prices are variables (owner decision 2026-11-20).
import { pct, taxLines, sum, assertMinor } from '../core/money.mjs'
import { haversineM, isPoint, inBounds } from '../core/geo.mjs'
import { createMachine } from '../core/state-machine.mjs'

// Order life-cycle (same states as SYBNB SE so data migrates 1:1).
//   PAYMENT_PENDING → PLACED → ACCEPTED (merchant) → PREPARING → READY_FOR_PICKUP
//   → PICKED_UP (courier) → DELIVERED.  Pickup orders: READY_FOR_PICKUP → DELIVERED (merchant hands over).
export const orderMachine = createMachine('order', {
  PAYMENT_PENDING: ['PLACED', 'CANCELLED'],
  PLACED: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY_FOR_PICKUP', 'CANCELLED'],
  READY_FOR_PICKUP: ['PICKED_UP', 'DELIVERED', 'CANCELLED'],
  PICKED_UP: ['DELIVERED', 'UNDELIVERABLE'],
  DELIVERED: [],
  REJECTED: [],
  CANCELLED: [],
  UNDELIVERABLE: [],
})
export const ACTIVE = Object.freeze(['PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP'])

// Who may make each move (the server checks the actor; the machine checks the move).
export const ACTORS = Object.freeze({
  'PAYMENT_PENDING>PLACED': 'system',
  'PAYMENT_PENDING>CANCELLED': 'customer',
  'PLACED>ACCEPTED': 'merchant',
  'PLACED>REJECTED': 'merchant',
  'PLACED>CANCELLED': 'customer',
  'ACCEPTED>PREPARING': 'merchant',
  'ACCEPTED>CANCELLED': 'customer|merchant|admin',
  'PREPARING>READY_FOR_PICKUP': 'merchant',
  'PREPARING>CANCELLED': 'customer|merchant|admin',
  'READY_FOR_PICKUP>PICKED_UP': 'courier',
  'READY_FOR_PICKUP>DELIVERED': 'merchant', // pickup orders only
  'READY_FOR_PICKUP>CANCELLED': 'admin',
  'PICKED_UP>DELIVERED': 'courier',
  'PICKED_UP>UNDELIVERABLE': 'courier|admin',
})
export function canAct({ from, to, actor, fulfillment = 'delivery' }) {
  const who = ACTORS[`${from}>${to}`]
  if (!who || !orderMachine.can(from, to)) return false
  if (from === 'READY_FOR_PICKUP' && to === 'DELIVERED' && fulfillment !== 'pickup') return false
  if (from === 'READY_FOR_PICKUP' && to === 'PICKED_UP' && fulfillment === 'pickup') return false
  return who.split('|').includes(actor) || actor === 'admin'
}

// Opening hours: { days:[0..6], open:'HH:MM', close:'HH:MM' } in the country (or merchant) timezone.
// A window that ends before it starts runs past midnight and belongs to the previous day.
// null = always open. A merchant `busy` switch always wins.
export function isOpen({ hours, busy = false, timezone, now = new Date() }) {
  if (busy) return false
  if (!hours) return true
  const tz = hours.tz || timezone
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const get = (t) => parts.find((p) => p.type === t)?.value
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
  const m = Number(get('hour')) * 60 + Number(get('minute'))
  const toMin = (s) => { const [h, mm] = s.split(':').map(Number); return h * 60 + mm }
  const o = toMin(hours.open)
  const c = toMin(hours.close)
  if (o < c) return hours.days.includes(day) && m >= o && m < c
  return (hours.days.includes(day) && m >= o) || (hours.days.includes((day + 6) % 7) && m < c)
}

// Can this merchant deliver to this address? Merchant radius, else the country default.
export function checkDeliverable({ merchant, dropoff, profile }) {
  const d = profile.delivery
  if (!isPoint(merchant?.at)) return { ok: false, code: 'MERCHANT_LOCATION_MISSING' }
  if (!isPoint(dropoff)) return { ok: false, code: 'ADDRESS_INVALID' }
  if (!inBounds(dropoff, d.serviceBounds)) return { ok: false, code: 'OUT_OF_SERVICE_AREA' }
  const distanceM = Math.round(haversineM(merchant.at, dropoff) * (d.roadFactor ?? 1.3))
  const radius = merchant.radiusM ?? d.maxRadiusM ?? 8_000
  if (distanceM > radius) return { ok: false, code: 'TOO_FAR', distanceM, radiusM: radius }
  return { ok: true, distanceM }
}

// Basket check: positive whole quantities, prices from the SERVER menu (never trust the client).
// items: [{ itemId, qty, options?:[{ priceMinor }] }]   menu: { [itemId]: { priceMinor, available } }
export function priceBasket({ items, menu, maxItems = 50 }) {
  if (!Array.isArray(items) || !items.length) return { ok: false, code: 'BASKET_EMPTY' }
  let count = 0
  const lines = []
  for (const it of items) {
    const m = menu[it.itemId]
    if (!m) return { ok: false, code: 'ITEM_UNKNOWN', itemId: it.itemId }
    if (m.available === false) return { ok: false, code: 'ITEM_UNAVAILABLE', itemId: it.itemId }
    const qty = Number(it.qty)
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) return { ok: false, code: 'QTY_INVALID', itemId: it.itemId }
    count += qty
    const opt = (it.options ?? []).reduce((s, o) => s + assertMinor(o.priceMinor ?? 0, 'option.priceMinor'), 0)
    const unit = assertMinor(m.priceMinor, 'priceMinor') + opt
    lines.push({ itemId: it.itemId, qty, unitMinor: unit, minor: unit * qty })
  }
  if (count > maxItems) return { ok: false, code: 'BASKET_TOO_LARGE' }
  return { ok: true, lines, subtotalMinor: sum(lines), itemCount: count }
}

// Server-authoritative order quote (the checkout screen).
//   fulfillment 'pickup' → no delivery fee, no small-order fee, no courier.
//   promoMinor: platform-funded discount on the subtotal (never below zero).
//   tipMinor:   goes 100 % to the courier, never taxed, never commissioned.
export function quoteOrder({ subtotalMinor, distanceM = 0, fulfillment = 'delivery', merchant = {}, profile, tipMinor = 0, promoMinor = 0, busyBp = 10_000 }) {
  const d = profile.delivery
  const { taxes = {}, currencies } = profile
  assertMinor(subtotalMinor, 'subtotalMinor'); assertMinor(tipMinor, 'tipMinor'); assertMinor(promoMinor, 'promoMinor')
  const minOrder = merchant.minOrderMinor ?? d.minOrderMinor ?? 0
  if (subtotalMinor < minOrder && !d.smallOrder) return { ok: false, code: 'ORDER_BELOW_MINIMUM', minOrderMinor: minOrder }
  const isDelivery = fulfillment !== 'pickup'
  const discount = Math.min(promoMinor, subtotalMinor)
  const goods = subtotalMinor - discount

  // Delivery fee: base + per km beyond the included distance, busy-time multiplier, capped.
  let deliveryFee = 0
  if (isDelivery) {
    const f = d.deliveryFee
    const extraKm = Math.max(0, distanceM / 1000 - (f.includedKm ?? 0))
    deliveryFee = pct(f.baseMinor + Math.round(extraKm * f.perKmMinor), Math.min(Math.max(busyBp, 10_000), d.maxBusyBp ?? 10_000))
    if (f.maxMinor) deliveryFee = Math.min(deliveryFee, f.maxMinor)
    if (d.freeDeliveryOverMinor && goods >= d.freeDeliveryOverMinor) deliveryFee = 0
  }
  // Small-order fee (Uber Eats style) tops up orders under the threshold instead of refusing them.
  const so = d.smallOrder
  const smallOrderFee = isDelivery && so && goods < so.thresholdMinor ? Math.min(so.thresholdMinor - goods, so.maxMinor ?? Infinity) : 0
  // Service fee: % of the goods with a floor and a cap.
  const s = d.serviceFee ?? { bp: 0 }
  let serviceFee = pct(goods, s.bp ?? 0)
  if (s.minMinor) serviceFee = Math.max(serviceFee, s.minMinor)
  if (s.maxMinor) serviceFee = Math.min(serviceFee, s.maxMinor)
  if (!goods) serviceFee = 0

  const goodsTax = taxLines(goods, d.foodTaxes ?? [], taxes)
  const feeTax = taxLines(deliveryFee + smallOrderFee + serviceFee, d.feeTaxes ?? [], taxes)
  const tax = [...goodsTax.map((t) => ({ ...t, on: 'GOODS' })), ...feeTax.map((t) => ({ ...t, on: 'FEES' }))]
  const taxMinor = sum(tax)
  const total = goods + deliveryFee + smallOrderFee + serviceFee + taxMinor + tipMinor

  const commissionBp = merchant.commissionBp ?? (isDelivery ? d.merchantCommissionBp : d.pickupCommissionBp ?? d.merchantCommissionBp)
  const commission = pct(subtotalMinor, commissionBp ?? 0) // on the menu price: promos are platform-funded
  const courier = isDelivery ? courierPay({ distanceM, tipMinor, profile }) : null
  return {
    ok: true,
    currency: currencies.default,
    fulfillment: isDelivery ? 'delivery' : 'pickup',
    distanceM: isDelivery ? Math.round(distanceM) : 0,
    lines: [
      { code: 'SUBTOTAL', minor: subtotalMinor },
      ...(discount ? [{ code: 'PROMO', minor: -discount }] : []),
      ...(isDelivery ? [{ code: 'DELIVERY_FEE', minor: deliveryFee }] : []),
      ...(smallOrderFee ? [{ code: 'SMALL_ORDER_FEE', minor: smallOrderFee }] : []),
      ...(serviceFee ? [{ code: 'SERVICE_FEE', minor: serviceFee }] : []),
      ...(tipMinor ? [{ code: 'TIP', minor: tipMinor }] : []),
    ],
    taxes: tax,
    taxStatus: taxes.status ?? 'NONE',
    taxMinor,
    totalMinor: total,
    merchant: { grossMinor: subtotalMinor, commissionBp: commissionBp ?? 0, commissionMinor: commission, payoutMinor: subtotalMinor - commission, goodsTaxMinor: sum(goodsTax) },
    courier,
    platform: { feesMinor: deliveryFee + smallOrderFee + serviceFee, commissionMinor: commission, promoCostMinor: discount, courierCostMinor: courier ? courier.payoutMinor - tipMinor : 0 },
  }
}

// Courier pay (DoorDash/Uber Eats style): base + per km, floor per trip; tip added in full.
export function courierPay({ distanceM, tipMinor = 0, profile }) {
  const c = profile.delivery.courierPay
  const base = c.baseMinor + Math.round((distanceM / 1000) * c.perKmMinor)
  const earned = Math.max(base, c.minimumMinor ?? 0)
  return { earnedMinor: earned, tipMinor, payoutMinor: earned + tipMinor }
}

// Customer cancellation refund (Uber Eats aligned):
//   before the merchant accepts → full refund;
//   accepted / preparing → refund minus the food cost already committed (cancelFoodBp of subtotal);
//   ready or picked up → no refund (the courier is paid);
//   merchant rejects / merchant cancels / undeliverable by platform fault → full refund.
export function refundOnCancel({ status, by, quote, profile }) {
  const c = profile.delivery.cancellation ?? {}
  const total = quote.totalMinor
  if (by !== 'customer') return { refundMinor: total, keepMinor: 0, reason: 'NOT_CUSTOMER_FAULT' }
  if (status === 'PAYMENT_PENDING' || status === 'PLACED') return { refundMinor: total, keepMinor: 0, reason: 'BEFORE_ACCEPT' }
  if (status === 'ACCEPTED' || status === 'PREPARING') {
    const subtotal = quote.lines.find((l) => l.code === 'SUBTOTAL')?.minor ?? 0
    const keep = Math.min(total, pct(subtotal, c.foodCostBp ?? 10_000))
    return { refundMinor: total - keep, keepMinor: keep, reason: 'FOOD_IN_PREPARATION' }
  }
  return { refundMinor: 0, keepMinor: total, reason: 'TOO_LATE' }
}

// ETA shown to the customer: merchant prep time + courier travel, rounded up to 5 minutes.
export function etaMinutes({ prepMinutes, distanceM, profile }) {
  const d = profile.delivery
  const travel = (distanceM / 1000 / (d.courierKmh ?? 20)) * 60
  const raw = (prepMinutes ?? d.defaultPrepMinutes ?? 20) + travel + (d.handoffMinutes ?? 5)
  const low = Math.ceil(raw / 5) * 5
  return { lowMin: low, highMin: low + 10 }
}

// Courier offer list: online, idle, approved vehicle type allowed for this order, within radius of
// the merchant; nearest first, rating as tie-breaker. Shared driver pool with rides (one account).
export function rankCouriers({ merchantAt, couriers, profile, vehicleTypes }) {
  const d = profile.delivery
  const allowed = vehicleTypes ?? d.vehicleTypes ?? ['bike', 'moto', 'car']
  return couriers
    .filter((x) => x.online && !x.busy && x.approved !== false && allowed.includes(x.vehicle) && isPoint(x.at))
    .map((x) => ({ ...x, distanceM: Math.round(haversineM(x.at, merchantAt)) }))
    .filter((x) => x.distanceM <= (d.courierSearchRadiusM ?? 5_000))
    .sort((a, b) => a.distanceM - b.distanceM || (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, d.maxOffers ?? 10)
}

// Restricted products (alcohol, cannabis, tobacco, pharmacy) — the country decides; a merchant
// category the country does not allow cannot be listed.
export function categoryAllowed({ category, profile }) {
  const blocked = profile.delivery.blockedCategories ?? []
  return !blocked.includes(category)
}
