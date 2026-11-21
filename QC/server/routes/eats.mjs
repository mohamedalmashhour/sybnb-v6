// Q EAT — food delivery (Uber Eats model). Merchants, menus, customer orders, merchant kitchen flow,
// courier claim → pickup → delivery. Every price, fee, refund and state rule comes from the
// country-neutral wrapping/delivery capsule configured by countries/canada (prices are variables).
// Payments: simulated in review (no real money); with Stripe on, ordering is refused until card
// checkout for food is wired (fail closed, AGENTS.md §5).
import { db, audit } from '../lib/db.mjs'
import { HttpError, badRequest, conflict, forbidden, int, notFound, num, oneOf, str } from '../lib/http.mjs'
import { requireRole, requireUser } from '../lib/auth.mjs'
import { paymentsMode } from '../lib/payments.mjs'
import * as D from '../../../wrapping/delivery/index.mjs'
import { toCapsuleProfile } from '../../../countries/canada/capsules.profile.mjs'

const CATEGORIES = ['restaurant', 'cafe', 'bakery', 'grocery', 'dessert', 'fastfood']
const COURIER_STATES = ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP']
const STAMP = { ACCEPTED: 'acceptedAt', READY_FOR_PICKUP: 'readyAt', PICKED_UP: 'pickedUpAt', DELIVERED: 'deliveredAt', CANCELLED: 'cancelledAt', REJECTED: 'cancelledAt', UNDELIVERABLE: 'cancelledAt' }
const RATE_WINDOW_MS = 7 * 86_400_000

const toCents = (q) => ({
  currency: q.currency,
  fulfillment: q.fulfillment,
  lines: q.lines.map((l) => ({ code: l.code, cents: l.minor })),
  taxes: q.taxes.map((t) => ({ code: t.code, label: t.label, rateBp: t.rateBp, on: t.on, cents: t.minor })),
  taxStatus: q.taxStatus,
  taxCents: q.taxMinor,
  totalCents: q.totalMinor,
  merchant: { commissionBp: q.merchant.commissionBp, commissionCents: q.merchant.commissionMinor, payoutCents: q.merchant.payoutMinor },
  courier: q.courier ? { earnedCents: q.courier.earnedMinor, tipCents: q.courier.tipMinor, payoutCents: q.courier.payoutMinor } : null,
})

