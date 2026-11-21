// Q EAT (Québec food delivery) — customer ordering + live tracking, restaurant dashboard,
// courier screen (shared Q RIDE driver account) and admin review. Rules live server-side in
// wrapping/delivery; this app only shows what the QC API returns.
import { createApi } from '../shared/api.mjs'
import { $, SHARED_CSS, accountBar, busy, cad, errorText, esc, fmtDateTime, i18n, installDialog, message, openDialog, closeDialog, requireSignIn, t } from '../shared/ui.mjs'

const api = createApi('qeat')
const state = { page: 'eat', health: null, cfg: null, address: null, merchantId: null, cart: { merchantId: null, items: {} }, orderId: null, fulfillment: 'delivery', tipBp: 1500, myMerchantId: null }
let poll = null
const ACTIVE = ['PAYMENT_PENDING', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP']

document.head.insertAdjacentHTML('beforeend', `<style>${SHARED_CSS}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:18px;margin-top:18px}
.rcard{background:#fff;border:1px solid var(--line);border-radius:18px;overflow:hidden;cursor:pointer;transition:transform .25s,box-shadow .25s;text-align:left;padding:0}
.rcard:hover{transform:translateY(-4px);box-shadow:0 16px 30px rgba(11,31,69,.14)}.rcard .ph{height:130px;background:linear-gradient(135deg,#0b1f45,#24407a);display:grid;place-items:center;color:#f0c75a;font-weight:900;font-size:40px}
.rcard .ph img{width:100%;height:100%;object-fit:cover}.rcard .bd{padding:12px 14px}.rcard.closed{opacity:.55}
.chips{display:flex;gap:8px;flex-wrap:wrap}.chipb{border:1px solid var(--line);background:#fff;border-radius:999px;padding:8px 14px;font-weight:600}.chipb.on{background:var(--ink);color:#fff;border-color:var(--ink)}
.menuSec h3{margin:22px 0 8px}.item{display:flex;justify-content:space-between;gap:12px;align-items:center;background:#fff;border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-bottom:10px}
.item.off{opacity:.5}.qty{display:flex;align-items:center;gap:8px}.qty button{width:32px;height:32px;border-radius:50%;border:1px solid var(--line);background:#fff;font-weight:800}
.cartBar{position:sticky;bottom:12px;margin-top:18px;background:var(--ink);color:#fff;border-radius:16px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 12px 30px rgba(11,31,69,.35)}
.cartBar button{background:var(--gold);color:var(--ink);border:0;border-radius:12px;padding:12px 18px;font-weight:800}
.steps{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin:18px 0}.steps div{height:8px;border-radius:8px;background:var(--line)}.steps div.on{background:var(--gold)}
.stepLabels{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;font-size:12px;color:var(--muted)}
.kan{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.kan section{background:#fff;border:1px solid var(--line);border-radius:16px;padding:14px;min-height:120px}
.ord{border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-top:10px;background:var(--paper)}.ord .row{flex-wrap:wrap}
.tips{display:flex;gap:8px;flex-wrap:wrap}.big{font-size:28px;font-weight:800}
@media(max-width:760px){.kan{grid-template-columns:1fr}.steps,.stepLabels{grid-template-columns:repeat(5,1fr)}}</style>`)

const PLACES = [
  ['Montréal – Plateau-Mont-Royal', 45.5236, -73.5817], ['Montréal – Mile End', 45.5229, -73.5985], ['Montréal – Centre-ville', 45.5017, -73.5673],
  ['Montréal – Vieux-Port', 45.5075, -73.5523], ['Laval – Centropolis', 45.5603, -73.7477], ['Québec – Vieux-Québec', 46.8123, -71.2055],
]
const parsePlace = (v) => {
  const s = String(v ?? '').trim()
  const k = PLACES.find(([n]) => n.toLowerCase() === s.toLowerCase())
  if (k) return { lat: k[1], lng: k[2], label: k[0] }
  const m = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(s)
  return m ? { lat: Number(m[1]), lng: Number(m[2]), label: s } : null
}
const CAT = { restaurant: ['Restaurants', 'Restaurants'], fastfood: ['Casse-croûte', 'Fast food'], bakery: ['Boulangeries', 'Bakeries'], cafe: ['Cafés', 'Cafés'], dessert: ['Desserts', 'Desserts'], grocery: ['Épicerie', 'Grocery'] }
const ST = {
  PAYMENT_PENDING: ['Paiement en attente', 'Payment pending'], PLACED: ['Envoyée au restaurant', 'Sent to restaurant'], ACCEPTED: ['Acceptée', 'Accepted'],
  PREPARING: ['En préparation', 'Preparing'], READY_FOR_PICKUP: ['Prête', 'Ready'], PICKED_UP: ['En route', 'On the way'], DELIVERED: ['Livrée', 'Delivered'],
  REJECTED: ['Refusée par le restaurant', 'Rejected by restaurant'], CANCELLED: ['Annulée', 'Cancelled'], UNDELIVERABLE: ['Non livrable', 'Undeliverable'],
}
const st = (s) => (ST[s] ? t(...ST[s]) : s)
const pill = (s) => `<span class="status status-${esc(s.toLowerCase())}">${esc(st(s))}</span>`
const LINE = { SUBTOTAL: ['Sous-total', 'Subtotal'], PROMO: ['Promotion', 'Promotion'], DELIVERY_FEE: ['Frais de livraison', 'Delivery fee'], SMALL_ORDER_FEE: ['Frais petite commande', 'Small order fee'], SERVICE_FEE: ['Frais de service', 'Service fee'], TIP: ['Pourboire (100 % au livreur)', 'Tip (100% to courier)'] }
const stopPoll = () => { if (poll) clearInterval(poll); poll = null }
const startPoll = (fn, ms) => { stopPoll(); poll = setInterval(() => fn().catch(() => {}), ms) }
const go = (page, extra = {}) => { Object.assign(state, { page }, extra); render() }
const cartCount = () => Object.values(state.cart.items).reduce((s, q) => s + q, 0)
const cartItems = () => Object.entries(state.cart.items).filter(([, q]) => q > 0).map(([itemId, qty]) => ({ itemId, qty }))
const saveCart = () => { try { localStorage.setItem('qeat.cart', JSON.stringify({ cart: state.cart, address: state.address })) } catch {} }
try { const s = JSON.parse(localStorage.getItem('qeat.cart') || 'null'); if (s) { state.cart = s.cart; state.address = s.address } } catch {}

function chrome() {
  document.documentElement.lang = i18n.lang
  $('language').textContent = i18n.lang === 'fr' ? 'EN' : 'FR'
  $('banner').textContent = state.health?.payments === 'simulated'
    ? t('ENVIRONNEMENT DE TEST · Paiements simulés · Restaurants de démonstration', 'TEST ENVIRONMENT · Simulated payments · Demo restaurants')
    : t('Paiement en ligne bientôt disponible', 'Online payment coming soon')
  $('foot1').textContent = t('Prix en dollars canadiens, TPS et TVQ incluses. Pourboire versé à 100 % au livreur.', 'Prices in Canadian dollars, GST and QST included. Tips go 100% to the courier.')
  $('foot2').textContent = '9375-7649 QUÉBEC INC.'
  const nav = [['eat', 'Commander', 'Order'], ['orders', 'Mes commandes', 'My orders'], ['resto', 'Restaurants', 'Restaurants'], ['courier', 'Livreurs', 'Couriers']]
  if (api.hasRole('ADMIN')) nav.push(['admin', 'Administration', 'Admin'])
  $('nav').innerHTML = nav.map(([k, fr, en]) => `<button data-page="${k}" class="${state.page === k ? 'active' : ''}">${t(fr, en)}</button>`).join('')
  document.querySelectorAll('[data-page]').forEach((b) => { b.onclick = () => go(b.dataset.page, { merchantId: null, orderId: null }) })
  $('accountSlot').replaceChildren(accountBar(api, () => render()))
}
window.addEventListener('qc:auth', chrome)

async function render() {
  stopPoll(); chrome()
  try {
    if (state.page === 'eat') await (state.orderId ? track() : state.merchantId ? restaurant() : browse())
    else if (state.page === 'checkout') await checkout()
    else if (state.page === 'orders') await (state.orderId ? track() : orders())
    else if (state.page === 'resto') await resto()
    else if (state.page === 'courier') await courier()
    else if (state.page === 'admin') await admin()
  } catch (err) { $('main').innerHTML = `<section class="card"><h2>${t('Erreur', 'Error')}</h2><p>${esc(errorText(err))}</p></section>` }
}

// ───────── Customer ─────────
async function browse() {
  const a = state.address
  const q = a ? `?lat=${a.lat}&lng=${a.lng}` : ''
  const cat = state.cat ?? ''
  const { merchants } = await api.get(`/api/eats/merchants${q}`)
  const list = merchants.filter((m) => !cat || m.category === cat)
  $('main').innerHTML = `<datalist id="places">${PLACES.map(([n]) => `<option value="${esc(n)}">`).join('')}</datalist>
    <section class="hero"><span class="eyebrow">Q EAT · ${t('QUÉBEC', 'QUÉBEC')}</span><h1>${t('Les restos d’ici,<br>livrés chez vous.', 'Local restaurants,<br>delivered to you.')}</h1>
    <form class="form" id="addrForm" style="max-width:560px"><label>${t('Adresse de livraison', 'Delivery address')}<input id="addr" list="places" value="${esc(a?.label ?? '')}" placeholder="${t('Quartier, ou « lat, lng »', 'Neighbourhood, or "lat, lng"')}"></label>
    <div class="row"><button class="secondary" type="button" id="myLoc">${t('Utiliser ma position', 'Use my location')}</button><button class="primary">${t('Voir les restos', 'See restaurants')}</button></div><p class="small" id="locStatus"></p></form></section>
    <div class="chips"><button class="chipb ${!cat ? 'on' : ''}" data-cat="">${t('Tout', 'All')}</button>${Object.entries(CAT).map(([k, v]) => `<button class="chipb ${cat === k ? 'on' : ''}" data-cat="${k}">${t(...v)}</button>`).join('')}</div>
    <div class="cards">${list.map((m) => `<button class="rcard ${m.open ? '' : 'closed'}" data-m="${m.id}"><div class="ph">${m.photo ? `<img src="${esc(m.photo)}" alt="">` : esc(m.name[0])}</div><div class="bd"><b>${esc(m.name)}</b>
      <div class="small">${esc(t(...(CAT[m.category] ?? [m.category, m.category])))}${m.eta ? ` · ${m.eta.lowMin}–${m.eta.highMin} min` : ''}${m.distanceM != null ? ` · ${(m.distanceM / 1000).toFixed(1)} km` : ''}</div>
      <div class="small">${!m.open ? t('Fermé pour le moment', 'Closed right now') : a && m.delivers === false ? t('Cueillette seulement à cette adresse', 'Pickup only for this address') : t('Ouvert', 'Open')}</div></div></button>`).join('') || `<p>${t('Aucun restaurant pour le moment.', 'No restaurants yet.')}</p>`}</div>
    ${cartCount() ? `<div class="cartBar"><span>${cartCount()} ${t('article(s) dans le panier', 'item(s) in cart')}</span><button id="toCart">${t('Voir le panier', 'View cart')}</button></div>` : ''}`
  $('addrForm').onsubmit = (e) => { e.preventDefault(); const p = parsePlace($('addr').value); if (!p) { $('locStatus').textContent = t('Choisissez un lieu de la liste ou « lat, lng ».', 'Pick a place from the list or "lat, lng".'); return } state.address = p; saveCart(); render() }
  $('myLoc').onclick = () => navigator.geolocation?.getCurrentPosition((p) => { state.address = { lat: p.coords.latitude, lng: p.coords.longitude, label: t('Ma position', 'My location') }; saveCart(); render() }, () => { $('locStatus').textContent = t('Position indisponible.', 'Location unavailable.') })
  document.querySelectorAll('[data-cat]').forEach((b) => { b.onclick = () => { state.cat = b.dataset.cat; render() } })
  document.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => go('eat', { merchantId: b.dataset.m }) })
  $('toCart')?.addEventListener('click', () => go('checkout'))
}

async function restaurant() {
  const { merchant: m, items } = await api.get(`/api/eats/merchants/${state.merchantId}`)
  const sections = [...new Set(items.map((i) => i.section))]
  const draw = () => {
    const same = state.cart.merchantId === m.id
    $('main').innerHTML = `<button class="secondary" id="back">← ${t('Restaurants', 'Restaurants')}</button>
      <section class="hero"><span class="eyebrow">${esc(t(...(CAT[m.category] ?? [m.category, m.category])))}</span><h1>${esc(m.name)}</h1>
      <p>${esc(m.description ?? '')}</p><p class="small">${esc(m.address)} · ${t('Préparation', 'Prep')} ~${m.prepMinutes} min${m.rating ? ` · ★ ${m.rating.average} (${m.rating.count})` : ''} · ${m.open ? t('Ouvert', 'Open') : t('Fermé', 'Closed')}</p></section>
      ${sections.map((s) => `<div class="menuSec"><h3>${esc(s)}</h3>${items.filter((i) => i.section === s).map((i) => { const q = same ? state.cart.items[i.id] ?? 0 : 0; return `<div class="item ${i.available ? '' : 'off'}"><div><b>${esc(i.name)}</b><div class="small">${[i.description ? esc(i.description) : '', i.allergens ? `${t('Allergènes', 'Allergens')} : ${esc(i.allergens)}` : ''].filter(Boolean).join(' · ')}</div><div>${cad(i.priceCents)}</div></div>
        ${i.available && m.open ? `<div class="qty"><button data-dec="${i.id}" aria-label="-">−</button><b>${q}</b><button data-inc="${i.id}" aria-label="+">+</button></div>` : `<span class="small">${t('Indisponible', 'Unavailable')}</span>`}</div>` }).join('')}</div>`).join('')}
      ${same && cartCount() ? `<div class="cartBar"><span>${cartCount()} ${t('article(s)', 'item(s)')}</span><button id="toCart">${t('Passer à la caisse', 'Checkout')}</button></div>` : ''}`
    $('back').onclick = () => go('eat', { merchantId: null })
    const bump = (id, d) => {
      if (state.cart.merchantId !== m.id) state.cart = { merchantId: m.id, items: {} }
      state.cart.items[id] = Math.max(0, (state.cart.items[id] ?? 0) + d); saveCart(); draw()
    }
    document.querySelectorAll('[data-inc]').forEach((b) => { b.onclick = () => bump(b.dataset.inc, 1) })
    document.querySelectorAll('[data-dec]').forEach((b) => { b.onclick = () => bump(b.dataset.dec, -1) })
    $('toCart')?.addEventListener('click', () => go('checkout'))
  }
  draw()
}