function hoursFrom(raw) {
  if (raw == null || raw === '') return null
  if (typeof raw !== 'object' || !Array.isArray(raw.days)) throw badRequest('HOURS_INVALID', 'Opening hours are not valid.')
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/
  const days = [...new Set(raw.days.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort()
  if (!days.length || !hhmm.test(raw.open) || !hhmm.test(raw.close) || raw.open === raw.close) throw badRequest('HOURS_INVALID', 'Choose open days and times like 11:00 – 22:00.')
  return { days, open: raw.open, close: raw.close }
}

export function eatsRoutes(router, { profile }) {
  const cp = toCapsuleProfile(profile)
  const bounds = profile.rides.serviceBounds

  const point = (v, field) => {
    if (!v || typeof v !== 'object') throw badRequest('FIELD_REQUIRED', `${field} is required.`, { field })
    const p = { lat: num(v.lat, `${field}.lat`, { min: -90, max: 90 }), lng: num(v.lng, `${field}.lng`, { min: -180, max: 180 }) }
    if (bounds && (p.lat < bounds.minLat || p.lat > bounds.maxLat || p.lng < bounds.minLng || p.lng > bounds.maxLng)) throw badRequest('OUTSIDE_SERVICE_AREA', `${field} is outside the Québec service area.`, { field })
    return { ...p, label: str(v.label, `${field}.label`, { max: 200, optional: true }) }
  }

  const merchantCard = (m, now = new Date()) => ({
    id: m.id, name: m.name, category: m.category, description: m.description, address: m.address, lat: m.lat, lng: m.lng,
    photo: m.photo, prepMinutes: m.prepMinutes, minOrderCents: m.minOrderCents, radiusM: m.radiusM, hours: m.hours, busy: m.busy,
    open: D.isOpen({ hours: m.hours, busy: m.busy, timezone: cp.timezone, now }), status: m.status,
  })

  async function ownMerchant(ctx, id) {
    const user = requireUser(ctx)
    const m = await db().merchant.findUnique({ where: { id } })
    if (!m) throw notFound('Restaurant not found.')
    if (m.ownerId !== user.id && !user.roles.includes('ADMIN')) throw forbidden('This is not your restaurant.')
    return { user, m }
  }

  function quoteFor({ merchant, items, menuRows, fulfillment, address, tipCents }) {
    const menu = Object.fromEntries(menuRows.map((r) => [r.id, { priceMinor: r.priceCents, available: r.available, name: r.name }]))
    const basket = D.priceBasket({ items, menu })
    if (!basket.ok) throw badRequest(basket.code, 'Check your basket.', { itemId: basket.itemId })
    let distanceM = 0
    if (fulfillment === 'delivery') {
      const reach = D.checkDeliverable({ merchant: { at: { lat: merchant.lat, lng: merchant.lng }, radiusM: merchant.radiusM }, dropoff: address, profile: cp })
      if (!reach.ok) throw badRequest(reach.code, reach.code === 'TOO_FAR' ? 'This restaurant does not deliver that far.' : 'This address cannot be delivered to.', reach)
      distanceM = reach.distanceM
    }
    const q = D.quoteOrder({ subtotalMinor: basket.subtotalMinor, distanceM, fulfillment, merchant: { minOrderMinor: merchant.minOrderCents }, profile: cp, tipMinor: tipCents })
    if (!q.ok) throw badRequest(q.code, 'This order is below the restaurant minimum.', { minOrderCents: q.minOrderMinor })
    const eta = D.etaMinutes({ prepMinutes: merchant.prepMinutes, distanceM, profile: cp })
    const lines = basket.lines.map((l) => ({ ...l, name: menu[l.itemId].name, unitCents: l.unitMinor, cents: l.minor }))
    return { q, eta, lines, distanceM }
  }

  const orderView = (o, viewer) => ({
    id: o.id, status: o.status, fulfillment: o.fulfillment, items: o.items, note: o.note, createdAt: o.createdAt,
    acceptedAt: o.acceptedAt, readyAt: o.readyAt, pickedUpAt: o.pickedUpAt, deliveredAt: o.deliveredAt, cancelledAt: o.cancelledAt,
    eta: o.etaLowMin ? { lowMin: o.etaLowMin, highMin: o.etaHighMin } : null,
    merchant: o.merchant ? { id: o.merchant.id, name: o.merchant.name, address: o.merchant.address, lat: o.merchant.lat, lng: o.merchant.lng, phone: viewer === 'customer' ? undefined : o.merchant.phone } : undefined,
    // The courier sees the drop-off and their own pay only — never the customer's total (Uber practice).
    // Policy: merchant sees only the address label; courier sees it only while the delivery is theirs and active.
    address: viewer === 'merchant' ? (o.address && D.ACTIVE.includes(o.status) ? { label: o.address.label } : null) : viewer === 'courier' ? (D.ACTIVE.includes(o.status) ? o.address : null) : o.address,
    courier: o.courier ? { name: o.courier.name, lat: o.courier.driver?.lat, lng: o.courier.driver?.lng, vehicle: o.courier.driver?.vehicle } : null,
    customer: viewer !== 'customer' && o.customer ? { name: o.customer.name } : undefined,
    ...(viewer === 'customer' ? { subtotalCents: o.subtotalCents, tipCents: o.tipCents, totalCents: o.totalCents, breakdown: { lines: o.breakdown.lines, taxes: o.breakdown.taxes, taxCents: o.breakdown.taxCents }, refundCents: o.refundCents, rating: o.rating } : {}),
    ...(viewer === 'merchant' ? { subtotalCents: o.subtotalCents, payout: o.breakdown.merchant } : {}),
    ...(viewer === 'courier' ? { pay: o.breakdown.courier } : {}),
    cancelledBy: o.cancelledBy,
  })
  const orderInclude = { merchant: true, customer: true, courier: { include: { driver: true } } }

  // ── Public browsing ──
  router.add('GET /api/eats/config', async () => ({
    ok: true, categories: CATEGORIES, currency: cp.currencies.default, taxStatus: cp.taxes.status, payments: paymentsMode(),
    fees: { deliveryFee: cp.delivery.deliveryFee, serviceFee: cp.delivery.serviceFee, smallOrder: cp.delivery.smallOrder },
  }))

  router.add('GET /api/eats/merchants', async ({ query }) => {
    const where = { status: 'APPROVED', ...(query.category && CATEGORIES.includes(query.category) ? { category: query.category } : {}) }
    const rows = await db().merchant.findMany({ where, orderBy: { createdAt: 'asc' }, take: 200 })
    let list = rows.map((m) => merchantCard(m))
    if (query.lat && query.lng) {
      const at = { lat: Number(query.lat), lng: Number(query.lng) }
      list = list.map((m) => ({ ...m, reach: D.checkDeliverable({ merchant: { at: { lat: m.lat, lng: m.lng }, radiusM: m.radiusM }, dropoff: at, profile: cp }) }))
        .map((m) => ({ ...m, distanceM: m.reach.distanceM ?? null, delivers: m.reach.ok, eta: m.reach.ok ? D.etaMinutes({ prepMinutes: m.prepMinutes, distanceM: m.reach.distanceM, profile: cp }) : null, reach: undefined }))
        .sort((a, b) => (b.open - a.open) || (b.delivers - a.delivers) || ((a.distanceM ?? 1e9) - (b.distanceM ?? 1e9)))
    }
    return { ok: true, merchants: list }
  })

  router.add('GET /api/eats/merchants/:id', async ({ params }) => {
    const m = await db().merchant.findUnique({ where: { id: params.id }, include: { items: { orderBy: [{ section: 'asc' }, { sort: 'asc' }, { name: 'asc' }] } } })
    if (!m || m.status !== 'APPROVED') throw notFound('Restaurant not found.')
    const rated = await db().foodOrder.aggregate({ where: { merchantId: m.id, rating: { not: null } }, _avg: { rating: true }, _count: { rating: true } })
    return { ok: true, merchant: { ...merchantCard(m), rating: rated._count.rating >= 3 ? { average: Math.round(rated._avg.rating * 10) / 10, count: rated._count.rating } : null }, items: m.items.map((i) => ({ id: i.id, section: i.section, name: i.name, description: i.description, priceCents: i.priceCents, allergens: i.allergens, available: i.available })) }
  })

  // ── Customer ──
  router.add('POST /api/eats/quote', async ({ ctx, body }) => {
    requireUser(ctx)
    const merchant = await db().merchant.findUnique({ where: { id: str(body.merchantId, 'merchantId', { max: 60 }) } })
    if (!merchant || merchant.status !== 'APPROVED') throw notFound('Restaurant not found.')
    const fulfillment = oneOf(body.fulfillment ?? 'delivery', 'fulfillment', ['delivery', 'pickup'])
    const address = fulfillment === 'delivery' ? point(body.address, 'address') : null
    const tipCents = int(body.tipCents ?? 0, 'tipCents', { max: 10_000 })
    const menuRows = await db().menuItem.findMany({ where: { merchantId: merchant.id } })
    const { q, eta, lines } = quoteFor({ merchant, items: body.items, menuRows, fulfillment, address, tipCents })
    return { ok: true, quote: { ...toCents(q), merchant: undefined, courier: undefined, items: lines, eta, open: D.isOpen({ hours: merchant.hours, busy: merchant.busy, timezone: cp.timezone }) } }
  })

  router.add('POST /api/eats/orders', async ({ ctx, body }) => {
    const user = requireUser(ctx)
    if (paymentsMode() === 'stripe') throw new HttpError(503, 'EATS_PAYMENTS_NOT_READY', 'Card payment for Q EAT is not available yet.')
    const merchant = await db().merchant.findUnique({ where: { id: str(body.merchantId, 'merchantId', { max: 60 }) } })
    if (!merchant || merchant.status !== 'APPROVED') throw notFound('Restaurant not found.')
    if (!D.isOpen({ hours: merchant.hours, busy: merchant.busy, timezone: cp.timezone })) throw conflict('MERCHANT_CLOSED', 'This restaurant is not taking orders right now.')
    const fulfillment = oneOf(body.fulfillment ?? 'delivery', 'fulfillment', ['delivery', 'pickup'])
    const address = fulfillment === 'delivery' ? point(body.address, 'address') : null
    const tipCents = int(body.tipCents ?? 0, 'tipCents', { max: 10_000 })
    const note = str(body.note, 'note', { max: 300, optional: true })
    const menuRows = await db().menuItem.findMany({ where: { merchantId: merchant.id } })
    const { q, eta, lines, distanceM } = quoteFor({ merchant, items: body.items, menuRows, fulfillment, address, tipCents })
    const order = await db().$transaction(async (tx) => {
      const o = await tx.foodOrder.create({
        data: {
          customerId: user.id, merchantId: merchant.id, status: 'PLACED', fulfillment, items: lines, address, note,
          subtotalCents: lines.reduce((s, l) => s + l.cents, 0), tipCents, totalCents: q.totalMinor, breakdown: { ...toCents(q), distanceM, payment: 'SIMULATED' },
          etaLowMin: eta.lowMin, etaHighMin: eta.highMin,
        },
        include: orderInclude,
      })
      await audit(tx, user.id, 'eats.order.placed', o.id, { merchantId: merchant.id, totalCents: q.totalMinor, payment: 'SIMULATED' })
      return o
    })
    return { status: 201, body: { ok: true, order: orderView(order, 'customer') } }
  })

  router.add('GET /api/eats/orders', async ({ ctx }) => {
    const user = requireUser(ctx)
    const rows = await db().foodOrder.findMany({ where: { customerId: user.id }, include: orderInclude, orderBy: { createdAt: 'desc' }, take: 50 })
    return { ok: true, orders: rows.map((o) => orderView(o, 'customer')) }
  })

  router.add('GET /api/eats/orders/:id', async ({ ctx, params }) => {
    const user = requireUser(ctx)
    const o = await db().foodOrder.findUnique({ where: { id: params.id }, include: orderInclude })
    if (!o) throw notFound('Order not found.')
    const viewer = o.customerId === user.id ? 'customer' : o.courierId === user.id ? 'courier' : o.merchant.ownerId === user.id ? 'merchant' : user.roles.includes('ADMIN') ? 'customer' : null
    if (!viewer) throw notFound('Order not found.')
    return { ok: true, order: orderView(o, viewer) }
  })

  router.add('POST /api/eats/orders/:id/cancel', async ({ ctx, params }) => {
    const user = requireUser(ctx)
    const o = await db().foodOrder.findUnique({ where: { id: params.id } })
    if (!o || o.customerId !== user.id) throw notFound('Order not found.')
    if (!D.canAct({ from: o.status, to: 'CANCELLED', actor: 'customer', fulfillment: o.fulfillment })) throw conflict('CANNOT_CANCEL', 'This order can no longer be cancelled. Contact support.')
    const quote = { totalMinor: o.totalCents, lines: o.breakdown.lines.map((l) => ({ code: l.code, minor: l.cents })) }
    const r = D.refundOnCancel({ status: o.status, by: 'customer', quote, profile: cp })
    const done = await db().foodOrder.updateMany({ where: { id: o.id, status: o.status }, data: { status: 'CANCELLED', cancelledBy: 'customer', cancelledAt: new Date(), refundCents: r.refundMinor } })
    if (done.count !== 1) throw conflict('ORDER_CHANGED', 'The order just changed. Refresh and try again.')
    await audit(db(), user.id, 'eats.order.cancelled', o.id, { by: 'customer', from: o.status, refundCents: r.refundMinor, reason: r.reason })
    return { ok: true, refundCents: r.refundMinor, reason: r.reason }
  })

  router.add('POST /api/eats/orders/:id/rate', async ({ ctx, params, body }) => {
    const user = requireUser(ctx)
    const stars = int(body.stars, 'stars', { min: 1, max: 5 })
    const comment = str(body.comment, 'comment', { max: 500, optional: true })
    const done = await db().foodOrder.updateMany({ where: { id: params.id, customerId: user.id, status: 'DELIVERED', rating: null, deliveredAt: { gte: new Date(Date.now() - RATE_WINDOW_MS) } }, data: { rating: stars, ratingComment: comment } })
    if (done.count !== 1) throw conflict('CANNOT_RATE', 'You can rate a delivered order once, within 7 days.')
    return { ok: true }
  })

  // ── Merchant ──
  router.add('POST /api/eats/merchants', async ({ ctx, body }) => {
    const user = requireUser(ctx)
    const category = oneOf(body.category, 'category', CATEGORIES)
    if (!D.categoryAllowed({ category, profile: cp })) throw badRequest('CATEGORY_NOT_ALLOWED', 'This category is not offered.')
    const at = point({ lat: body.lat, lng: body.lng }, 'location')
    const pending = await db().merchant.count({ where: { ownerId: user.id, status: 'PENDING_REVIEW' } })
    if (pending >= 3) throw conflict('TOO_MANY_PENDING', 'You already have restaurants waiting for review.')
    const m = await db().merchant.create({
      data: {
        ownerId: user.id, name: str(body.name, 'name', { min: 2, max: 80 }), category, description: str(body.description, 'description', { max: 300, optional: true }),
        address: str(body.address, 'address', { max: 200 }), lat: at.lat, lng: at.lng, phone: str(body.phone, 'phone', { max: 30, optional: true }),
        prepMinutes: int(body.prepMinutes ?? 20, 'prepMinutes', { min: 5, max: 90 }), radiusM: int(body.radiusM ?? 6000, 'radiusM', { min: 500, max: cp.delivery.maxRadiusM }),
        minOrderCents: int(body.minOrderCents, 'minOrderCents', { max: 100_000, optional: true }), hours: hoursFrom(body.hours),
        permitNumber: str(body.permitNumber, 'permitNumber', { max: 40 }), neq: str(body.neq, 'neq', { min: 10, max: 10 }),
        gstNumber: str(body.gstNumber, 'gstNumber', { max: 30, optional: true }), qstNumber: str(body.qstNumber, 'qstNumber', { max: 30, optional: true }),
      },
    })
    await audit(db(), user.id, 'eats.merchant.applied', m.id, { name: m.name })
    return { status: 201, body: { ok: true, merchant: merchantCard(m) } }
  })

  router.add('GET /api/eats/my/merchants', async ({ ctx }) => {
    const user = requireUser(ctx)
    const rows = await db().merchant.findMany({ where: { ownerId: user.id }, orderBy: { createdAt: 'asc' } })
    return { ok: true, merchants: rows.map((m) => ({ ...merchantCard(m), reviewNote: m.reviewNote, permitNumber: m.permitNumber, neq: m.neq, phone: m.phone })) }
  })

  router.add('PATCH /api/eats/merchants/:id', async ({ ctx, params, body }) => {
    const { user, m } = await ownMerchant(ctx, params.id)
    const data = {}
    if (body.busy !== undefined) data.busy = Boolean(body.busy)
    if (body.prepMinutes !== undefined) data.prepMinutes = int(body.prepMinutes, 'prepMinutes', { min: 5, max: 90 })
    if (body.hours !== undefined) data.hours = hoursFrom(body.hours)
    if (body.minOrderCents !== undefined) data.minOrderCents = int(body.minOrderCents, 'minOrderCents', { max: 100_000, optional: true })
    if (body.description !== undefined) data.description = str(body.description, 'description', { max: 300, optional: true })
    if (body.photo !== undefined) {
      const photo = body.photo === null ? null : String(body.photo)
      if (photo && (!/^data:image\/(jpeg|png|webp);base64,/.test(photo) || photo.length > 280_000)) throw badRequest('PHOTO_INVALID', 'Use a JPEG/PNG under 200 KB.')
      data.photo = photo
    }
    const updated = await db().merchant.update({ where: { id: m.id }, data })
    await audit(db(), user.id, 'eats.merchant.updated', m.id, { fields: Object.keys(data) })
    return { ok: true, merchant: merchantCard(updated) }
  })

  router.add('POST /api/eats/merchants/:id/items', async ({ ctx, params, body }) => {
    const { m } = await ownMerchant(ctx, params.id)
    const item = await db().menuItem.create({ data: { merchantId: m.id, section: str(body.section ?? 'Menu', 'section', { max: 40 }), name: str(body.name, 'name', { max: 80 }), description: str(body.description, 'description', { max: 300, optional: true }), priceCents: int(body.priceCents, 'priceCents', { min: 1, max: 100_000 }), allergens: str(body.allergens, 'allergens', { max: 200, optional: true }), sort: int(body.sort ?? 0, 'sort', { max: 999 }) } })
    return { status: 201, body: { ok: true, item } }
  })

  router.add('PATCH /api/eats/items/:id', async ({ ctx, params, body }) => {
    const item = await db().menuItem.findUnique({ where: { id: params.id } })
    if (!item) throw notFound('Item not found.')
    await ownMerchant(ctx, item.merchantId)
    const data = {}
    if (body.available !== undefined) data.available = Boolean(body.available)
    if (body.priceCents !== undefined) data.priceCents = int(body.priceCents, 'priceCents', { min: 1, max: 100_000 })
    if (body.name !== undefined) data.name = str(body.name, 'name', { max: 80 })
    if (body.description !== undefined) data.description = str(body.description, 'description', { max: 300, optional: true })
    if (body.allergens !== undefined) data.allergens = str(body.allergens, 'allergens', { max: 200, optional: true })
    return { ok: true, item: await db().menuItem.update({ where: { id: item.id }, data }) }
  })

  router.add('DELETE /api/eats/items/:id', async ({ ctx, params }) => {
    const item = await db().menuItem.findUnique({ where: { id: params.id } })
    if (!item) throw notFound('Item not found.')
    await ownMerchant(ctx, item.merchantId)
    await db().menuItem.delete({ where: { id: item.id } })
    return { ok: true }
  })

  router.add('GET /api/eats/merchants/:id/orders', async ({ ctx, params, query }) => {
    const { m } = await ownMerchant(ctx, params.id)
    const scope = query.scope === 'history' ? { notIn: D.ACTIVE } : { in: D.ACTIVE }
    const rows = await db().foodOrder.findMany({ where: { merchantId: m.id, status: scope }, include: orderInclude, orderBy: { createdAt: query.scope === 'history' ? 'desc' : 'asc' }, take: 100 })
    return { ok: true, orders: rows.map((o) => orderView(o, 'merchant')) }
  })

  // Merchant kitchen moves: accept, reject, preparing, ready, handed over (pickup), cancel.
  router.add('POST /api/eats/orders/:id/merchant', async ({ ctx, params, body }) => {
    const user = requireUser(ctx)
    const to = oneOf(body.status, 'status', ['ACCEPTED', 'REJECTED', 'PREPARING', 'READY_FOR_PICKUP', 'DELIVERED', 'CANCELLED'])
    const o = await db().foodOrder.findUnique({ where: { id: params.id }, include: { merchant: true } })
    if (!o || (o.merchant.ownerId !== user.id && !user.roles.includes('ADMIN'))) throw notFound('Order not found.')
    const actor = user.roles.includes('ADMIN') && o.merchant.ownerId !== user.id ? 'admin' : 'merchant'
    if (!D.canAct({ from: o.status, to, actor, fulfillment: o.fulfillment })) throw conflict('INVALID_TRANSITION', `Cannot move this order from ${o.status} to ${to}.`)
    const data = { status: to, ...(STAMP[to] ? { [STAMP[to]]: new Date() } : {}) }
    if (to === 'REJECTED' || to === 'CANCELLED') Object.assign(data, { cancelledBy: actor, refundCents: o.totalCents })
    if (to === 'ACCEPTED' && body.prepMinutes) {
      const prep = int(body.prepMinutes, 'prepMinutes', { min: 5, max: 90 })
      const eta = D.etaMinutes({ prepMinutes: prep, distanceM: o.breakdown.distanceM ?? 0, profile: cp })
      Object.assign(data, { etaLowMin: eta.lowMin, etaHighMin: eta.highMin })
    }
    const done = await db().foodOrder.updateMany({ where: { id: o.id, status: o.status }, data })
    if (done.count !== 1) throw conflict('ORDER_CHANGED', 'The order just changed. Refresh and try again.')
    await audit(db(), user.id, `eats.order.${to.toLowerCase()}`, o.id, { from: o.status, actor })
    return { ok: true, status: to }
  })

  // ── Courier (shared driver pool with Q RIDE: an approved DRIVER account) ──
  router.add('GET /api/eats/courier/offers', async ({ ctx }) => {
    const user = requireRole(ctx, 'DRIVER')
    const me = await db().driverProfile.findUnique({ where: { userId: user.id } })
    if (!me?.online || me.lat == null) return { ok: true, offers: [], hint: 'GO_ONLINE' }
    const rows = await db().foodOrder.findMany({ where: { courierId: null, fulfillment: 'delivery', status: { in: COURIER_STATES } }, include: orderInclude, orderBy: { createdAt: 'asc' }, take: 50 })
    const offers = rows.map((o) => ({ o, d: D.rankCouriers({ merchantAt: { lat: o.merchant.lat, lng: o.merchant.lng }, profile: cp, couriers: [{ id: user.id, online: true, vehicle: 'car', at: { lat: me.lat, lng: me.lng } }] })[0] }))
      .filter((x) => x.d).sort((a, b) => a.d.distanceM - b.d.distanceM).slice(0, cp.delivery.maxOffers)
    return { ok: true, offers: offers.map(({ o, d }) => ({ ...orderView(o, 'courier'), address: null, note: null, customer: undefined, toMerchantM: d.distanceM, tripM: o.breakdown.distanceM ?? null })) }
  })

  router.add('GET /api/eats/courier/active', async ({ ctx }) => {
    const user = requireRole(ctx, 'DRIVER')
    const rows = await db().foodOrder.findMany({ where: { courierId: user.id, status: { in: [...COURIER_STATES, 'PICKED_UP'] } }, include: orderInclude, orderBy: { createdAt: 'asc' } })
    const done = await db().foodOrder.findMany({ where: { courierId: user.id, status: 'DELIVERED', deliveredAt: { gte: new Date(Date.now() - 86_400_000) } }, select: { breakdown: true } })
    return { ok: true, orders: rows.map((o) => orderView(o, 'courier')), todayCents: done.reduce((s, o) => s + (o.breakdown.courier?.payoutCents ?? 0), 0) }
  })

  router.add('POST /api/eats/courier/orders/:id/claim', async ({ ctx, params }) => {
    const user = requireRole(ctx, 'DRIVER')
    const busy = await db().foodOrder.count({ where: { courierId: user.id, status: { in: [...COURIER_STATES, 'PICKED_UP'] } } })
    if (busy) throw conflict('COURIER_BUSY', 'Finish your current delivery first.')
    const done = await db().foodOrder.updateMany({ where: { id: params.id, courierId: null, fulfillment: 'delivery', status: { in: COURIER_STATES } }, data: { courierId: user.id } })
    if (done.count !== 1) throw conflict('OFFER_TAKEN', 'Another courier took this order.')
    await audit(db(), user.id, 'eats.order.claimed', params.id, {})
    return { ok: true }
  })

  router.add('POST /api/eats/courier/orders/:id/status', async ({ ctx, params, body }) => {
    const user = requireRole(ctx, 'DRIVER')
    const to = oneOf(body.status, 'status', ['PICKED_UP', 'DELIVERED', 'UNDELIVERABLE'])
    const o = await db().foodOrder.findUnique({ where: { id: params.id } })
    if (!o || o.courierId !== user.id) throw notFound('Order not found.')
    if (!D.canAct({ from: o.status, to, actor: 'courier', fulfillment: o.fulfillment })) throw conflict('INVALID_TRANSITION', to === 'PICKED_UP' ? 'The restaurant has not marked this order ready yet.' : `Cannot move this order from ${o.status} to ${to}.`)
    const data = { status: to, [STAMP[to]]: new Date(), ...(to === 'UNDELIVERABLE' ? { cancelledBy: 'courier' } : {}) }
    const done = await db().foodOrder.updateMany({ where: { id: o.id, status: o.status, courierId: user.id }, data })
    if (done.count !== 1) throw conflict('ORDER_CHANGED', 'The order just changed. Refresh and try again.')
    await audit(db(), user.id, `eats.order.${to.toLowerCase()}`, o.id, { from: o.status })
    return { ok: true, status: to }
  })

  // ── Admin review of restaurants ──
  router.add('GET /api/admin/eats/merchants', async ({ ctx, query }) => {
    requireRole(ctx, 'ADMIN')
    const status = oneOf(query.status ?? 'PENDING_REVIEW', 'status', ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'])
    const rows = await db().merchant.findMany({ where: { status }, include: { owner: true }, orderBy: { createdAt: 'asc' }, take: 200 })
    return { ok: true, merchants: rows.map((m) => ({ ...merchantCard(m), permitNumber: m.permitNumber, neq: m.neq, gstNumber: m.gstNumber, qstNumber: m.qstNumber, owner: { email: m.owner.email, name: m.owner.name } })) }
  })

  router.add('POST /api/admin/eats/merchants/:id/decision', async ({ ctx, params, body }) => {
    const admin = requireRole(ctx, 'ADMIN')
    const decision = oneOf(body.decision, 'decision', ['APPROVE', 'REJECT', 'SUSPEND'])
    const note = str(body.note, 'note', { max: 500, optional: decision === 'APPROVE' })
    const from = { APPROVE: ['PENDING_REVIEW', 'SUSPENDED'], REJECT: ['PENDING_REVIEW'], SUSPEND: ['APPROVED'] }[decision]
    const to = { APPROVE: 'APPROVED', REJECT: 'REJECTED', SUSPEND: 'SUSPENDED' }[decision]
    const m = await db().$transaction(async (tx) => {
      const done = await tx.merchant.updateMany({ where: { id: params.id, status: { in: from } }, data: { status: to, reviewNote: note } })
      if (done.count !== 1) throw conflict('INVALID_STATE', `Only ${from.join(' or ').toLowerCase()} restaurants can be ${to.toLowerCase()}.`)
      const row = await tx.merchant.findUnique({ where: { id: params.id }, include: { owner: true } })
      if (to === 'APPROVED' && !row.owner.roles.includes('MERCHANT')) await tx.user.update({ where: { id: row.ownerId }, data: { roles: [...row.owner.roles, 'MERCHANT'] } })
      await audit(tx, admin.id, `eats.merchant.${to.toLowerCase()}`, row.id, { note })
      return row
    })
    return { ok: true, merchant: { id: m.id, status: to } }
  })
}