async function checkout() {
  if (!cartCount()) { go('eat'); return }
  const user = await requireSignIn(api, t('Connectez-vous pour commander. Un code arrive par courriel.', 'Sign in to order. A code arrives by email.'))
  if (!user) { go('eat'); return }
  const tipFor = (sub) => Math.round((sub * state.tipBp) / 10_000)
  const body = (tipCents) => ({ merchantId: state.cart.merchantId, items: cartItems(), fulfillment: state.fulfillment, address: state.fulfillment === 'delivery' ? state.address : undefined, tipCents })
  if (state.fulfillment === 'delivery' && !state.address) { message(t('Adresse requise', 'Address needed'), t('Entrez une adresse de livraison sur la page Commander.', 'Enter a delivery address on the Order page.')); go('eat'); return }
  let quote
  try {
    const first = await api.post('/api/eats/quote', body(0))
    const sub = first.quote.lines.find((l) => l.code === 'SUBTOTAL').cents
    quote = state.fulfillment === 'delivery' && state.tipBp ? (await api.post('/api/eats/quote', body(tipFor(sub)))).quote : first.quote
  } catch (err) {
    $('main').innerHTML = `<section class="card"><h2>${t('Panier', 'Cart')}</h2><p class="error">${esc(errorText(err))}</p><div class="row"><button class="secondary" id="pick">${t('Essayer la cueillette', 'Try pickup')}</button><button class="secondary" id="back">${t('Retour', 'Back')}</button></div></section>`
    $('pick').onclick = () => { state.fulfillment = 'pickup'; render() }
    $('back').onclick = () => go('eat', { merchantId: state.cart.merchantId })
    return
  }
  const tipCents = quote.lines.find((l) => l.code === 'TIP')?.cents ?? 0
  $('main').innerHTML = `<div class="grid"><section class="card"><h2>${t('Votre commande', 'Your order')}</h2>
    ${quote.items.map((i) => `<div class="fare"><span>${i.qty} × ${esc(i.name)}</span><span>${cad(i.cents)}</span></div>`).join('')}
    <div class="chips" style="margin-top:16px"><button class="chipb ${state.fulfillment === 'delivery' ? 'on' : ''}" data-f="delivery">${t('Livraison', 'Delivery')}</button><button class="chipb ${state.fulfillment === 'pickup' ? 'on' : ''}" data-f="pickup">${t('Cueillette (sans frais de livraison)', 'Pickup (no delivery fee)')}</button></div>
    ${state.fulfillment === 'delivery' ? `<p class="small">${t('Livrer à', 'Deliver to')} : <b>${esc(state.address.label)}</b></p><label>${t('Pourboire au livreur', 'Courier tip')}</label><div class="tips">${[0, 1000, 1500, 2000].map((bp) => `<button class="chipb ${state.tipBp === bp ? 'on' : ''}" data-tip="${bp}">${bp ? `${bp / 100} %` : t('Aucun', 'None')}</button>`).join('')}</div>` : ''}
    <label style="margin-top:14px">${t('Note pour le restaurant ou le livreur', 'Note for restaurant or courier')}<input id="note" maxlength="300" placeholder="${t('Ex. : sonnez deux fois', 'e.g. ring twice')}"></label>
    <p class="small">${t('Estimation', 'Estimate')} : ${quote.eta.lowMin}–${quote.eta.highMin} min</p></section>
    <section class="card"><h2>${t('Total', 'Total')}</h2>
    ${quote.lines.map((l) => `<div class="fare"><span>${esc(t(...(LINE[l.code] ?? [l.code, l.code])))}</span><span>${cad(l.cents)}</span></div>`).join('')}
    ${quote.taxes.map((x) => `<div class="fare small"><span>${esc(x.label?.[i18n.lang] ?? x.code)} (${x.on === 'GOODS' ? t('repas', 'food') : t('frais', 'fees')})</span><span>${cad(x.cents)}</span></div>`).join('')}
    <div class="fare"><b>${t('Total à payer', 'Total to pay')}</b><b class="price">${cad(quote.totalCents)}</b></div>
    <p class="error" id="err" role="alert"></p><button class="primary" id="place" style="width:100%">${t('Commander', 'Place order')} · ${cad(quote.totalCents)}</button>
    <p class="small">${t('Annulation gratuite tant que le restaurant n’a pas accepté.', 'Free cancellation until the restaurant accepts.')}</p></section></div>`
  document.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { state.fulfillment = b.dataset.f; render() } })
  document.querySelectorAll('[data-tip]').forEach((b) => { b.onclick = () => { state.tipBp = Number(b.dataset.tip); render() } })
  $('place').onclick = () => busy($('place'), $('err'), async () => {
    const { order } = await api.post('/api/eats/orders', { ...body(tipCents), note: $('note').value || undefined })
    state.cart = { merchantId: null, items: {} }; saveCart()
    go('eat', { orderId: order.id, merchantId: null })
  })
}

async function track() {
  const draw = async () => {
    const { order: o } = await api.get(`/api/eats/orders/${state.orderId}`)
    const flow = o.fulfillment === 'pickup' ? ['PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'DELIVERED'] : ['PLACED', 'ACCEPTED', 'PREPARING', 'PICKED_UP', 'DELIVERED']
    const idx = Math.max(flow.indexOf(o.status), o.status === 'READY_FOR_PICKUP' ? 2 : -1)
    const live = ACTIVE.includes(o.status)
    $('main').innerHTML = `<div class="grid"><section class="card"><span class="eyebrow">${esc(o.merchant.name)}</span><h1>${esc(st(o.status))}</h1>
      ${live && o.eta ? `<p>${t('Arrivée estimée', 'Estimated arrival')} : <b>${o.eta.lowMin}–${o.eta.highMin} min</b> ${t('après la commande', 'after ordering')}</p>` : ''}
      <div class="steps">${flow.map((_, i) => `<div class="${i <= idx ? 'on' : ''}"></div>`).join('')}</div><div class="stepLabels">${flow.map((s) => `<span>${esc(st(s))}</span>`).join('')}</div>
      ${o.courier ? `<p style="margin-top:16px">${t('Livreur', 'Courier')} : <b>${esc(o.courier.name ?? '')}</b>${o.courier.lat ? ` · <a target="_blank" rel="noreferrer" href="https://www.google.com/maps/dir/?api=1&destination=${o.courier.lat},${o.courier.lng}">${t('voir sur la carte', 'see on map')}</a>` : ''}</p>` : ''}
      ${o.fulfillment === 'pickup' && o.status === 'READY_FOR_PICKUP' ? `<p><b>${t('Votre commande est prête à récupérer', 'Your order is ready for pickup')}</b> · ${esc(o.merchant.address)}</p>` : ''}
      ${o.refundCents != null ? `<p>${t('Remboursement', 'Refund')} : <b>${cad(o.refundCents)}</b></p>` : ''}
      <p class="error" id="err" role="alert"></p>
      <div class="row">${['PLACED', 'ACCEPTED', 'PREPARING', 'PAYMENT_PENDING'].includes(o.status) ? `<button class="secondary" id="cancel">${t('Annuler la commande', 'Cancel order')}</button>` : ''}
      ${o.status === 'DELIVERED' && !o.rating ? `<button class="primary" id="rate">${t('Noter la commande', 'Rate order')}</button>` : ''}</div></section>
      <section class="card"><h2>${t('Reçu', 'Receipt')}</h2>${o.items.map((i) => `<div class="fare"><span>${i.qty} × ${esc(i.name)}</span><span>${cad(i.cents)}</span></div>`).join('')}
      ${o.breakdown.lines.filter((l) => l.code !== 'SUBTOTAL').map((l) => `<div class="fare small"><span>${esc(t(...(LINE[l.code] ?? [l.code, l.code])))}</span><span>${cad(l.cents)}</span></div>`).join('')}
      <div class="fare small"><span>${t('Taxes (TPS/TVQ)', 'Taxes (GST/QST)')}</span><span>${cad(o.breakdown.taxCents)}</span></div><div class="fare"><b>Total</b><b>${cad(o.totalCents)}</b></div>
      <p class="small">${fmtDateTime(o.createdAt)}</p></section></div>`
    $('cancel')?.addEventListener('click', () => busy($('cancel'), $('err'), async () => {
      const r = await api.post(`/api/eats/orders/${o.id}/cancel`)
      message(t('Commande annulée', 'Order cancelled'), `${t('Remboursement', 'Refund')} : ${cad(r.refundCents)}${r.reason === 'FOOD_IN_PREPARATION' ? t(' (les plats déjà en préparation ne sont pas remboursés)', ' (food already being prepared is not refunded)') : ''}`)
      draw()
    }))
    $('rate')?.addEventListener('click', () => {
      const b = openDialog(`<h2>${t('Votre note', 'Your rating')}</h2><div class="chips">${[1, 2, 3, 4, 5].map((n) => `<button class="chipb" data-s="${n}">${'★'.repeat(n)}</button>`).join('')}</div><p class="error" id="rErr"></p>`)
      b.querySelectorAll('[data-s]').forEach((x) => { x.onclick = () => busy(x, b.querySelector('#rErr'), async () => { await api.post(`/api/eats/orders/${o.id}/rate`, { stars: Number(x.dataset.s) }); closeDialog(); draw() }) })
    })
    if (!live) stopPoll()
  }
  await draw()
  startPoll(draw, 5000)
}

async function orders() {
  if (!(await requireSignIn(api))) { go('eat'); return }
  const { orders: list } = await api.get('/api/eats/orders')
  $('main').innerHTML = `<section class="card"><h2>${t('Mes commandes', 'My orders')}</h2><table class="table"><tbody>
    ${list.map((o) => `<tr data-o="${o.id}" style="cursor:pointer"><td>${fmtDateTime(o.createdAt)}</td><td>${esc(o.merchant.name)}</td><td>${cad(o.totalCents)}</td><td>${pill(o.status)}</td></tr>`).join('') || `<tr><td>${t('Aucune commande.', 'No orders yet.')}</td></tr>`}</tbody></table></section>`
  document.querySelectorAll('[data-o]').forEach((r) => { r.onclick = () => go('orders', { orderId: r.dataset.o }) })
}

// ───────── Restaurant ─────────
async function resto() {
  if (!(await requireSignIn(api, t('Connectez-vous pour gérer votre restaurant.', 'Sign in to manage your restaurant.')))) { go('eat'); return }
  const { merchants } = await api.get('/api/eats/my/merchants')
  if (!merchants.length) return restoApply()
  const m = merchants.find((x) => x.id === state.myMerchantId) ?? merchants[0]
  state.myMerchantId = m.id
  if (m.status !== 'APPROVED') {
    $('main').innerHTML = `<section class="card"><h2>${esc(m.name)}</h2><p>${m.status === 'PENDING_REVIEW' ? t('Votre restaurant est en cours de vérification (permis MAPAQ, NEQ). Nous vous écrirons.', 'Your restaurant is under review (MAPAQ permit, NEQ). We will email you.') : `${t('Statut', 'Status')} : ${esc(m.status)}${m.reviewNote ? ` — ${esc(m.reviewNote)}` : ''}`}</p></section>`
    return
  }
  const draw = async () => {
    const [{ orders: live }, { items }] = await Promise.all([api.get(`/api/eats/merchants/${m.id}/orders`), api.get(`/api/eats/merchants/${m.id}`).catch(() => ({ items: [] }))])
    const col = (states) => live.filter((o) => states.includes(o.status))
    const card = (o, actions) => `<div class="ord"><b>#${o.id.slice(0, 6)}</b> · ${o.fulfillment === 'pickup' ? t('Cueillette', 'Pickup') : t('Livraison', 'Delivery')} · ${fmtDateTime(o.createdAt)}
      <div class="small">${o.items.map((i) => `${i.qty} × ${esc(i.name)}`).join(', ')}</div>${o.note ? `<div class="small">“${esc(o.note)}”</div>` : ''}
      <div class="small">${t('Votre versement', 'Your payout')} : <b>${cad(o.payout?.payoutCents)}</b>${o.courier ? ` · ${t('Livreur', 'Courier')} : ${esc(o.courier.name ?? '')}` : ''}</div>
      <div class="row" style="margin-top:8px">${actions.map(([s, fr, en, cls]) => `<button class="${cls ?? 'secondary'}" data-o="${o.id}" data-s="${s}">${t(fr, en)}</button>`).join('')}</div></div>`
    $('main').innerHTML = `<div class="sectionhead"><span class="eyebrow">${t('TABLEAU DE BORD RESTAURANT', 'RESTAURANT DASHBOARD')}</span><h1>${esc(m.name)}</h1>
      <div class="row"><label class="opt"><input type="checkbox" id="busy" ${m.busy ? 'checked' : ''}> ${t('Mode occupé (pause des commandes)', 'Busy mode (pause orders)')}</label></div></div>
      <div class="kan"><section><h3>${t('Nouvelles', 'New')} (${col(['PLACED']).length})</h3>${col(['PLACED']).map((o) => card(o, [['ACCEPTED', 'Accepter', 'Accept', 'primary'], ['REJECTED', 'Refuser', 'Reject']])).join('')}</section>
      <section><h3>${t('En cuisine', 'In the kitchen')}</h3>${col(['ACCEPTED', 'PREPARING']).map((o) => card(o, o.status === 'ACCEPTED' ? [['PREPARING', 'Commencer', 'Start', 'primary'], ['CANCELLED', 'Annuler', 'Cancel']] : [['READY_FOR_PICKUP', 'Prête', 'Ready', 'primary']])).join('')}</section>
      <section><h3>${t('Prêtes / en route', 'Ready / on the way')}</h3>${col(['READY_FOR_PICKUP', 'PICKED_UP']).map((o) => card(o, o.fulfillment === 'pickup' && o.status === 'READY_FOR_PICKUP' ? [['DELIVERED', 'Remise au client', 'Handed to customer', 'primary']] : [])).join('')}</section></div>
      <p class="error" id="err" role="alert"></p>
      <section class="card" style="margin-top:18px"><h2>${t('Menu', 'Menu')}</h2>
      ${items.map((i) => `<div class="item ${i.available ? '' : 'off'}"><div><b>${esc(i.name)}</b> <span class="small">${esc(i.section)}</span><div>${cad(i.priceCents)}</div></div><div class="row"><button class="secondary" data-av="${i.id}" data-v="${i.available ? 0 : 1}">${i.available ? t('Rupture', 'Sold out') : t('Disponible', 'Available')}</button><button class="secondary" data-del="${i.id}">${t('Retirer', 'Remove')}</button></div></div>`).join('')}
      <form class="form" id="addItem"><div class="row"><label>${t('Section', 'Section')}<input id="iSec" value="Menu" maxlength="40"></label><label>${t('Plat', 'Dish')}<input id="iName" required maxlength="80"></label><label>${t('Prix ($)', 'Price ($)')}<input id="iPrice" required inputmode="decimal" placeholder="12.95"></label></div>
      <label>${t('Allergènes', 'Allergens')}<input id="iAll" maxlength="200" placeholder="${t('Gluten, lait…', 'Gluten, milk…')}"></label><button class="primary">${t('Ajouter au menu', 'Add to menu')}</button></form></section>`
    $('busy').onchange = async (e) => { await api.patch(`/api/eats/merchants/${m.id}`, { busy: e.target.checked }); m.busy = e.target.checked }
    document.querySelectorAll('[data-s]').forEach((b) => { b.onclick = () => busy(b, $('err'), async () => { await api.post(`/api/eats/orders/${b.dataset.o}/merchant`, { status: b.dataset.s }); draw() }) })
    document.querySelectorAll('[data-av]').forEach((b) => { b.onclick = () => busy(b, $('err'), async () => { await api.patch(`/api/eats/items/${b.dataset.av}`, { available: b.dataset.v === '1' }); draw() }) })
    document.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => busy(b, $('err'), async () => { await api.del(`/api/eats/items/${b.dataset.del}`); draw() }) })
    $('addItem').onsubmit = (e) => { e.preventDefault(); busy(e.submitter, $('err'), async () => {
      const priceCents = Math.round(Number(String($('iPrice').value).replace(',', '.')) * 100)
      await api.post(`/api/eats/merchants/${m.id}/items`, { section: $('iSec').value, name: $('iName').value, priceCents, allergens: $('iAll').value || undefined }); draw()
    }) }
  }
  await draw()
  startPoll(draw, 8000)
}

function restoApply() {
  $('main').innerHTML = `<section class="card" style="max-width:720px"><span class="eyebrow">Q EAT ${t('POUR LES RESTAURANTS', 'FOR RESTAURANTS')}</span><h1>${t('Inscrire mon restaurant', 'Register my restaurant')}</h1>
    <p>${t('Commission : 20 % en livraison, 6 % en cueillette. Vérification du permis MAPAQ et du NEQ avant la mise en ligne.', 'Commission: 20% delivery, 6% pickup. MAPAQ permit and NEQ checked before going live.')}</p>
    <form class="form" id="apply"><label>${t('Nom du restaurant', 'Restaurant name')}<input id="name" required maxlength="80"></label>
    <div class="row"><label>${t('Catégorie', 'Category')}<select id="cat">${Object.entries(CAT).map(([k, v]) => `<option value="${k}">${t(...v)}</option>`).join('')}</select></label><label>${t('Téléphone', 'Phone')}<input id="phone" maxlength="30"></label></div>
    <label>${t('Adresse', 'Address')}<input id="address" required maxlength="200"></label>
    <label>${t('Position (lieu de la liste ou « lat, lng »)', 'Location (place from list or "lat, lng")')}<input id="pos" list="places" required></label><datalist id="places">${PLACES.map(([n]) => `<option value="${esc(n)}">`).join('')}</datalist>
    <div class="row"><label>${t('Permis MAPAQ n°', 'MAPAQ permit #')}<input id="permit" required maxlength="40"></label><label>NEQ<input id="neq" required minlength="10" maxlength="10" inputmode="numeric"></label></div>
    <div class="row"><label>TPS / GST<input id="gst" maxlength="30"></label><label>TVQ / QST<input id="qst" maxlength="30"></label></div>
    <div class="row"><label>${t('Ouverture', 'Opens')}<input id="open" type="time" value="11:00"></label><label>${t('Fermeture', 'Closes')}<input id="close" type="time" value="22:00"></label><label>${t('Préparation (min)', 'Prep (min)')}<input id="prep" type="number" min="5" max="90" value="20"></label></div>
    <p class="error" id="err" role="alert"></p><button class="primary">${t('Envoyer pour vérification', 'Submit for review')}</button></form></section>`
  $('apply').onsubmit = (e) => { e.preventDefault(); busy(e.submitter, $('err'), async () => {
    const p = parsePlace($('pos').value)
    if (!p) throw Object.assign(new Error(t('Position invalide.', 'Invalid location.')), { code: 'FIELD_INVALID' })
    await api.post('/api/eats/merchants', { name: $('name').value, category: $('cat').value, phone: $('phone').value || undefined, address: $('address').value, lat: p.lat, lng: p.lng, permitNumber: $('permit').value, neq: $('neq').value, gstNumber: $('gst').value || undefined, qstNumber: $('qst').value || undefined, prepMinutes: Number($('prep').value), hours: { days: [0, 1, 2, 3, 4, 5, 6], open: $('open').value, close: $('close').value } })
    render()
  }) }
}

// ───────── Courier (Q RIDE driver account) ─────────
let gps
async function courier() {
  if (!(await requireSignIn(api, t('Connectez-vous avec votre compte chauffeur Q RIDE.', 'Sign in with your Q RIDE driver account.')))) { go('eat'); return }
  if (!api.hasRole('DRIVER')) {
    $('main').innerHTML = `<section class="card"><h2>${t('Devenir livreur', 'Become a courier')}</h2><p>${t('Les livreurs Q EAT utilisent le même compte que les chauffeurs Q RIDE : mêmes documents, même approbation. À vélo, en scooter ou en auto.', 'Q EAT couriers use the same account as Q RIDE drivers: same documents, same approval. By bike, scooter or car.')}</p><a class="primary" style="display:inline-block;text-decoration:none" href="https://qride-review.onrender.com/">${t('Postuler sur Q RIDE', 'Apply on Q RIDE')}</a></section>`
    return
  }
  const draw = async () => {
    const [{ offers, hint }, { orders: mine, todayCents }] = await Promise.all([api.get('/api/eats/courier/offers'), api.get('/api/eats/courier/active')])
    const cur = mine[0]
    $('main').innerHTML = `<div class="grid"><section class="card"><span class="eyebrow">${t('LIVREUR', 'COURIER')}</span><h2>${t('Gains des dernières 24 h', 'Last 24 h earnings')}</h2><div class="big">${cad(todayCents)}</div>
      <div class="row" style="margin-top:12px"><button class="primary" id="online">${hint === 'GO_ONLINE' ? t('Passer en ligne', 'Go online') : t('Actualiser ma position', 'Refresh my position')}</button><button class="secondary" id="offline">${t('Hors ligne', 'Go offline')}</button></div><p class="error" id="err" role="alert"></p>
      ${cur ? `<div class="ord"><b>${t('Livraison en cours', 'Current delivery')}</b> · ${pill(cur.status)}<div>${t('Récupérer chez', 'Pick up at')} <b>${esc(cur.merchant.name)}</b>, ${esc(cur.merchant.address)}</div>
        <div>${t('Livrer à', 'Deliver to')} <b>${esc(cur.address?.label ?? '')}</b></div><div class="small">${cur.items.map((i) => `${i.qty} × ${esc(i.name)}`).join(', ')}${cur.note ? ` · “${esc(cur.note)}”` : ''}</div>
        <div class="small">${t('Votre gain', 'Your pay')} : <b>${cad(cur.pay?.payoutCents)}</b> (${t('pourboire inclus', 'tip included')})</div>
        <div class="row" style="margin-top:8px"><a class="secondary" target="_blank" rel="noreferrer" style="text-decoration:none;text-align:center" href="https://www.google.com/maps/dir/?api=1&destination=${cur.status === 'PICKED_UP' ? `${cur.address.lat},${cur.address.lng}` : `${cur.merchant.lat},${cur.merchant.lng}`}">${t('Itinéraire', 'Directions')}</a>
        ${cur.status === 'READY_FOR_PICKUP' ? `<button class="primary" data-cs="PICKED_UP">${t('Commande récupérée', 'Picked up')}</button>` : cur.status === 'PICKED_UP' ? `<button class="primary" data-cs="DELIVERED">${t('Livrée', 'Delivered')}</button>` : `<span class="small">${t('Le restaurant prépare la commande…', 'Restaurant is preparing…')}</span>`}</div></div>` : ''}</section>
      <section class="card"><h2>${t('Commandes à proximité', 'Nearby orders')} (${offers.length})</h2>${hint === 'GO_ONLINE' ? `<p>${t('Passez en ligne pour voir les commandes.', 'Go online to see orders.')}</p>` : ''}
      ${offers.map((o) => `<div class="ord"><b>${esc(o.merchant.name)}</b> · ${(o.toMerchantM / 1000).toFixed(1)} km<div class="small">→ ${esc(o.address?.label ?? '')} · ${pill(o.status)}</div><div>${t('Gain', 'Pay')} : <b>${cad(o.pay?.payoutCents)}</b></div>${cur ? '' : `<button class="primary" data-claim="${o.id}" style="margin-top:6px">${t('Accepter', 'Accept')}</button>`}</div>`).join('')}</section></div>`
    const sendPos = (online) => new Promise((res) => {
      if (!online || !navigator.geolocation) { api.post('/api/driver/status', { online }).then(res, res); return }
      navigator.geolocation.getCurrentPosition((p) => api.post('/api/driver/status', { online: true, lat: p.coords.latitude, lng: p.coords.longitude }).then(res, (e) => { $('err').textContent = errorText(e); res() }), () => { $('err').textContent = t('Position indisponible.', 'Location unavailable.'); res() })
    })
    $('online').onclick = async () => { await sendPos(true); draw() }
    $('offline').onclick = async () => { await sendPos(false); draw() }
    document.querySelectorAll('[data-claim]').forEach((b) => { b.onclick = () => busy(b, $('err'), async () => { await api.post(`/api/eats/courier/orders/${b.dataset.claim}/claim`); draw() }) })
    document.querySelectorAll('[data-cs]').forEach((b) => { b.onclick = () => busy(b, $('err'), async () => { await api.post(`/api/eats/courier/orders/${cur.id}/status`, { status: b.dataset.cs }); draw() }) })
  }
  await draw()
  startPoll(draw, 8000)
  if (!gps && navigator.geolocation) gps = navigator.geolocation.watchPosition((p) => { if (state.page === 'courier') api.post('/api/driver/status', { online: true, lat: p.coords.latitude, lng: p.coords.longitude }).catch(() => {}) }, () => {}, { maximumAge: 10000 })
}

// ───────── Admin ─────────
async function admin() {
  if (!api.hasRole('ADMIN')) { go('eat'); return }
  const { merchants } = await api.get('/api/admin/eats/merchants')
  $('main').innerHTML = `<section class="card"><h2>${t('Restaurants à vérifier', 'Restaurants to review')} (${merchants.length})</h2><p class="error" id="err"></p>
    ${merchants.map((m) => `<div class="ord"><b>${esc(m.name)}</b> · ${esc(m.category)} · ${esc(m.address)}<div class="small">MAPAQ ${esc(m.permitNumber)} · NEQ ${esc(m.neq)} · TPS ${esc(m.gstNumber ?? '—')} · TVQ ${esc(m.qstNumber ?? '—')} · ${esc(m.owner.email)}</div>
      <div class="row"><button class="primary" data-d="APPROVE" data-id="${m.id}">${t('Approuver', 'Approve')}</button><button class="secondary" data-d="REJECT" data-id="${m.id}">${t('Refuser', 'Reject')}</button></div></div>`).join('') || `<p>${t('Rien à vérifier.', 'Nothing to review.')}</p>`}</section>`
  document.querySelectorAll('[data-d]').forEach((b) => { b.onclick = () => busy(b, $('err'), async () => {
    const note = b.dataset.d === 'REJECT' ? prompt(t('Raison du refus', 'Reason')) : undefined
    await api.post(`/api/admin/eats/merchants/${b.dataset.id}/decision`, { decision: b.dataset.d, note }); render()
  }) })
}

$('language').onclick = () => { i18n.set(i18n.lang === 'fr' ? 'en' : 'fr'); render() }
installDialog()
;(async () => {
  try { [state.health] = await Promise.all([api.get('/api/health'), api.loadUser()]) } catch {}
  if (api.user) {
    try { const { orders: list } = await api.get('/api/eats/orders'); const live = list.find((o) => ACTIVE.includes(o.status)); if (live) state.orderId = live.id } catch {}
  }
  render()
})()
